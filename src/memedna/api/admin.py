"""Admin endpoints."""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_session, session_scope
from ..models import IngestCursor, PipelineRun, Token
from ..pipeline.run_pipeline import run_pipeline
from ..schemas import PipelineRunDTO, PipelineTriggerRequest

router = APIRouter(prefix="/internal", tags=["internal"])


def _check_admin(x_admin_token: str | None) -> None:
    expected = get_settings().memedna_admin_token
    if not expected or x_admin_token != expected:
        raise HTTPException(status_code=401, detail="invalid admin token")


class QuickIngestRequest(BaseModel):
    since_hours: int = Field(2, ge=1, le=72)
    max_tokens: int = Field(2000, ge=50, le=20000)
    enrich_on_chain: bool = False
    head_blocks: int = Field(
        6000,
        ge=500,
        le=48000,
        description=(
            "Size of the dedicated head-scan (in blocks). 6000 ≈ last 2 h on "
            "BSC. Ensures the freshest tokens land even if the cursor gap "
            "is > max_tokens."
        ),
    )


class QuickIngestResponse(BaseModel):
    fetched: int
    inserted: int
    updated: int
    enriched: int
    new_1h: int
    duration_s: float
    cursor_block: int
    chain_head: int | None
    lag_blocks: int | None
    head_events: int
    head_inserted: int
    gap_blocks: int


@router.post("/ingest/quick", response_model=QuickIngestResponse)
async def ingest_quick(
    body: QuickIngestRequest,
    x_admin_token: str | None = Header(default=None, convert_underscores=False),
) -> QuickIngestResponse:
    """Fast, LLM-free ingest path.

    Two scans run back-to-back:

      1. **Head scan** — a dedicated pull of the last ``head_blocks`` blocks
         (newest-first) so the freshest Four.Meme launches always land,
         regardless of cursor position or pruned-history gaps.
      2. **Cursor-based incremental** — walks ``cursor+1 → head`` so cursor
         eventually catches up and we also fill in anything the head scan
         missed.

    Both scans share the same upsert path (idempotent). Typical response
    time: 8–40 s depending on RPC latency.
    """
    _check_admin(x_admin_token)
    from ..ingestion.four_meme import (
        _content_hash,
        ingest_four_meme_tokens,
    )
    from ..ingestion.onchain import OnchainFourMemeClient
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    t0 = time.time()
    rpc = OnchainFourMemeClient()
    head_events = 0
    head_inserted = 0
    gap_blocks = 0

    # 1) Head scan FIRST — guarantees "the latest" tokens land even if the
    #    cursor is stale. Bypasses the regular pipeline so we can apply it
    #    before any cursor math.
    try:
        rows = await asyncio.to_thread(
            rpc.list_latest_tokens_head,
            body.head_blocks,
            body.max_tokens,
        )
        head_events = len(rows)
        if rows:
            with session_scope() as session:
                seen = set(
                    session.execute(
                        select(Token.token_address).where(
                            Token.token_address.in_([r["token_address"] for r in rows])
                        )
                    ).scalars().all()
                )
                now = datetime.utcnow()
                values = []
                for r in rows:
                    name = r.get("name") or ""
                    symbol = r.get("symbol") or ""
                    # ERC20 fallback for rows missing metadata.
                    if not name or not symbol:
                        meta = await asyncio.to_thread(
                            rpc.fetch_erc20_metadata, r["token_address"]
                        )
                        name = name or meta.get("name") or ""
                        symbol = symbol or meta.get("symbol") or ""
                    values.append(
                        {
                            "token_address": r["token_address"],
                            "chain_id": 56,
                            "symbol": symbol,
                            "name": name,
                            "description": "",
                            "deployer": r.get("deployer"),
                            "created_at": r["created_at"],
                            "bonding_progress": 0.0,
                            "migrated": False,
                            "launch_tx_hash": r.get("launch_tx_hash"),
                            "source": r.get("source", "onchain-head"),
                            "metadata_uri": None,
                            "raw_metadata": {},
                            "content_hash": _content_hash(name, symbol, ""),
                            "updated_at": now,
                        }
                    )
                CHUNK = 400
                for i in range(0, len(values), CHUNK):
                    stmt = pg_insert(Token.__table__).values(values[i : i + CHUNK])
                    stmt = stmt.on_conflict_do_update(
                        index_elements=["token_address"],
                        set_={
                            "symbol": stmt.excluded.symbol,
                            "name": stmt.excluded.name,
                            "bonding_progress": stmt.excluded.bonding_progress,
                            "updated_at": stmt.excluded.updated_at,
                        },
                    )
                    session.execute(stmt)
                head_inserted = sum(1 for v in values if v["token_address"] not in seen)
                session.flush()
    except Exception as exc:  # noqa: BLE001
        # Head scan is best-effort; fall through to the cursor path below.
        from loguru import logger

        logger.warning("head-scan failed in /ingest/quick: {}", exc)

    # 2) Cursor-based incremental (also refreshes DexScreener / trades).
    with session_scope() as session:
        stats = await ingest_four_meme_tokens(
            session,
            since_hours=body.since_hours,
            enrich_on_chain=body.enrich_on_chain,
            max_tokens=body.max_tokens,
            incremental=True,
        )
        from sqlalchemy import func as _func

        one_hour_ago = datetime.now(tz=timezone.utc) - timedelta(hours=1)
        new_1h = int(
            session.execute(
                select(_func.count(Token.token_address)).where(
                    Token.discovered_at >= one_hour_ago
                )
            ).scalar_one()
            or 0
        )
        cursor_row = session.execute(
            select(IngestCursor).where(
                IngestCursor.source == "fourmeme-onchain",
                IngestCursor.chain_id == get_settings().bsc_chain_id,
            )
        ).scalar_one_or_none()
        cursor_block = int(cursor_row.last_block) if cursor_row else 0
        gap_blocks = int(getattr(rpc, "_last_gap_blocks", 0) or 0)

    chain_head: int | None = None
    lag_blocks: int | None = None
    try:
        chain_head = int(await asyncio.to_thread(rpc.latest_block))
        lag_blocks = max(0, chain_head - cursor_block) if cursor_block else None
    except Exception:  # noqa: BLE001
        pass

    return QuickIngestResponse(
        fetched=stats.fetched + head_events,
        inserted=stats.inserted + head_inserted,
        updated=stats.updated,
        enriched=stats.enriched,
        new_1h=new_1h,
        duration_s=round(time.time() - t0, 2),
        cursor_block=cursor_block,
        chain_head=chain_head,
        lag_blocks=lag_blocks,
        head_events=head_events,
        head_inserted=head_inserted,
        gap_blocks=gap_blocks,
    )


