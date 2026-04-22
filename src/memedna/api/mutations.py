"""GET /mutation/{token_address}."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from datetime import datetime, timezone
from typing import Callable, TypeVar

from fastapi import APIRouter, Depends, HTTPException
from loguru import logger
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_session
from ..ingestion.lazy import lazy_ingest_token_sync
from ..models import DnaFamily, FamilyMutation, Token, TokenTrade
from .launch_time import effective_token_launch_utc
from ..pipeline.trade_refresh import maybe_refresh_stale_trade_sync
from ..schemas import MutationFamilyStub, MutationWithFamily, TradingDTO

router = APIRouter(tags=["mutations"])

T = TypeVar("T")

# User-facing /mutation must return before reverse-proxy timeouts (Vercel ~10-60s).
# Unbounded on-chain work (e.g. ``eth_getLogs`` over wide ranges) is moved off
# the hot path via short hard caps; failures remain best-effort.
_MUTATION_DEPLOYER_RPC_S = 3.0
_MUTATION_LAUNCH_RPC_S = 3.0
_MUTATION_BONDING_LIQ_RPC_S = 2.0


def _call_sync_with_timeout(
    label: str, fn: Callable[[], T], seconds: float
) -> T | None:
    """Run a blocking call in a worker thread, abandon after ``seconds`` wall time."""
    with ThreadPoolExecutor(max_workers=1) as ex:
        fut = ex.submit(fn)
        try:
            return fut.result(timeout=seconds)
        except FuturesTimeout:
            logger.warning(
                "mutation: {} RPC step timed out after {}s (best-effort skip)",
                label,
                seconds,
            )
            return None
        except Exception as exc:  # noqa: BLE001
            logger.debug("mutation: {}: {}", label, exc)
            return None


@router.get("/mutation/{token_address}", response_model=MutationWithFamily)
def get_mutation(token_address: str, session: Session = Depends(get_session)) -> MutationWithFamily:
    addr = token_address.lower()
    if not (addr.startswith("0x") and len(addr) == 42):
        raise HTTPException(status_code=400, detail="Invalid token address")

    token = session.get(Token, addr)
    if not token:
        # Try a best-effort on-demand ingestion from BSC RPC + DexScreener
        # before giving up. Keeps "any Four.Meme token URL should just work"
        # contract intact without requiring the scheduler to have ticked.
        try:
            ingested = lazy_ingest_token_sync(session, addr)
        except Exception as exc:  # noqa: BLE001
            logger.warning("lazy ingest failed for {}: {}", addr, exc)
            ingested = False
        if ingested:
            session.expire_all()
            token = session.get(Token, addr)
        if not token:
            raise HTTPException(status_code=404, detail=f"Token '{token_address}' not indexed")

    # Older ingests (especially lazy-ingest) omitted deployer. One-shot RPC
    # backfill so the mutation page and lab-report facts aren't stuck empty.
    if not token.deployer:
        from ..ingestion.onchain import OnchainFourMemeClient

        def _deployer_block() -> str | None:
            return OnchainFourMemeClient().resolve_token_deployer(addr)

        dep: str | None = _call_sync_with_timeout(
            "deployer backfill", _deployer_block, _MUTATION_DEPLOYER_RPC_S
        )
        if dep:
            try:
                token.deployer = dep
                session.commit()
            except Exception as exc:  # noqa: BLE001
                logger.debug("deployer commit skipped for {}: {}", addr, exc)

    # Align with Four.meme: use on-chain launchTime from bonding when missing/stale.
    meta = token.raw_metadata or {}
    if not (isinstance(meta, dict) and meta.get("launchTime")):
        from ..ingestion.onchain import OnchainFourMemeClient

        def _launch_block() -> dict[str, Any] | None:
            b = OnchainFourMemeClient().enrich_with_bonding(addr)
            return b if isinstance(b, dict) else None

        bonding = _call_sync_with_timeout(
            "launchTime backfill", _launch_block, _MUTATION_LAUNCH_RPC_S
        )
        if isinstance(bonding, dict):
            try:
                raw = bonding.get("raw_metadata") or {}
                if raw.get("launchTime"):
                    base = meta if isinstance(meta, dict) else {}
                    token.raw_metadata = {**base, **raw}
                    lt = int(raw["launchTime"])
                    if lt > 1_000_000_000:
                        token.created_at = datetime.fromtimestamp(
                            lt, tz=timezone.utc
                        )
                    session.commit()
            except Exception as exc:  # noqa: BLE001
                logger.debug("launchTime backfill commit skipped for {}: {}", addr, exc)

    trade = session.get(TokenTrade, addr)

    # Hot Four.Meme tokens pump/dump inside the scheduler's 2-5 minute
    # window. If the cached trade row is stale, pull live DexScreener
    # numbers synchronously — bounded timeout inside the helper means a
    # dead DexScreener can't stall the page.
    trade = maybe_refresh_stale_trade_sync(session, addr, trade)

    # DexScreener often sends liquidity=null for four.meme bonding pairs — if
    # the row is still zero after refresh, patch from on-chain ``funds``.
    if trade and float(trade.liquidity_usd or 0) <= 0:
        from ..ingestion.onchain import OnchainFourMemeClient

        def _liq() -> float | None:
            return OnchainFourMemeClient().estimate_bonding_liquidity_usd(addr)

        est: float | None = _call_sync_with_timeout(
            "bonding liquidity", _liq, _MUTATION_BONDING_LIQ_RPC_S
        )
        if est and est > 0:
            try:
                trade.liquidity_usd = float(est)
                session.commit()
            except Exception as exc:  # noqa: BLE001
                logger.debug(
                    "bonding liquidity commit skipped for {}: {}", addr, exc
                )

    link_row = session.execute(
        select(FamilyMutation, DnaFamily)
        .join(DnaFamily, DnaFamily.id == FamilyMutation.family_id)
        .where(FamilyMutation.token_address == addr)
        .limit(1)
    ).first()

    family_stub = None
    is_origin = is_dominant = is_fastest = False
    why = ""
    if link_row is not None:
        mut, fam = link_row
        family_stub = MutationFamilyStub(id=fam.id, event_title=fam.event_title)
        is_origin = mut.is_origin_strain
        is_dominant = mut.is_dominant_strain
        is_fastest = mut.is_fastest_mutation
        why = mut.why_this_mutation_belongs

    return MutationWithFamily(
        token_address=token.token_address,
        symbol=token.symbol,
        name=token.name,
        description=token.description,
        created_at=effective_token_launch_utc(token),
        deployer=token.deployer,
        bonding_progress=token.bonding_progress,
        migrated=token.migrated,
        is_origin_strain=is_origin,
        is_dominant_strain=is_dominant,
        is_fastest_mutation=is_fastest,
        why_this_mutation_belongs=why,
        trading=TradingDTO(
            volume_24h_usd=float(trade.volume_24h_usd) if trade else 0.0,
            market_cap_usd=float(trade.market_cap_usd) if trade else 0.0,
            holders=int(trade.holders) if trade else 0,
            price_usd=float(trade.price_usd) if trade else 0.0,
            liquidity_usd=float(trade.liquidity_usd) if trade else 0.0,
            trades_24h=int(trade.trades_24h) if trade else 0,
        ),
        image_url=token.image_url,
        header_url=token.header_url,
        website_url=token.website_url,
        twitter_url=token.twitter_url,
        telegram_url=token.telegram_url,
        family=family_stub,
    )
