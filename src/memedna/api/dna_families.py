"""GET /dna-families and /dna-family/{id}."""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import DnaFamily, FamilyMutation, Token
from ..schemas import DnaFamilyDetail, DnaFamilyList, SortKey
from ._mapping import families_to_summaries, family_to_detail

router = APIRouter(tags=["dna-families"])

# Tiny in-process cache for list-endpoint responses. We only cache the
# hot, "no search query" shape - that's what the overview and /families
# pages hit repeatedly. The TTL matches the 20s freshness budget the UI
# already advertises, so stale data is never user-visible.
_LIST_CACHE: dict[tuple, tuple[float, DnaFamilyList]] = {}
_LIST_CACHE_TTL_S = 20.0
_LIST_CACHE_MAX = 32


@router.get("/dna-families", response_model=DnaFamilyList)
def list_dna_families(
    limit: int = Query(24, ge=1, le=500),
    offset: int = Query(0, ge=0),
    # Accept anything the LLM or heuristic produced; UI can tighten later.
    min_confidence: float = Query(0.3, ge=0.0, le=1.0),
    min_mutations: int = Query(2, ge=1),
    sort: SortKey = Query("evolution_score"),
    q: str | None = Query(None, description="Fuzzy search on title/summary"),
    session: Session = Depends(get_session),
) -> DnaFamilyList:
    cache_key: tuple | None = None
    if not q:
        cache_key = (limit, offset, round(min_confidence, 3), min_mutations, str(sort))
        hit = _LIST_CACHE.get(cache_key)
        if hit and time.monotonic() - hit[0] < _LIST_CACHE_TTL_S:
            return hit[1]

    where_clauses = [
        DnaFamily.confidence_score >= min_confidence,
        DnaFamily.mutations_count >= min_mutations,
    ]
    if q:
        q_stripped = q.strip()
        like = f"%{q_stripped}%"
        # If the query looks like a token address (0x + 40 hex), we need to
        # join through FamilyMutation so families that *contain* the token
        # show up even when the title/summary doesn't mention it.
        is_addr = (
            q_stripped.startswith("0x")
            and len(q_stripped) == 42
            and all(c in "0123456789abcdefABCDEF" for c in q_stripped[2:])
        )
        if is_addr:
            addr_lc = q_stripped.lower()
            member_subq = (
                select(FamilyMutation.family_id)
                .where(FamilyMutation.token_address == addr_lc)
            )
            where_clauses.append(DnaFamily.id.in_(member_subq))
        else:
            # Full-text-ish search across family text + member tokens' symbol/name.
            token_subq = (
                select(FamilyMutation.family_id)
                .join(Token, Token.token_address == FamilyMutation.token_address)
                .where(or_(Token.symbol.ilike(like), Token.name.ilike(like)))
            )
            where_clauses.append(
                or_(
                    DnaFamily.event_title.ilike(like),
                    DnaFamily.event_summary.ilike(like),
                    DnaFamily.id.in_(token_subq),
                )
            )

    base = select(DnaFamily)
    for w in where_clauses:
        base = base.where(w)
    if sort == "evolution_score":
        base = base.order_by(DnaFamily.evolution_score.desc(), DnaFamily.mutations_count.desc())
    elif sort == "volume":
        base = base.order_by(DnaFamily.total_volume_usd.desc())
    elif sort == "mutations":
        base = base.order_by(DnaFamily.mutations_count.desc())
    else:
        base = base.order_by(DnaFamily.first_seen_at.desc())

    count_q = select(func.count(DnaFamily.id))
    for w in where_clauses:
        count_q = count_q.where(w)
    total = session.execute(count_q).scalar_one()

    rows = list(session.execute(base.limit(limit).offset(offset)).scalars().all())
    resp = DnaFamilyList(
        items=families_to_summaries(session, rows),
        total=int(total or 0),
        limit=limit,
        offset=offset,
    )
    if cache_key is not None:
        if len(_LIST_CACHE) >= _LIST_CACHE_MAX:
            # Evict oldest entry. This is O(n) but n is bounded at 32.
            oldest = min(_LIST_CACHE.items(), key=lambda kv: kv[1][0])[0]
            _LIST_CACHE.pop(oldest, None)
        _LIST_CACHE[cache_key] = (time.monotonic(), resp)
    return resp


@router.get("/dna-family/{family_id}", response_model=DnaFamilyDetail)
def get_dna_family(family_id: str, session: Session = Depends(get_session)) -> DnaFamilyDetail:
    fam = session.get(DnaFamily, family_id)
    if not fam:
        raise HTTPException(status_code=404, detail=f"DNA Family '{family_id}' does not exist")
    return family_to_detail(session, fam)
