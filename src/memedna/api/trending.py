"""GET /trending-dna."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import DnaFamily
from ..schemas import TrendingItem, TrendingList

router = APIRouter(tags=["trending"])


@router.get("/trending-dna", response_model=TrendingList)
def trending_dna(
    limit: int = Query(10, ge=1, le=50),
    session: Session = Depends(get_session),
) -> TrendingList:
    rows = list(
        session.execute(
            select(DnaFamily)
            .where(DnaFamily.confidence_score >= 0.5)
            .order_by(DnaFamily.evolution_score.desc())
            .limit(limit)
        ).scalars().all()
    )
    return TrendingList(
        items=[
            TrendingItem(
                id=f.id,
                event_title=f.event_title,
                evolution_score=round(f.evolution_score, 2),
                mutations_count=f.mutations_count,
                total_volume_usd=round(f.total_volume_usd, 2),
            )
            for f in rows
        ]
    )
