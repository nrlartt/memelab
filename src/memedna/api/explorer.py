"""GET /explorer/tokens - paginated grid-friendly token browser.

Feeds the /explorer page on the frontend. Treats every ingested Four.Meme
token as a first-class object, even when it isn't clustered yet. Supports
filter chips: migrated-only, has-liquidity, price-sort, volume-sort,
fresh (< 24h), address / symbol search.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import DnaFamily, FamilyMutation, Token, TokenTrade

router = APIRouter(tags=["explorer"])

SortKey = Literal["newest", "volume", "liquidity", "migrated", "price"]


class ExplorerToken(BaseModel):
    token_address: str
    symbol: str
    name: str
    created_at: datetime
    bonding_progress: float
    migrated: bool
    price_usd: float = 0.0
    volume_24h_usd: float = 0.0
    liquidity_usd: float = 0.0
    trades_24h: int = 0
    holders: int = 0
    family_id: str | None = None
    family_title: str | None = None
    # Brand media - lets the frontend render a real token avatar instead
    # of the "first 3 letters" placeholder. Populated by the DexScreener
    # refresh loop; null when no pair has ``info.imageUrl`` yet.
    image_url: str | None = None
    header_url: str | None = None
    website_url: str | None = None
    twitter_url: str | None = None
    telegram_url: str | None = None


class ExplorerResponse(BaseModel):
    items: list[ExplorerToken]
    total: int
    limit: int
    offset: int


@router.get("/explorer/tokens", response_model=ExplorerResponse)
def explorer_tokens(
    limit: int = Query(48, ge=1, le=120),
    offset: int = Query(0, ge=0),
    q: str | None = Query(None, description="symbol, name, or address"),
    sort: SortKey = Query("volume"),
    migrated: bool | None = Query(None),
    fresh_24h: bool = Query(False),
    min_liquidity: float = Query(0.0, ge=0.0),
    session: Session = Depends(get_session),
) -> ExplorerResponse:
    base = (
        select(Token, TokenTrade)
        .outerjoin(TokenTrade, TokenTrade.token_address == Token.token_address)
    )

    where = []
    if q:
        s = q.strip().lower()
        like = f"%{s}%"
        if s.startswith("0x") and len(s) == 42:
            where.append(Token.token_address == s)
        else:
            where.append(
                or_(
                    func.lower(Token.symbol).like(like),
                    func.lower(Token.name).like(like),
                )
            )
    if migrated is True:
        where.append(Token.migrated == True)  # noqa: E712
    elif migrated is False:
        where.append(Token.migrated == False)  # noqa: E712
    if fresh_24h:
        where.append(
            Token.created_at >= datetime.utcnow() - timedelta(hours=24)
        )
    if min_liquidity > 0:
        where.append(TokenTrade.liquidity_usd >= min_liquidity)

    for w in where:
        base = base.where(w)

    if sort == "newest":
        base = base.order_by(Token.created_at.desc())
    elif sort == "volume":
        base = base.order_by(TokenTrade.volume_24h_usd.desc().nullslast())
    elif sort == "liquidity":
        base = base.order_by(TokenTrade.liquidity_usd.desc().nullslast())
    elif sort == "price":
        base = base.order_by(TokenTrade.price_usd.desc().nullslast())
    elif sort == "migrated":
        base = base.order_by(
            Token.migrated.desc(), TokenTrade.liquidity_usd.desc().nullslast()
        )

    count_q = select(func.count(Token.token_address)).select_from(
        Token.__table__.outerjoin(
            TokenTrade.__table__,
            TokenTrade.token_address == Token.token_address,
        )
    )
    for w in where:
        count_q = count_q.where(w)
    total = int(session.execute(count_q).scalar_one() or 0)

    rows = list(session.execute(base.limit(limit).offset(offset)).all())
    addrs = [r[0].token_address for r in rows]

    family_map: dict[str, tuple[str, str]] = {}
    if addrs:
        fam_rows = session.execute(
            select(FamilyMutation.token_address, DnaFamily.id, DnaFamily.event_title)
            .join(DnaFamily, DnaFamily.id == FamilyMutation.family_id)
            .where(FamilyMutation.token_address.in_(addrs))
        ).all()
        for addr, fid, title in fam_rows:
            family_map[addr] = (fid, title)

    items = [
        ExplorerToken(
            token_address=tok.token_address,
            symbol=tok.symbol,
            name=tok.name,
            created_at=tok.created_at,
            bonding_progress=float(tok.bonding_progress or 0),
            migrated=bool(tok.migrated),
            price_usd=float(trade.price_usd) if trade else 0.0,
            volume_24h_usd=float(trade.volume_24h_usd) if trade else 0.0,
            liquidity_usd=float(trade.liquidity_usd) if trade else 0.0,
            trades_24h=int(trade.trades_24h) if trade else 0,
            holders=int(trade.holders) if trade else 0,
            family_id=family_map.get(tok.token_address, (None, None))[0],
            family_title=family_map.get(tok.token_address, (None, None))[1],
            image_url=tok.image_url,
            header_url=tok.header_url,
            website_url=tok.website_url,
            twitter_url=tok.twitter_url,
            telegram_url=tok.telegram_url,
        )
        for tok, trade in rows
    ]
    return ExplorerResponse(items=items, total=total, limit=limit, offset=offset)
