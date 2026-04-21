"""GET /mutation/{token_address}."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from loguru import logger
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_session
from ..ingestion.lazy import lazy_ingest_token_sync
from ..models import DnaFamily, FamilyMutation, Token, TokenTrade
from ..pipeline.trade_refresh import maybe_refresh_stale_trade_sync
from ..schemas import MutationFamilyStub, MutationWithFamily, TradingDTO

router = APIRouter(tags=["mutations"])


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
        try:
            from ..ingestion.onchain import OnchainFourMemeClient

            dep = OnchainFourMemeClient().resolve_token_deployer(addr)
            if dep:
                token.deployer = dep
                session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.debug("deployer backfill skipped for {}: {}", addr, exc)

    trade = session.get(TokenTrade, addr)

    # Hot Four.Meme tokens pump/dump inside the scheduler's 2-5 minute
    # window. If the cached trade row is stale, pull live DexScreener
    # numbers synchronously — bounded timeout inside the helper means a
    # dead DexScreener can't stall the page.
    trade = maybe_refresh_stale_trade_sync(session, addr, trade)

    # DexScreener often sends liquidity=null for four.meme bonding pairs — if
    # the row is still zero after refresh, patch from on-chain ``funds``.
    if trade and float(trade.liquidity_usd or 0) <= 0:
        try:
            from ..ingestion.onchain import OnchainFourMemeClient

            est = OnchainFourMemeClient().estimate_bonding_liquidity_usd(addr)
            if est and est > 0:
                trade.liquidity_usd = float(est)
                session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.debug("bonding liquidity backfill skipped for {}: {}", addr, exc)

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
        created_at=token.created_at,
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
