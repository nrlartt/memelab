"""Analytics engine for DNA families."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from loguru import logger
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ..models import (
    DnaFamily,
    FamilyMutation,
    FamilyTimepoint,
    Token,
    TokenTrade,
)


@dataclass
class StrainResult:
    origin_strain: str | None
    dominant_strain: str | None
    fastest_mutation: str | None
    total_volume_usd: float
    evolution_score: float
    first_seen_at: datetime
    last_seen_at: datetime


def _fastest(token: Token, trade: TokenTrade | None) -> float:
    """Velocity score: volume per hour since launch."""
    if not trade or trade.volume_24h_usd <= 0:
        return 0.0
    age_hours = max(
        (datetime.now(tz=timezone.utc) - token.created_at).total_seconds() / 3600.0, 0.5
    )
    return trade.volume_24h_usd / age_hours


def compute_family_strains(session: Session, family: DnaFamily) -> StrainResult:
    rows = session.execute(
        select(Token, TokenTrade)
        .join(FamilyMutation, FamilyMutation.token_address == Token.token_address)
        .outerjoin(TokenTrade, TokenTrade.token_address == Token.token_address)
        .where(FamilyMutation.family_id == family.id)
    ).all()
    if not rows:
        return StrainResult(None, None, None, 0.0, 0.0, family.first_seen_at, family.last_seen_at)

    origin: Token = min(rows, key=lambda r: r[0].created_at)[0]
    dominant_token = None
    dominant_score = -math.inf
    fastest_token = None
    fastest_score = -math.inf
    total_volume = 0.0
    first_seen = min(r[0].created_at for r in rows)
    last_seen = max(r[0].created_at for r in rows)

    for token, trade in rows:
        mcap = trade.market_cap_usd if trade else 0.0
        liq = trade.liquidity_usd if trade else 0.0
        vol = trade.volume_24h_usd if trade else 0.0
        total_volume += vol
        dom_score = max(mcap, liq, vol)
        if dom_score > dominant_score:
            dominant_score = dom_score
            dominant_token = token
        fast = _fastest(token, trade)
        if fast > fastest_score:
            fastest_score = fast
            fastest_token = token

    mutations_count = len(rows)
    growth_component = math.log1p(mutations_count) * 10.0
    velocity_component = math.log1p(fastest_score) * 5.0
    volume_component = math.log1p(total_volume) * 4.0
    evolution_score = round(growth_component + velocity_component + volume_component, 2)

    return StrainResult(
        origin_strain=origin.token_address,
        dominant_strain=(dominant_token.token_address if dominant_token else None),
        fastest_mutation=(fastest_token.token_address if fastest_token else None),
        total_volume_usd=round(total_volume, 2),
        evolution_score=evolution_score,
        first_seen_at=first_seen,
        last_seen_at=last_seen,
    )


def apply_strains(session: Session, family: DnaFamily, result: StrainResult) -> None:
    family.origin_strain = result.origin_strain
    family.dominant_strain = result.dominant_strain
    family.fastest_mutation = result.fastest_mutation
    family.total_volume_usd = result.total_volume_usd
    family.evolution_score = result.evolution_score
    family.first_seen_at = result.first_seen_at
    family.last_seen_at = result.last_seen_at

    session.execute(
        FamilyMutation.__table__.update()
        .where(FamilyMutation.__table__.c.family_id == family.id)
        .values(is_origin_strain=False, is_dominant_strain=False, is_fastest_mutation=False)
    )
    for col, addr in [
        ("is_origin_strain", result.origin_strain),
        ("is_dominant_strain", result.dominant_strain),
        ("is_fastest_mutation", result.fastest_mutation),
    ]:
        if addr:
            session.execute(
                FamilyMutation.__table__.update()
                .where(FamilyMutation.__table__.c.family_id == family.id)
                .where(FamilyMutation.__table__.c.token_address == addr)
                .values({col: True})
            )


def compute_evolution_curve(
    session: Session,
    family: DnaFamily,
    bucket_minutes: int = 60,
    max_points: int = 48,
) -> None:
    rows = session.execute(
        select(Token.created_at, TokenTrade.volume_24h_usd)
        .join(FamilyMutation, FamilyMutation.token_address == Token.token_address)
        .outerjoin(TokenTrade, TokenTrade.token_address == Token.token_address)
        .where(FamilyMutation.family_id == family.id)
    ).all()
    if not rows:
        return

    start = family.first_seen_at.replace(minute=0, second=0, microsecond=0)
    end = family.last_seen_at
    if end <= start:
        end = start + timedelta(minutes=bucket_minutes)
    buckets: dict[datetime, dict[str, float]] = {}
    for ts, vol in rows:
        b = start + timedelta(
            minutes=((ts - start).total_seconds() // 60) // bucket_minutes * bucket_minutes
        )
        slot = buckets.setdefault(b, {"count": 0, "volume": 0.0})
        slot["count"] += 1
        slot["volume"] += float(vol or 0.0)

    session.execute(delete(FamilyTimepoint).where(FamilyTimepoint.family_id == family.id))
    sorted_buckets = sorted(buckets.items())[:max_points]
    running_mut = 0
    running_vol = 0.0
    for b, slot in sorted_buckets:
        running_mut += int(slot["count"])
        running_vol += float(slot["volume"])
        session.execute(
            pg_insert(FamilyTimepoint.__table__)
            .values(
                family_id=family.id,
                bucket=b,
                mutations=running_mut,
                volume_usd=round(running_vol, 2),
            )
            .on_conflict_do_update(
                index_elements=["family_id", "bucket"],
                set_={"mutations": running_mut, "volume_usd": round(running_vol, 2)},
            )
        )


def refresh_family_metrics(session: Session, family: DnaFamily) -> None:
    """Wire strains + evolution curve for a single family."""
    logger.debug("Refreshing analytics for family {}", family.id)
    result = compute_family_strains(session, family)
    apply_strains(session, family, result)
    compute_evolution_curve(session, family)
    family.dirty = False
    family.updated_at = datetime.utcnow()
