"""On-demand single-token ingestion.

When a user hits ``GET /mutation/0x...`` for an address we haven't scanned
yet, we don't want to say "404 - wait for the next scheduler tick". We try
to pull it live:

  1. Read ERC-20 metadata (name, symbol) from the token contract.
  2. Probe Four.Meme ``_tokenInfos`` for bonding curve + launch time.
  3. Pull live market data from DexScreener (if the token has a pair).

If any of the above returns something useful we upsert a minimal row into
``tokens`` + ``token_trades`` and return it. If nothing comes back, we
leave the DB untouched and return None. This keeps us from getting
flooded with junk rows from random addresses typed into the URL bar.
"""

from __future__ import annotations

import asyncio
import hashlib
from datetime import datetime
from typing import Any

from loguru import logger
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ..models import Token, TokenTrade
from .bscscan import refresh_holders
from .dexscreener import fetch_token_metrics
from .onchain import OnchainFourMemeClient


def _content_hash(name: str, symbol: str, description: str) -> str:
    return hashlib.sha256(
        f"{name}\u0001{symbol}\u0001{description}".encode()
    ).hexdigest()


class LazyIngestResult:
    """Result envelope for :func:`lazy_ingest_token_detailed`.

    Attributes
    ----------
    ingested:
        True when a Token row was created/updated.
    reason:
        Stable machine-readable tag explaining the failure when
        ``ingested`` is False. One of:

        * ``"bad_address"`` - malformed 0x string
        * ``"no_contract"`` - address exists but has no bytecode (EOA/typo)
        * ``"no_signal"``   - contract exists but neither ERC-20 metadata
                              nor DexScreener data is available yet
    has_onchain / has_market:
        Which signals were found when ingestion succeeded (for telemetry).
    """

    __slots__ = ("ingested", "reason", "has_onchain", "has_market")

    def __init__(
        self,
        ingested: bool,
        reason: str = "",
        has_onchain: bool = False,
        has_market: bool = False,
    ) -> None:
        self.ingested = ingested
        self.reason = reason
        self.has_onchain = has_onchain
        self.has_market = has_market

    def __bool__(self) -> bool:
        return self.ingested


async def lazy_ingest_token_detailed(
    session: Session,
    address: str,
    *,
    fetch_holders_after: bool = True,
) -> LazyIngestResult:
    """Ingest a token on demand and return a structured outcome.

    Used by the API layer to surface actionable 4xx messages to the user
    instead of a generic "Token not indexed".

    Commit is performed by the caller (FastAPI dependency closes the session).
    """
    addr = address.lower().strip()
    if not (addr.startswith("0x") and len(addr) == 42):
        return LazyIngestResult(False, reason="bad_address")

    rpc = OnchainFourMemeClient()

    # Fast-path guard: if the address has no bytecode, we're not looking at
    # a Four.Meme (or any) token contract. Skip the 3 sequential RPC+HTTP
    # round-trips that would each time out individually.
    has_code = await asyncio.to_thread(rpc.has_contract_code, addr)
    if not has_code:
        logger.info("lazy_ingest: no contract at {} — skipping", addr)
        return LazyIngestResult(False, reason="no_contract")

    # Read ERC-20 metadata + bonding probe in parallel (the second call is
    # best-effort - non-FourMeme tokens won't resolve but the first call will).
    metadata = await asyncio.to_thread(rpc.fetch_erc20_metadata, addr)
    bonding = await asyncio.to_thread(rpc.enrich_with_bonding, addr)
    metrics_map = await fetch_token_metrics([addr])
    metrics = metrics_map.get(addr) or {}
    # DexScreener omits ``liquidity.usd`` for ``fourmeme`` bonding pairs — match
    # Four.meme UI by valuing the on-chain ``funds`` field (raised BNB).
    liq0 = float(metrics.get("liquidity_usd") or 0.0)
    if liq0 <= 0 and str(metrics.get("dex_id") or "").lower() == "fourmeme":
        est = await asyncio.to_thread(rpc.estimate_bonding_liquidity_usd, addr)
        if est and est > 0:
            metrics = {**metrics, "liquidity_usd": float(est)}
    # Deployer comes from TokenCreate; lazy path used to leave this NULL.
    deployer_addr: str | None = await asyncio.to_thread(
        rpc.resolve_token_deployer, addr
    )

    has_onchain = bool(metadata.get("symbol") or metadata.get("name"))
    has_market = bool(metrics)
    if not has_onchain and not has_market:
        logger.debug("lazy_ingest: no signal for {}", addr)
        return LazyIngestResult(False, reason="no_signal")

    now_utc = datetime.utcnow()
    # launch time from bonding probe if available (raw_metadata.launchTime)
    launch_ts = None
    try:
        lt = int((bonding.get("raw_metadata") or {}).get("launchTime") or 0)
        if lt > 1_600_000_000:
            launch_ts = datetime.utcfromtimestamp(lt)
    except Exception:  # noqa: BLE001
        pass

    token_row: dict[str, Any] = {
        "token_address": addr,
        "chain_id": 56,
        "symbol": metadata.get("symbol") or "",
        "name": metadata.get("name") or "",
        "description": "",
        "deployer": deployer_addr,
        "created_at": launch_ts or now_utc,
        "bonding_progress": float(bonding.get("bonding_progress") or 0.0),
        "migrated": bool(bonding.get("migrated") or False),
        "launch_tx_hash": None,
        "source": "lazy-ingest",
        "metadata_uri": None,
        "raw_metadata": bonding.get("raw_metadata") or {},
        "content_hash": _content_hash(
            metadata.get("name") or "", metadata.get("symbol") or "", ""
        ),
        "updated_at": now_utc,
    }
    stmt = pg_insert(Token.__table__).values(token_row)
    stmt = stmt.on_conflict_do_update(
        index_elements=["token_address"],
        set_={
            "symbol": stmt.excluded.symbol,
            "name": stmt.excluded.name,
            "deployer": stmt.excluded.deployer,
            "bonding_progress": stmt.excluded.bonding_progress,
            "migrated": stmt.excluded.migrated,
            "raw_metadata": stmt.excluded.raw_metadata,
            "updated_at": stmt.excluded.updated_at,
        },
    )
    session.execute(stmt)

    if metrics:
        trade_row = {
            "token_address": addr,
            "volume_24h_usd": float(metrics.get("volume_24h_usd") or 0.0),
            "market_cap_usd": float(metrics.get("market_cap_usd") or 0.0),
            "holders": 0,
            "price_usd": float(metrics.get("price_usd") or 0.0),
            "liquidity_usd": float(metrics.get("liquidity_usd") or 0.0),
            "trades_24h": int(metrics.get("trades_24h") or 0),
            "updated_at": now_utc,
        }
        stmt = pg_insert(TokenTrade.__table__).values(trade_row)
        stmt = stmt.on_conflict_do_update(
            index_elements=["token_address"],
            set_={k: stmt.excluded[k] for k in trade_row if k != "token_address"},
        )
        session.execute(stmt)

    session.commit()

    # Best-effort: pull holders from GoPlus on the same round-trip so the
    # user's first view (and Lab Report lazy-ingest) sees a real holder count.
    # Long GoPlus cooldown sleeps are capped in ``bscscan._fetch_goplus`` so
    # we skip rather than block for 90s.
    if fetch_holders_after:
        try:
            await refresh_holders(session, [addr])
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.debug("lazy-ingest: holders fetch skipped for {}: {}", addr, exc)

    logger.info(
        "lazy-ingest: ingested {} (symbol={!r}, has_market={})",
        addr, token_row["symbol"], has_market,
    )
    return LazyIngestResult(
        True, reason="", has_onchain=has_onchain, has_market=has_market
    )


