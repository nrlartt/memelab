"""Fast, standalone trade-data refresher.

Why this exists
---------------
The full :mod:`memedna.pipeline.run_pipeline` covers ingestion + embeddings +
clustering + LLM enrichment + analytics. End-to-end it takes 25-50 minutes
per tick, so trade-volume numbers written at the tail of one run can be
45+ minutes stale by the time the next run's ingest phase rewrites them.

That was fine when MemeLab only surfaced day-level trends, but for new
Four.Meme launches (which routinely pump/dump in minutes) it meant
``/mutation/0x...`` would show $13k volume while DexScreener already
showed $815k. The UI looked broken.

This module is the surgical fix:

* It touches only ``TokenTrade`` via the free DexScreener batch endpoint.
* It takes no LLM, no on-chain, no clustering dependencies.
* It runs every couple of minutes on its own APScheduler job, in parallel
  with the full pipeline.
* It prioritises addresses most likely to have drifted: recent launches,
  tokens with known liquidity, and rows whose ``updated_at`` is past the
  staleness threshold. Everything else gets refreshed less often.

The staleness-aware selector is deliberately bounded (``MAX_PER_TICK``):
we would rather leave long-tail dead tokens stale for a few extra minutes
than push too many addresses per DexScreener request burst.
"""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta, timezone

from loguru import logger
from sqlalchemy import or_, select

from sqlalchemy.orm import Session as OrmSession

from ..config import get_settings
from ..db import session_scope
from ..ingestion.dexscreener import refresh_trades_via_dexscreener
from ..models import Token, TokenTrade

# Upper bound of addresses we refresh in one tick. 30 per DexScreener call
# × 6 concurrent calls × ~10 rolling seconds ⇒ ~1,800 is comfortable.
# We intentionally set lower than that so two overlapping ticks can't
# saturate the public endpoint (300 req/min shared quota).
MAX_PER_TICK = 1500

# Two minutes is the cadence we target from ``main.py``'s scheduler.
# Anything older than that is considered "drift risk" and goes first.
STALE_AFTER = timedelta(minutes=2)

# Recent launches (young tokens) pump/dump on minute-level timescales -
# these get selected regardless of whether their trade row looks fresh,
# because early-curve Four.Meme volumes change extremely fast.
RECENT_LAUNCH_WINDOW = timedelta(hours=24)


def _now_utc() -> datetime:
    return datetime.now(tz=timezone.utc)


def _select_priority_addresses(session, now: datetime) -> list[str]:
    """Pick the highest-value subset of token addresses to refresh.

    Order of priority (best first):
      1. Tokens discovered in the last 24h — they move fast, often have
         no trade row yet, and are the first thing a user will look at.
      2. Tokens whose last ``TokenTrade.updated_at`` is older than the
         staleness threshold.
      3. Tokens that have ever had liquidity > 0 (cap the long tail at
         whatever budget remains).

    The ``MAX_PER_TICK`` cap is applied globally across these three
    buckets while preserving that priority order.
    """
    # Bucket 1: recent launches.
    recent_addrs: list[str] = list(
        session.execute(
            select(Token.token_address)
            .where(Token.created_at >= now - RECENT_LAUNCH_WINDOW)
            .order_by(Token.created_at.desc())
        ).scalars().all()
    )

    # Bucket 2: stale trade rows (older than STALE_AFTER) OR tokens that
    # have no trade row yet. The LEFT JOIN makes "never refreshed" count
    # as maximally stale.
    stale_cutoff = now - STALE_AFTER
    stale_q = (
        select(Token.token_address)
        .join(TokenTrade, TokenTrade.token_address == Token.token_address, isouter=True)
        .where(
            or_(
                TokenTrade.updated_at.is_(None),
                TokenTrade.updated_at < stale_cutoff,
            )
        )
        # Newer tokens first - they're more likely to be the one a user
        # is staring at right now.
        .order_by(Token.created_at.desc())
    )
    stale_addrs: list[str] = list(session.execute(stale_q).scalars().all())

    # Bucket 3: tokens with any known liquidity. These are the long-tail
    # "has a real market" set. Sort by liquidity descending so we catch
    # the big movers first when the budget is tight.
    active_q = (
        select(TokenTrade.token_address)
        .where(TokenTrade.liquidity_usd > 0)
        .order_by(TokenTrade.liquidity_usd.desc())
    )
    active_addrs: list[str] = list(session.execute(active_q).scalars().all())

    # Merge with de-dup while preserving priority order.
    seen: set[str] = set()
    ordered: list[str] = []
    for bucket in (recent_addrs, stale_addrs, active_addrs):
        for addr in bucket:
            if addr in seen:
                continue
            seen.add(addr)
            ordered.append(addr)
            if len(ordered) >= MAX_PER_TICK:
                return ordered
    return ordered


