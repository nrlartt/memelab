"""Full-history Four.Meme token backfill via BSC archive RPC.

Background
----------
Public BSC RPCs prune ``eth_getLogs`` beyond ~18 hours and Bitquery's
free tier ran out of points. This script uses whatever RPC is configured
in ``BSC_RPC_URL`` (should be a paid archive-enabled node: QuickNode,
Alchemy, Ankr Premium, ...) and walks the chain in parallel chunks from
``--from-block`` (default: Four.Meme factory deploy block) to the
current head.

What it does
------------
* Splits the full range into ``--window-blocks`` sized chunks.
* Fans out ``--concurrency`` parallel ``eth_getLogs`` calls.
* Dynamically shrinks the window on "range too large" errors.
* Bulk-upserts every TokenCreate event into the ``tokens`` table.
* Writes a resume cursor (same row the live pipeline reads) so the
  scheduler picks up where the backfill stopped.
* No clustering, no embeddings, no LLM - those run on the next
  scheduled pipeline pass (scheduler already batches them in 5m ticks).

Usage
-----
    # Full backfill (deploy block -> head). Assumes BSC_RPC_ARCHIVE=true.
    python scripts/backfill_fourmeme.py

    # Targeted range and bigger chunks for a fast paid RPC.
    python scripts/backfill_fourmeme.py --from-block 38500000 \
        --window-blocks 10000 --concurrency 10

    # Stop early at a given block.
    python scripts/backfill_fourmeme.py --to-block 80000000
"""

from __future__ import annotations

import argparse
import hashlib
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any

from loguru import logger
from sqlalchemy.dialects.postgresql import insert as pg_insert
from web3 import Web3

from memedna.config import get_settings
from memedna.db import SessionLocal
from memedna.ingestion.onchain import OnchainFourMemeClient
from memedna.models import IngestCursor, Token


UPSERT_CHUNK = 500
SOURCE = "fourmeme-onchain"


def _content_hash(name: str, symbol: str, description: str) -> str:
    blob = f"{name}\u0001{symbol}\u0001{description}".encode()
    return hashlib.sha256(blob).hexdigest()


