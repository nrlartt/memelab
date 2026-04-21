"""Backfill BscScan holder counts for every ingested token.

Two passes so the UI lights up quickly:

1. **Priority pass** — migrated tokens + anything with real DexScreener
   liquidity. These are the ones users actually click on.
2. **Long tail** — everything else (usually dead / tiny four.meme launches).

Safe to re-run any time. Each chunk commits independently so a Ctrl+C in
the middle still leaves the DB in a consistent state.
"""

from __future__ import annotations

import asyncio
import time

from loguru import logger
from sqlalchemy import select

from memedna.db import session_scope
from memedna.ingestion.bscscan import refresh_holders
from memedna.models import Token, TokenTrade


CHUNK = 80  # commit boundary — keeps progress visible in the DB


async def _run_for(addresses: list[str], label: str) -> int:
    total = 0
    started = time.monotonic()
    for i in range(0, len(addresses), CHUNK):
        batch = addresses[i : i + CHUNK]
        with session_scope() as session:
            updated = await refresh_holders(session, batch)
        total += updated
        elapsed = time.monotonic() - started
        logger.info(
            "[{}] {:>5}/{:<5} updated={} ({:.1f}s elapsed)",
            label,
            min(i + CHUNK, len(addresses)),
            len(addresses),
            total,
            elapsed,
        )
    return total


async def main() -> None:
    with session_scope() as session:
        # Skip tokens we already have a holder number for — backfill is
        # resumable, so Ctrl+C → re-run picks up where we left off.
        already = set(
            session.execute(
                select(TokenTrade.token_address).where(TokenTrade.holders > 0)
            ).scalars().all()
        )
        priority = [
            a for a in session.execute(
                select(Token.token_address)
                .join(TokenTrade, TokenTrade.token_address == Token.token_address, isouter=True)
                .where(
                    (Token.migrated.is_(True))
                    | (TokenTrade.liquidity_usd > 500)
                    | (TokenTrade.volume_24h_usd > 100)
                )
                .order_by(TokenTrade.volume_24h_usd.desc().nullslast())
            ).scalars().all()
            if a not in already
        ]
        priority_set = set(priority) | already
        rest = [
            a for a in session.execute(
                select(Token.token_address).order_by(Token.created_at.desc())
            ).scalars().all()
            if a not in priority_set
        ]

    logger.info("priority pass: {} tokens", len(priority))
    await _run_for(priority, "priority")

    logger.info("long tail: {} tokens", len(rest))
    await _run_for(rest, "tail")

    with session_scope() as session:
        from sqlalchemy import func

        filled = session.scalar(
            select(func.count()).select_from(TokenTrade).where(TokenTrade.holders > 0)
        )
        logger.info("Done. tokens with holders > 0: {}", filled)


if __name__ == "__main__":
    asyncio.run(main())
