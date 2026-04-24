"""Four.Meme ingestion orchestrator.

Combines Bitquery (rich metadata incl. descriptions) with the on-chain RPC path
(authoritative, always available). Writes/updates `tokens` + `token_trades`.
"""

from __future__ import annotations

import asyncio
import hashlib
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import IngestCursor, Token, TokenTrade
from .bitquery import BitqueryClient
from .bscscan import refresh_holders
from .dexscreener import refresh_trades_via_dexscreener
from .onchain import OnchainFourMemeClient


@dataclass
class IngestStats:
    fetched: int = 0
    inserted: int = 0
    updated: int = 0
    enriched: int = 0


def _content_hash(name: str, symbol: str, description: str) -> str:
    blob = f"{name}\u0001{symbol}\u0001{description}".encode()
    return hashlib.sha256(blob).hexdigest()


def _merge(primary: dict[str, Any], secondary: dict[str, Any]) -> dict[str, Any]:
    merged = dict(primary)
    for k, v in secondary.items():
        if merged.get(k) in (None, "", 0) and v not in (None, ""):
            merged[k] = v
    return merged


def _parse_ts(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


SOURCE_ONCHAIN = "fourmeme-onchain"


def _read_cursor(session: Session, source: str, chain_id: int) -> int:
    row = session.execute(
        select(IngestCursor).where(
            IngestCursor.source == source, IngestCursor.chain_id == chain_id
        )
    ).scalar_one_or_none()
    return int(row.last_block) if row else 0


def _write_cursor(
    session: Session, source: str, chain_id: int, last_block: int
) -> None:
    stmt = pg_insert(IngestCursor.__table__).values(
        source=source,
        chain_id=chain_id,
        last_block=int(last_block),
        updated_at=datetime.utcnow(),
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["source", "chain_id"],
        set_={"last_block": stmt.excluded.last_block, "updated_at": stmt.excluded.updated_at},
    )
    session.execute(stmt)


async def ingest_four_meme_tokens(
    session: Session,
    since_hours: int = 24,
    enrich_on_chain: bool = False,
    max_tokens: int = 10_000,
    enrichment_concurrency: int = 16,
    incremental: bool | None = None,
    from_block: int | None = None,
) -> IngestStats:
    """Main entrypoint. Safe to call repeatedly (idempotent via upsert).

    If ``incremental=True`` (or settings.pipeline_incremental) we resume from
    ``ingest_cursors`` and only scan new blocks since the last successful run.
    ``from_block`` overrides both and performs an explicit backfill.
    """
    settings = get_settings()
    if incremental is None:
        incremental = settings.pipeline_incremental

    bq = BitqueryClient()
    rpc = OnchainFourMemeClient()

    bq_rows: list[dict[str, Any]] = []
    try:
        bq_rows = await bq.list_new_tokens(since_hours=since_hours, limit=max_tokens)
    except Exception as exc:
        logger.warning("Bitquery ingest failed, falling back to on-chain only: {}", exc)

    # Decide on-chain scan range.
    chain_id = settings.bsc_chain_id
    rpc_rows: list[dict[str, Any]] = []
    try:
        latest = await asyncio.to_thread(rpc.latest_block)
    except Exception as exc:
        logger.warning("Could not read latest block: {}", exc)
        latest = None

    if latest is None:
        rpc_rows = []
        scan_end = None
    elif from_block is not None:
        scan_start = int(from_block)
        scan_end = latest
        logger.info("On-chain backfill {} → {} (explicit)", scan_start, scan_end)
        rpc_rows = await asyncio.to_thread(
            rpc.list_new_tokens,
            from_block=scan_start,
            to_block=scan_end,
            max_events=max_tokens,
        )
    elif incremental:
        cursor = _read_cursor(session, SOURCE_ONCHAIN, chain_id)
        if cursor > 0:
            scan_start = cursor + 1
            latest_int = int(latest)
            full_gap = max(latest_int - scan_start + 1, 0)
            # Chunk huge backlogs: scanning 50k+ blocks in one go ties up the
            # process for many minutes and starves the API / Node peer on small
            # Railway-style containers. Newest-within-whole-range was nice for
            # "fresh first" but is incompatible with partial cursor; we catch up
            # oldest-to-newest in slices until the gap fits under the cap.
            cap = int(getattr(settings, "pipeline_incremental_max_blocks", 0) or 0)
            if cap > 0 and full_gap > cap:
                scan_end = min(scan_start + cap - 1, latest_int)
                newest = False
                logger.info(
                    "On-chain incremental (chunk) {} → {} ({} of {} behind head)",
                    scan_start,
                    scan_end,
                    scan_end - scan_start + 1,
                    full_gap,
                )
            else:
                scan_end = latest_int
                logger.info(
                    "On-chain incremental {} → {} ({} new blocks since last run)",
                    scan_start,
                    scan_end,
                    full_gap,
                )
                # Large gap, single pass: still prefer newest so max_events
                # never trims the head.
                newest = full_gap > max_tokens
            rpc_rows = await asyncio.to_thread(
                rpc.list_new_tokens,
                from_block=scan_start,
                to_block=scan_end,
                max_events=max_tokens,
                newest_first=newest,
            )
        else:
            scan_end = latest
            logger.info(
                "On-chain cold start - seeding cursor via {}h time-window scan",
                since_hours,
            )
            rpc_rows = await asyncio.to_thread(
                rpc.list_new_tokens,
                since_hours=since_hours,
                max_events=max_tokens,
            )
    else:
        scan_end = latest
        rpc_rows = await asyncio.to_thread(
            rpc.list_new_tokens,
            since_hours=since_hours,
            max_events=max_tokens,
        )

    # Hot head pass: same guarantee as /internal/ingest/quick — newest Four.Meme
    # launches land even if incremental chunking, cursor lag, or pruned history
    # left a gap. Idempotent via merge+upsert below.
    head_rows: list[dict[str, Any]] = []
    hb = int(getattr(settings, "ingest_head_blocks", 0) or 0)
    if from_block is None and latest is not None and hb > 0:
        try:
            head_max = int(getattr(settings, "ingest_head_max_events", 24_000) or 24_000)
            head_max = min(max_tokens, max(1000, head_max))
            head_rows = await asyncio.to_thread(
                rpc.list_latest_tokens_head,
                hb,
                head_max,
            )
            if head_rows:
                logger.info(
                    "ingest head pass: {} TokenCreate in last ~{} blocks (dedupes with main scan)",
                    len(head_rows),
                    hb,
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning("ingest head pass failed (non-fatal): {}", exc)

    merged: dict[str, dict[str, Any]] = {}
    for row in bq_rows + rpc_rows + head_rows:
        addr = row["token_address"].lower()
        row["token_address"] = addr
        ts = _parse_ts(row.get("created_at")) or datetime.utcnow()
        row["created_at"] = ts
        merged[addr] = _merge(merged.get(addr, {}), row)

    stats = IngestStats(fetched=len(merged))
    logger.info(
        "Ingest enrichment: {} unique tokens, on_chain={} concurrency={}",
        len(merged), enrich_on_chain, enrichment_concurrency,
    )

    # Parallel on-chain enrichment - thread-pool the blocking RPC calls.
    sem = asyncio.Semaphore(enrichment_concurrency)

    async def enrich_one(addr: str, row: dict[str, Any]) -> tuple[str, dict[str, Any], bool]:
        async with sem:
            if not row.get("symbol") or not row.get("name"):
                fallback = await asyncio.to_thread(rpc.fetch_erc20_metadata, addr)
                row = _merge(row, fallback)
            enriched = False
            if enrich_on_chain:
                bonding = await asyncio.to_thread(rpc.enrich_with_bonding, addr)
                row = _merge(row, bonding)
                if bonding:
                    enriched = True
            return addr, row, enriched

    t0 = datetime.utcnow()
    enrich_results = await asyncio.gather(
        *(enrich_one(a, r) for a, r in merged.items()), return_exceptions=True
    )
    for res in enrich_results:
        if isinstance(res, Exception):
            logger.debug("enrichment error: {}", res)
            continue
        addr, row, enriched = res
        merged[addr] = row
        if enriched:
            stats.enriched += 1
    logger.info(
        "Enrichment phase done in {:.1f}s (enriched={}) - starting upsert",
        (datetime.utcnow() - t0).total_seconds(), stats.enriched,
    )

    # Bulk-ify the upsert: one big VALUES() + ON CONFLICT instead of 1,600
    # round-trips to the cloud DB.
    t_upsert = datetime.utcnow()
    all_addrs = list(merged.keys())
    existing_addrs: set[str] = set()
    if all_addrs:
        existing_addrs = set(
            session.execute(
                select(Token.token_address).where(Token.token_address.in_(all_addrs))
            ).scalars().all()
        )

    value_rows: list[dict[str, Any]] = []
    now_utc = datetime.utcnow()
    for addr, row in merged.items():
        description = row.get("description") or ""
        name = row.get("name") or ""
        symbol = row.get("symbol") or ""
        chash = _content_hash(name, symbol, description)
        value_rows.append(
            {
                "token_address": addr,
                "chain_id": 56,
                "symbol": symbol,
                "name": name,
                "description": description,
                "deployer": row.get("deployer"),
                "created_at": row["created_at"],
                "bonding_progress": float(row.get("bonding_progress") or 0.0),
                "migrated": bool(row.get("migrated") or False),
                "launch_tx_hash": row.get("launch_tx_hash"),
                "source": row.get("source", "fourmeme"),
                "metadata_uri": row.get("metadata_uri"),
                "raw_metadata": row.get("raw_metadata") or {},
                "content_hash": chash,
                "updated_at": now_utc,
            }
        )
    if value_rows:
        CHUNK = 400
        for i in range(0, len(value_rows), CHUNK):
            batch = value_rows[i : i + CHUNK]
            stmt = pg_insert(Token.__table__).values(batch)
            stmt = stmt.on_conflict_do_update(
                index_elements=["token_address"],
                set_={
                    "symbol": stmt.excluded.symbol,
                    "name": stmt.excluded.name,
                    "description": stmt.excluded.description,
                    "deployer": func.coalesce(
                        stmt.excluded.deployer, Token.__table__.c.deployer
                    ),
                    "bonding_progress": stmt.excluded.bonding_progress,
                    "migrated": stmt.excluded.migrated,
                    "raw_metadata": stmt.excluded.raw_metadata,
                    "content_hash": stmt.excluded.content_hash,
                    "updated_at": stmt.excluded.updated_at,
                },
            )
            session.execute(stmt)
        for addr in all_addrs:
            if addr in existing_addrs:
                stats.updated += 1
            else:
                stats.inserted += 1
    logger.info(
        "Upsert done in {:.1f}s: inserted={} updated={}",
        (datetime.utcnow() - t_upsert).total_seconds(),
        stats.inserted, stats.updated,
    )

    session.flush()

    # Advance on-chain cursor only after a successful upsert so a crash in the
    # middle of ingestion doesn't create a gap in the indexed range.
    if scan_end is not None and (incremental or from_block is not None):
        _write_cursor(session, SOURCE_ONCHAIN, chain_id, scan_end)

    # Trade refresh: always try DexScreener first (free, no key), then fall
    # back to Bitquery when configured. DexScreener covers the tokens that
    # have already migrated to PancakeSwap - pre-migration tokens stay 0 until
    # they graduate, which is the correct behaviour.
    addresses = list(merged.keys())
    # Only refresh the tokens touched in this ingest pass. Refreshing *every*
    # token in the table every 5m used to mean 10k+ addresses per run (30s+)
    # and the same work is already done in smaller batches by the
    # ``trade-refresh`` scheduler job.
    trade_targets = list(addresses)
    try:
        refreshed = await refresh_trades_via_dexscreener(session, trade_targets)
        logger.info("DexScreener refreshed {}/{} tokens", refreshed, len(trade_targets))
    except Exception as exc:  # noqa: BLE001
        logger.warning("DexScreener refresh failed: {}", exc)

    # BscScan holders enrichment (optional, no-op without BSCSCAN_API_KEY).
    # Limit to "active" tokens (those with liquidity) to stay well within the
    # free-tier quota even for 10k-token stacks.
    try:
        from sqlalchemy import select as _sel
        from ..models import TokenTrade as _TT
        active = list(
            session.execute(
                _sel(_TT.token_address).where(_TT.liquidity_usd > 0)
            ).scalars().all()
        )
        if active:
            await refresh_holders(session, active)
    except Exception as exc:  # noqa: BLE001
        logger.warning("BscScan holders refresh failed: {}", exc)

    await _refresh_trades(session, addresses, bq)

    logger.info(
        "Ingest done: fetched={} updated+inserted={} enriched={} cursor={}",
        stats.fetched, stats.updated + stats.inserted, stats.enriched, scan_end,
    )
    return stats


async def _refresh_trades(session: Session, addresses: list[str], bq: BitqueryClient) -> None:
    if not addresses:
        return
    if not bq.enabled:
        # DexScreener already filled in real numbers where it could.
        # Insert blank placeholders only for tokens still missing a row so
        # analytics joins don't fail. on-conflict-do-nothing keeps DexScreener
        # data intact.
        CHUNK = 500
        rows = [{"token_address": a} for a in addresses]
        for i in range(0, len(rows), CHUNK):
            stmt = pg_insert(TokenTrade.__table__).values(rows[i : i + CHUNK])
            stmt = stmt.on_conflict_do_nothing(index_elements=["token_address"])
            session.execute(stmt)
        return

    for addr in addresses:
        try:
            stats = await bq.token_trade_stats(addr, since_hours=24)
        except Exception as exc:
            logger.debug("trade stats failed for {}: {}", addr, exc)
            stats = {}
        values = {
            "token_address": addr,
            "volume_24h_usd": float(stats.get("volume_24h_usd") or 0),
            "trades_24h": int(stats.get("trades_24h") or 0),
            "holders": int(stats.get("holders") or 0),
            "price_usd": float(stats.get("price_usd") or 0),
            "updated_at": datetime.utcnow(),
        }
        stmt = pg_insert(TokenTrade.__table__).values(**values)
        stmt = stmt.on_conflict_do_update(
            index_elements=["token_address"],
            set_={k: stmt.excluded[k] for k in values if k != "token_address"},
        )
        session.execute(stmt)