def _events_to_rows(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for ev in events:
        args = ev["args"]
        try:
            ts = datetime.fromtimestamp(int(args["launchTime"]), tz=timezone.utc)
        except Exception:  # noqa: BLE001
            ts = datetime.now(tz=timezone.utc)
        out.append(
            {
                "token_address": args["token"].lower(),
                "symbol": args.get("symbol") or "",
                "name": args.get("name") or "",
                "deployer": args["creator"].lower(),
                "created_at": ts,
                "launch_tx_hash": ev["transactionHash"].hex(),
                "block_number": ev["blockNumber"],
            }
        )
    return out


def _bulk_upsert(rows: list[dict[str, Any]]) -> tuple[int, int]:
    """Returns (inserted, updated)."""
    if not rows:
        return 0, 0
    now_utc = datetime.utcnow()

    addrs = [r["token_address"] for r in rows]

    value_rows: list[dict[str, Any]] = []
    for r in rows:
        name = r["name"] or ""
        symbol = r["symbol"] or ""
        value_rows.append(
            {
                "token_address": r["token_address"],
                "chain_id": 56,
                "symbol": symbol,
                "name": name,
                "description": "",
                "deployer": r["deployer"],
                "created_at": r["created_at"],
                "bonding_progress": 0.0,
                "migrated": False,
                "launch_tx_hash": r["launch_tx_hash"],
                "source": "onchain-backfill",
                "metadata_uri": None,
                "raw_metadata": {"backfill_block": r["block_number"]},
                "content_hash": _content_hash(name, symbol, ""),
                "updated_at": now_utc,
            }
        )

    with SessionLocal() as session:
        existing = set(
            session.execute(
                Token.__table__.select()
                .with_only_columns(Token.__table__.c.token_address)
                .where(Token.__table__.c.token_address.in_(addrs))
            ).scalars().all()
        )
        for i in range(0, len(value_rows), UPSERT_CHUNK):
            batch = value_rows[i : i + UPSERT_CHUNK]
            stmt = pg_insert(Token.__table__).values(batch)
            stmt = stmt.on_conflict_do_update(
                index_elements=["token_address"],
                set_={
                    # Don't clobber a good description with an empty one from
                    # the raw TokenCreate log - only refresh identity fields.
                    "symbol": stmt.excluded.symbol,
                    "name": stmt.excluded.name,
                    "content_hash": stmt.excluded.content_hash,
                    "updated_at": stmt.excluded.updated_at,
                },
            )
            session.execute(stmt)
        session.commit()

    inserted = sum(1 for a in addrs if a not in existing)
    return inserted, len(addrs) - inserted


def _write_cursor(last_block: int) -> None:
    with SessionLocal() as session:
        stmt = pg_insert(IngestCursor.__table__).values(
            source=SOURCE,
            chain_id=56,
            last_block=int(last_block),
            updated_at=datetime.utcnow(),
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["source", "chain_id"],
            set_={
                # Never step the cursor backwards - scheduler may have already
                # advanced past us on live incremental runs.
                "last_block": stmt.excluded.last_block,
                "updated_at": stmt.excluded.updated_at,
            },
            where=IngestCursor.__table__.c.last_block < int(last_block),
        )
        session.execute(stmt)
        session.commit()


def _read_cursor() -> int:
    with SessionLocal() as session:
        row = session.execute(
            IngestCursor.__table__.select().where(
                IngestCursor.__table__.c.source == SOURCE,
                IngestCursor.__table__.c.chain_id == 56,
            )
        ).mappings().first()
    return int(row["last_block"]) if row else 0


def _chunk_fetch(
    rpc: OnchainFourMemeClient, start: int, end: int,
) -> tuple[int, int, list[dict[str, Any]] | None]:
    logs = rpc._fetch_chunk(start, end)  # noqa: SLF001 - intentional reuse
    if logs == "pruned":
        return start, end, []
    if logs is None:
        return start, end, None
    return start, end, list(logs)


def backfill(
    from_block: int,
    to_block: int | None,
    window: int,
    concurrency: int,
    resume: bool,
) -> None:
    settings = get_settings()
    if not settings.bsc_rpc_archive:
        logger.warning(
            "BSC_RPC_ARCHIVE is not set to true - the client will clamp "
            "history to ~{:,} blocks. Set BSC_RPC_ARCHIVE=true in .env "
            "before running this script against a paid archive node.",
            settings.bsc_rpc_safe_history_blocks,
        )

    rpc = OnchainFourMemeClient()
    if not rpc.w3.is_connected():
        logger.error("BSC RPC at {} is unreachable.", settings.bsc_rpc_url)
        sys.exit(2)

    latest = rpc.latest_block()
    end = int(to_block) if to_block is not None else latest

    start = int(from_block)
    if resume:
        cur = _read_cursor()
        if cur and cur >= start:
            logger.info("Resuming from ingest_cursors last_block={:,}", cur)
            start = cur + 1

    if end <= start:
        logger.info("Nothing to do: start={} end={}", start, end)
        return

    total_blocks = end - start + 1
    total_chunks = (total_blocks + window - 1) // window
    logger.info(
        "Backfill {:,} -> {:,} ({:,} blocks, ~{:,} chunks of {:,}, concurrency={})",
        start, end, total_blocks, total_chunks, window, concurrency,
    )

    # Precompute chunk ranges.
    ranges: list[tuple[int, int]] = []
    cur = start
    while cur <= end:
        ranges.append((cur, min(cur + window - 1, end)))
        cur += window

    started_at = time.time()
    total_events = 0
    total_inserted = 0
    total_updated = 0
    cursor_high = start - 1
    failures = 0

    with ThreadPoolExecutor(max_workers=concurrency, thread_name_prefix="backfill") as pool:
        pending = ranges
        idx = 0
        while pending:
            # Submit a window-worth of chunks, then drain.
            batch = pending[: concurrency * 4]
            pending = pending[concurrency * 4 :]
            futs = {pool.submit(_chunk_fetch, rpc, s, e): (s, e) for s, e in batch}

            collected_rows: list[dict[str, Any]] = []
            max_end = cursor_high

            for fut in as_completed(futs):
                s, e = futs[fut]
                try:
                    _, end_blk, logs = fut.result()
                except Exception as exc:  # noqa: BLE001
                    logger.warning("chunk {}-{} failed: {}", s, e, exc)
                    failures += 1
                    continue
                if logs is None:
                    failures += 1
                    continue
                if logs:
                    collected_rows.extend(_events_to_rows(logs))
                max_end = max(max_end, end_blk)
                idx += 1

            if collected_rows:
                # Dedup within the batch (same token can be referenced in
                # multiple chunks if the RPC re-splits on retry).
                dedup: dict[str, dict[str, Any]] = {}
                for r in collected_rows:
                    dedup[r["token_address"]] = r
                ins, upd = _bulk_upsert(list(dedup.values()))
                total_events += len(collected_rows)
                total_inserted += ins
                total_updated += upd

            if max_end > cursor_high:
                cursor_high = max_end
                _write_cursor(cursor_high)

            if idx % max(1, concurrency) == 0 or not pending:
                elapsed = time.time() - started_at
                scanned = cursor_high - start + 1
                pct = min(100.0, scanned / total_blocks * 100) if total_blocks else 100
                rate = scanned / max(elapsed, 1e-6)
                eta_sec = (total_blocks - scanned) / max(rate, 1e-6) if rate > 0 else 0
                logger.info(
                    "progress {:.1f}% | scanned {:,}/{:,} blocks | "
                    "tokens ins={:,} upd={:,} (events={:,}) | "
                    "{:.0f} blk/s | eta {:.0f}s | failures={}",
                    pct, scanned, total_blocks, total_inserted,
                    total_updated, total_events, rate, eta_sec, failures,
                )

            if failures >= 40:
                logger.error(
                    "Too many RPC failures ({}) - aborting; cursor stopped at {:,}.",
                    failures, cursor_high,
                )
                break

    elapsed = time.time() - started_at
    logger.info(
        "Backfill done in {:.1f}s. events={:,} tokens_inserted={:,} tokens_updated={:,} "
        "cursor={:,} failures={}",
        elapsed, total_events, total_inserted, total_updated, cursor_high, failures,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--from-block", type=int, default=None,
        help="Start block (default: FOURMEME_FACTORY_DEPLOY_BLOCK from config).",
    )
    parser.add_argument(
        "--to-block", type=int, default=None,
        help="Stop block (default: current head).",
    )
    parser.add_argument(
        "--window-blocks", type=int, default=None,
        help="Per-call block range (default: BSC_RPC_MAX_BLOCK_RANGE).",
    )
    parser.add_argument(
        "--concurrency", type=int, default=8,
        help="Parallel eth_getLogs calls (default: 8). Raise for premium RPCs.",
    )
    parser.add_argument(
        "--no-resume", action="store_true",
        help="Ignore ingest_cursors.last_block and start from --from-block.",
    )
    args = parser.parse_args()

    s = get_settings()
    from_block = args.from_block if args.from_block is not None else s.fourmeme_factory_deploy_block
    window = args.window_blocks if args.window_blocks is not None else s.bsc_rpc_max_block_range

    backfill(
        from_block=from_block,
        to_block=args.to_block,
        window=window,
        concurrency=args.concurrency,
        resume=not args.no_resume,
    )


if __name__ == "__main__":
    main()