async def refresh_all_trades_once() -> dict[str, int]:
    """Run a single fast refresh pass. Returns telemetry for the logger."""
    t0 = time.time()
    with session_scope() as session:
        now = _now_utc()
        addresses = _select_priority_addresses(session, now)
        if not addresses:
            return {"selected": 0, "refreshed": 0, "elapsed_ms": 0}
        refreshed = await refresh_trades_via_dexscreener(session, addresses)

    elapsed_ms = int((time.time() - t0) * 1000)
    logger.info(
        "trade-refresh: {}/{} tokens refreshed in {}ms",
        refreshed, len(addresses), elapsed_ms,
    )
    return {
        "selected": len(addresses),
        "refreshed": refreshed,
        "elapsed_ms": elapsed_ms,
    }


async def refresh_single_token_trade(address: str) -> bool:
    """Foreground refresh of one token's trade row.

    Used by HTTP endpoints when they notice the cached row is stale and
    want to serve fresh numbers on the same request. Returns True if
    DexScreener had data and we wrote it.
    """
    addr = address.lower().strip()
    if not (addr.startswith("0x") and len(addr) == 42):
        return False
    with session_scope() as session:
        n = await refresh_trades_via_dexscreener(session, [addr])
    return n > 0


def maybe_refresh_stale_trade_sync(
    session: OrmSession, address: str, trade: TokenTrade | None
) -> TokenTrade | None:
    """Refresh ``trade`` if older than ``trade_freshness_seconds``.

    Shared helper used by ``/mutation`` and ``/lab-report`` so their
    staleness policy stays consistent. Returns the (possibly re-loaded)
    trade row, which may be None if DexScreener has no pair yet.

    Must be called from FastAPI's sync thread-pool (i.e. a non-async
    endpoint body or inside ``run_in_threadpool``). Safe against a dead
    DexScreener: falls through to the cached row on timeout/error.
    """
    freshness_s = get_settings().trade_freshness_seconds
    needs_refresh = trade is None
    if trade is not None and trade.updated_at is not None:
        upd = trade.updated_at
        if upd.tzinfo is None:
            upd = upd.replace(tzinfo=timezone.utc)
        if upd < _now_utc() - timedelta(seconds=freshness_s):
            needs_refresh = True
    if not needs_refresh:
        return trade
    try:
        refreshed = refresh_single_token_trade_sync(address)
    except Exception as exc:  # noqa: BLE001
        logger.debug("staleness refresh failed for {}: {}", address, exc)
        refreshed = False
    if refreshed:
        session.expire_all()
        return session.get(TokenTrade, address)
    return trade


def refresh_single_token_trade_sync(address: str, timeout_s: float = 4.0) -> bool:
    """Sync wrapper for call sites running in FastAPI's sync thread-pool.

    FastAPI executes non-async endpoints on a worker thread (no running
    event loop), so we can safely spin up a short-lived loop via
    ``asyncio.run``. The wall-clock timeout keeps a slow DexScreener call
    from blocking the HTTP response - on timeout we just fall through
    and serve the slightly-stale cached row.
    """
    try:
        return asyncio.run(
            asyncio.wait_for(refresh_single_token_trade(address), timeout=timeout_s)
        )
    except asyncio.TimeoutError:
        logger.debug("refresh_single_token_trade_sync: timeout for {}", address)
        return False
    except RuntimeError as exc:
        # "asyncio.run() cannot be called from a running event loop" -
        # if this ever triggers it means an async caller mis-imported
        # the sync variant. Log and fail soft.
        logger.warning("refresh_single_token_trade_sync misuse: {}", exc)
        return False
    except Exception as exc:  # noqa: BLE001
        logger.debug("refresh_single_token_trade_sync error for {}: {}", address, exc)
        return False
