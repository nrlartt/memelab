"""Catch-the-latest Four.Meme tokens — cursor-independent.

Walks the last N blocks of BSC (newest-first), upserts every TokenCreate
event into ``tokens``, and refreshes DexScreener metrics for them. Does NOT
advance the ingest cursor, so it is safe to run alongside the scheduler.

Useful when the normal pipeline has drifted and you want to make absolutely
sure the freshest launches are indexed before doing analysis.

    python -m scripts.catch_latest --blocks 10000
    python -m scripts.catch_latest --blocks 6000 --max-events 2000
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
from datetime import datetime

from loguru import logger
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from memedna.db import session_scope
from memedna.ingestion.dexscreener import refresh_trades_via_dexscreener
from memedna.ingestion.onchain import OnchainFourMemeClient
from memedna.models import Token


def _hash(name: str, symbol: str, description: str) -> str:
    return hashlib.sha256(
        f"{name}\u0001{symbol}\u0001{description}".encode()
    ).hexdigest()


async def _main(blocks: int, max_events: int, refresh_trades: bool) -> None:
    rpc = OnchainFourMemeClient()
    head = rpc.latest_block()
    logger.info("Head-of-chain: {:,}. Scanning last {:,} blocks…", head, blocks)

    rows = await asyncio.to_thread(
        rpc.list_latest_tokens_head,
        blocks,
        max_events,
    )
    logger.info("Fetched {} TokenCreate events from the head window.", len(rows))
    if not rows:
        logger.warning(
            "No events returned. Verify the RPC can reach "
            "the Four.Meme TokenManager and that BSC_RPC_MAX_BLOCK_RANGE "
            "is not rejecting requests."
        )
        return

    addresses = [r["token_address"] for r in rows]
    with session_scope() as session:
        existing = set(
            session.execute(
                select(Token.token_address).where(Token.token_address.in_(addresses))
            ).scalars().all()
        )
        now = datetime.utcnow()
        values = []
        for r in rows:
            name = r.get("name") or ""
            symbol = r.get("symbol") or ""
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
                    "source": "onchain-head",
                    "metadata_uri": None,
                    "raw_metadata": {},
                    "content_hash": _hash(name, symbol, ""),
                    "updated_at": now,
                }
            )
        for i in range(0, len(values), 400):
            stmt = pg_insert(Token.__table__).values(values[i : i + 400])
            stmt = stmt.on_conflict_do_update(
                index_elements=["token_address"],
                set_={
                    "symbol": stmt.excluded.symbol,
                    "name": stmt.excluded.name,
                    "updated_at": stmt.excluded.updated_at,
                },
            )
            session.execute(stmt)
        new = sum(1 for v in values if v["token_address"] not in existing)
        logger.info(
            "Upsert done. new={} updated={} total={}",
            new, len(values) - new, len(values),
        )

        if refresh_trades and addresses:
            refreshed = await refresh_trades_via_dexscreener(session, addresses)
            logger.info("DexScreener refreshed {}/{} tokens", refreshed, len(addresses))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--blocks",
        type=int,
        default=6000,
        help="How many trailing blocks to scan (default 6000 ≈ 2 h on BSC).",
    )
    ap.add_argument(
        "--max-events",
        type=int,
        default=4000,
        help="Safety cap on how many events to upsert in one run.",
    )
    ap.add_argument(
        "--no-trades",
        action="store_true",
        help="Skip the DexScreener trade refresh.",
    )
    args = ap.parse_args()
    asyncio.run(_main(args.blocks, args.max_events, not args.no_trades))