@router.post("/pipeline/run", response_model=PipelineRunDTO)
async def trigger_pipeline(
    body: PipelineTriggerRequest,
    x_admin_token: str | None = Header(default=None, convert_underscores=False),
    session: Session = Depends(get_session),
) -> PipelineRunDTO:
    _check_admin(x_admin_token)
    result = await run_pipeline(
        lookback_hours=body.lookback_hours, force_recluster=body.force_recluster
    )
    run = session.get(PipelineRun, result.run_id)
    if not run:
        raise HTTPException(status_code=500, detail="pipeline run not recorded")
    return _to_dto(run)


@router.get("/pipeline/runs", response_model=list[PipelineRunDTO])
def list_runs(
    limit: int = 20,
    x_admin_token: str | None = Header(default=None, convert_underscores=False),
    session: Session = Depends(get_session),
) -> list[PipelineRunDTO]:
    _check_admin(x_admin_token)
    rows = list(
        session.execute(
            select(PipelineRun).order_by(PipelineRun.started_at.desc()).limit(limit)
        ).scalars().all()
    )
    return [_to_dto(r) for r in rows]


def _to_dto(run: PipelineRun) -> PipelineRunDTO:
    return PipelineRunDTO(
        id=run.id,
        started_at=run.started_at,
        finished_at=run.finished_at,
        status=run.status,
        stages=run.stages,
        tokens_ingested=run.tokens_ingested,
        families_updated=run.families_updated,
        degraded=run.degraded,
        error=run.error,
    )


# Silence lint about asyncio unused in this module.
_ = asyncio
