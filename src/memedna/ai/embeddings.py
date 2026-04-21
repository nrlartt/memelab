"""Embedding generation stage. Writes token_embeddings rows, skips unchanged content."""

from __future__ import annotations

from datetime import datetime

from loguru import logger
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ..models import Token, TokenEmbedding
from .llm import embed_texts, get_llm


def _build_text(t: Token) -> str:
    parts = [t.symbol, t.name, t.description]
    parts = [p.strip() for p in parts if p and p.strip()]
    ts = t.created_at.strftime("%Y-%m-%d %H:%M UTC") if t.created_at else ""
    if ts:
        parts.append(f"launched {ts}")
    return " | ".join(parts) or t.token_address


async def embed_tokens_needing_update(session: Session, lookback_hours: int = 24) -> int:
    """Embed any token (within the lookback window) whose content_hash changed."""
    from datetime import timedelta, timezone

    cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=lookback_hours)

    q = (
        select(Token)
        .outerjoin(TokenEmbedding, TokenEmbedding.token_address == Token.token_address)
        .where(Token.created_at >= cutoff)
        .where(
            (TokenEmbedding.token_address.is_(None))
            | (TokenEmbedding.content_hash != Token.content_hash)
        )
    )
    rows: list[Token] = list(session.execute(q).scalars().all())
    if not rows:
        logger.info("No tokens need embedding")
        return 0

    texts = [_build_text(t) for t in rows]
    logger.info("Embedding {} tokens", len(rows))
    vectors = await embed_texts(texts)
    llm = get_llm()
    model_name = llm.embedding_model if llm.enabled else "local-semantic-hash"

    now_utc = datetime.utcnow()
    payload = [
        {
            "token_address": token.token_address,
            "model": model_name,
            "content_hash": token.content_hash,
            "embedding": vec,
            "created_at": now_utc,
        }
        for token, vec in zip(rows, vectors, strict=False)
    ]
    if payload:
        CHUNK = 200  # pgvector rows are 1536-dim floats; keep batches modest
        for i in range(0, len(payload), CHUNK):
            stmt = pg_insert(TokenEmbedding.__table__).values(payload[i : i + CHUNK])
            stmt = stmt.on_conflict_do_update(
                index_elements=["token_address"],
                set_={
                    "model": stmt.excluded.model,
                    "content_hash": stmt.excluded.content_hash,
                    "embedding": stmt.excluded.embedding,
                    "created_at": stmt.excluded.created_at,
                },
            )
            session.execute(stmt)
    session.flush()
    return len(rows)
