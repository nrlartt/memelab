"""Refresh token_trades (volume, liquidity, market cap) via DexScreener.

Safe to run any time; uses batch endpoint (~54 requests for 1.6k tokens).
"""
from __future__ import annotations

import asyncio

from loguru import logger
from sqlalchemy import select

from memedna.db import session_scope
from memedna.ingestion.dexscreener import refresh_trades_via_dexscreener
from memedna.models import Token
from memedna.analytics.engine import refresh_family_metrics
from memedna.models import DnaFamily


async def main() -> None:
    with session_scope() as session:
        addresses = list(
            session.execute(select(Token.token_address)).scalars().all()
        )
        logger.info("Pulling DexScreener metrics for {} tokens", len(addresses))
        refreshed = await refresh_trades_via_dexscreener(session, addresses)
        logger.info("DexScreener refreshed {} tokens", refreshed)

    with session_scope() as session:
        families = list(session.execute(select(DnaFamily)).scalars().all())
        logger.info("Recomputing analytics for {} families", len(families))
        for fam in families:
            refresh_family_metrics(session, fam)
    logger.info("Done.")


if __name__ == "__main__":
    asyncio.run(main())
