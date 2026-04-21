"""GET /wallet/{address}/dna - "what's your wallet's meme DNA?"

Reports every Four.Meme token we've ingested where the supplied EOA is the
deployer, plus the families those tokens belong to, plus quick stats.

We intentionally don't probe the chain for held-tokens (balanceOf scanning
is O(n) over our whole token set and ugly on public RPCs) - deployer
provenance is the richer signal for a "your launchpad portfolio" page.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_session
from ..ingestion.lazy import lazy_ingest_token  # noqa: F401 (imported for side-effect symmetry)
from ..models import DnaFamily, FamilyMutation, Token, TokenTrade

router = APIRouter(tags=["wallet"])


class WalletToken(BaseModel):
    token_address: str
    symbol: str
    name: str
    created_at: datetime
    bonding_progress: float
    migrated: bool
    price_usd: float = 0.0
    volume_24h_usd: float = 0.0
    liquidity_usd: float = 0.0
    holders: int = 0
    family_id: str | None = None
    family_title: str | None = None
    image_url: str | None = None
    header_url: str | None = None
    website_url: str | None = None
    twitter_url: str | None = None
    telegram_url: str | None = None


class WalletStats(BaseModel):
    tokens_deployed: int
    families_touched: int
    total_volume_24h_usd: float
    total_liquidity_usd: float
    migrated_count: int


class WalletDna(BaseModel):
    address: str
    stats: WalletStats
    deployed: list[WalletToken]
    fetched_at: datetime


@router.get("/wallet/{address}/dna", response_model=WalletDna)
def wallet_dna(address: str, session: Session = Depends(get_session)) -> WalletDna:
    addr = address.lower().strip()
    if not (addr.startswith("0x") and len(addr) == 42):
        raise HTTPException(status_code=400, detail="invalid wallet address")

    rows: list[dict[str, Any]] = []
    q = (
        select(Token, TokenTrade, FamilyMutation, DnaFamily)
        .outerjoin(TokenTrade, TokenTrade.token_address == Token.token_address)
        .outerjoin(
            FamilyMutation, FamilyMutation.token_address == Token.token_address
        )
        .outerjoin(DnaFamily, DnaFamily.id == FamilyMutation.family_id)
        .where(func.lower(Token.deployer) == addr)
        .order_by(Token.created_at.desc())
        .limit(500)
    )
    seen: dict[str, WalletToken] = {}
    for tok, trade, _mut, fam in session.execute(q).all():
        if tok.token_address in seen:
            continue
        seen[tok.token_address] = WalletToken(
            token_address=tok.token_address,
            symbol=tok.symbol,
            name=tok.name,
            created_at=tok.created_at,
            bonding_progress=float(tok.bonding_progress or 0.0),
            migrated=bool(tok.migrated),
            price_usd=float(trade.price_usd) if trade else 0.0,
            volume_24h_usd=float(trade.volume_24h_usd) if trade else 0.0,
            liquidity_usd=float(trade.liquidity_usd) if trade else 0.0,
            holders=int(trade.holders) if trade else 0,
            family_id=fam.id if fam else None,
            family_title=fam.event_title if fam else None,
            image_url=tok.image_url,
            header_url=tok.header_url,
            website_url=tok.website_url,
            twitter_url=tok.twitter_url,
            telegram_url=tok.telegram_url,
        )
        rows.append(seen[tok.token_address].model_dump())

    deployed = list(seen.values())
    stats = WalletStats(
        tokens_deployed=len(deployed),
        families_touched=len({d.family_id for d in deployed if d.family_id}),
        total_volume_24h_usd=sum(d.volume_24h_usd for d in deployed),
        total_liquidity_usd=sum(d.liquidity_usd for d in deployed),
        migrated_count=sum(1 for d in deployed if d.migrated),
    )
    return WalletDna(
        address=addr,
        stats=stats,
        deployed=deployed,
        fetched_at=datetime.utcnow(),
    )