# Hard cap for on-demand single-token pulls (e.g. ``GET /mutation/...``) so
# flaky public BSC RPCs cannot hold the HTTP response for minutes. Lab-report
# uses :func:`lazy_ingest_token_detailed_sync` with a separate budget.
LAZY_INGEST_MUTATION_TIMEOUT_S = 8.0
LAZY_INGEST_LAB_TIMEOUT_S = 22.0


async def lazy_ingest_token(session: Session, address: str) -> bool:
    """Thin boolean facade over :func:`lazy_ingest_token_detailed`."""
    try:
        res = await asyncio.wait_for(
            lazy_ingest_token_detailed(session, address),
            timeout=LAZY_INGEST_MUTATION_TIMEOUT_S,
        )
    except TimeoutError:
        logger.warning(
            "lazy_ingest: timed out after {}s for {} (returning 404 if not indexed)",
            LAZY_INGEST_MUTATION_TIMEOUT_S,
            address,
        )
        return False
    return bool(res)


def _assert_no_running_loop(name: str) -> None:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return
    raise RuntimeError(
        f"{name} must not be called from a thread with a running asyncio "
        "loop. Wrap the sync caller with "
        "starlette.concurrency.run_in_threadpool (or make the caller async "
        "and await the coroutine directly). Running a second loop here "
        "previously produced a cross-loop asyncio.Lock deadlock that froze "
        "the whole API."
    )


def lazy_ingest_token_sync(session: Session, address: str) -> bool:
    """Sync wrapper around :func:`lazy_ingest_token`. See
    :func:`_assert_no_running_loop` for the contract."""
    _assert_no_running_loop("lazy_ingest_token_sync")
    return asyncio.run(lazy_ingest_token(session, address))


def lazy_ingest_token_detailed_sync(
    session: Session,
    address: str,
    *,
    fetch_holders_after: bool = True,
) -> LazyIngestResult:
    """Sync wrapper around :func:`lazy_ingest_token_detailed`."""

    async def _run() -> LazyIngestResult:
        return await lazy_ingest_token_detailed(
            session, address, fetch_holders_after=fetch_holders_after
        )

    _assert_no_running_loop("lazy_ingest_token_detailed_sync")

    async def _guarded() -> LazyIngestResult:
        try:
            return await asyncio.wait_for(
                _run(), timeout=LAZY_INGEST_LAB_TIMEOUT_S
            )
        except TimeoutError:
            logger.warning(
                "lazy_ingest detailed: timed out after {}s for {}",
                LAZY_INGEST_LAB_TIMEOUT_S,
                address,
            )
            return LazyIngestResult(False, reason="timeout")

    return asyncio.run(_guarded())
