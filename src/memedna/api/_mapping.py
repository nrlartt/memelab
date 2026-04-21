"""DB → DTO mapping helpers."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (
    DnaFamily,
    FamilyCenter,
    FamilyMutation,
    FamilyReference,
    FamilyTimeline,
    FamilyTimepoint,
    Token,
    TokenTrade,
)
from ..ai.research import WebResearcher
from ..schemas import (
    AIMetadata,
    CentersDTO,
    DnaFamilyDetail,
    DnaFamilySummary,
    EvolutionPoint,
    MutationDTO,
    ReferenceDTO,
    StrainRef,
    TimelinePoint,
    TradingDTO,
)


def _strain_ref(session: Session, addr: str | None) -> StrainRef | None:
    if not addr:
        return None
    tok = session.get(Token, addr)
    if not tok:
        return None
    return StrainRef(token=tok.token_address, symbol=tok.symbol)


def _centers_dto(center: FamilyCenter | None) -> CentersDTO:
    if center is None:
        return CentersDTO()
    return CentersDTO(
        source_center=center.source_value,
        source_url=center.source_url,
        entity_center=center.entity_value,
        geo_center=center.geo_value,
        community_center=center.community_value,
    )


def family_to_summary(session: Session, f: DnaFamily) -> DnaFamilySummary:
    """Single-family variant (used by the detail endpoint).

    For list endpoints, prefer `families_to_summaries` which batches the
    accessory fetches (centers / timepoints / strain tokens) into three
    queries total instead of N+1.
    """
    center = session.execute(
        select(FamilyCenter).where(FamilyCenter.family_id == f.id)
    ).scalar_one_or_none()
    spark_rows = list(
        session.execute(
            select(FamilyTimepoint.mutations)
            .where(FamilyTimepoint.family_id == f.id)
            .order_by(FamilyTimepoint.bucket.desc())
            .limit(12)
        ).scalars().all()
    )
    spark = [float(x or 0) for x in reversed(spark_rows)]
    return DnaFamilySummary(
        id=f.id,
        event_title=f.event_title,
        event_summary=f.event_summary,
        confidence_score=round(f.confidence_score, 3),
        mutations_count=f.mutations_count,
        total_volume_usd=round(f.total_volume_usd, 2),
        evolution_score=round(f.evolution_score, 2),
        origin_strain=_strain_ref(session, f.origin_strain),
        dominant_strain=_strain_ref(session, f.dominant_strain),
        fastest_mutation=_strain_ref(session, f.fastest_mutation),
        centers=_centers_dto(center),
        first_seen_at=f.first_seen_at,
        last_seen_at=f.last_seen_at,
        evolution_spark=spark,
    )


def families_to_summaries(
    session: Session, families: list[DnaFamily]
) -> list[DnaFamilySummary]:
    """Batch variant: 3 queries regardless of how many families come in.

    Previously the list endpoint did 2 lookups per family (center + last
    ~12 timepoints) plus up to 3 token.get calls per family for strain
    refs, meaning a 120-family page would issue ~600 sequential DB
    round-trips and routinely exceed 60 s. This helper batches all of
    them into `IN (...)` queries and resolves the rest in Python.
    """
    if not families:
        return []

    family_ids = [f.id for f in families]

    centers_rows = (
        session.execute(
            select(FamilyCenter).where(FamilyCenter.family_id.in_(family_ids))
        )
        .scalars()
        .all()
    )
    centers_by_fam: dict[str, FamilyCenter] = {c.family_id: c for c in centers_rows}

    # Pull timepoints sorted (family, bucket DESC) and keep the first 12
    # per family in Python - simpler and portable than a SQL window.
    tp_rows = session.execute(
        select(
            FamilyTimepoint.family_id,
            FamilyTimepoint.bucket,
            FamilyTimepoint.mutations,
        )
        .where(FamilyTimepoint.family_id.in_(family_ids))
        .order_by(FamilyTimepoint.family_id, FamilyTimepoint.bucket.desc())
    ).all()
    spark_by_fam: dict[str, list[float]] = {}
    for fam_id, _bucket, mutations in tp_rows:
        arr = spark_by_fam.setdefault(fam_id, [])
        if len(arr) < 12:
            arr.append(float(mutations or 0))
    for k in list(spark_by_fam.keys()):
        spark_by_fam[k] = list(reversed(spark_by_fam[k]))

    strain_addrs: set[str] = set()
    for f in families:
        for addr in (f.origin_strain, f.dominant_strain, f.fastest_mutation):
            if addr:
                strain_addrs.add(addr)
    tokens_by_addr: dict[str, Token] = {}
    if strain_addrs:
        tok_rows = (
            session.execute(
                select(Token).where(Token.token_address.in_(strain_addrs))
            )
            .scalars()
            .all()
        )
        tokens_by_addr = {t.token_address: t for t in tok_rows}

    def _strain(addr: str | None) -> StrainRef | None:
        if not addr:
            return None
        tok = tokens_by_addr.get(addr)
        if not tok:
            return None
        return StrainRef(token=tok.token_address, symbol=tok.symbol)

    out: list[DnaFamilySummary] = []
    for f in families:
        out.append(
            DnaFamilySummary(
                id=f.id,
                event_title=f.event_title,
                event_summary=f.event_summary,
                confidence_score=round(f.confidence_score, 3),
                mutations_count=f.mutations_count,
                total_volume_usd=round(f.total_volume_usd, 2),
                evolution_score=round(f.evolution_score, 2),
                origin_strain=_strain(f.origin_strain),
                dominant_strain=_strain(f.dominant_strain),
                fastest_mutation=_strain(f.fastest_mutation),
                centers=_centers_dto(centers_by_fam.get(f.id)),
                first_seen_at=f.first_seen_at,
                last_seen_at=f.last_seen_at,
                evolution_spark=spark_by_fam.get(f.id, []),
            )
        )
    return out


def family_to_detail(session: Session, f: DnaFamily) -> DnaFamilyDetail:
    summary = family_to_summary(session, f)

    refs = list(
        session.execute(
            select(FamilyReference)
            .where(FamilyReference.family_id == f.id)
            .order_by(FamilyReference.added_at)
        ).scalars().all()
    )
    timeline = list(
        session.execute(
            select(FamilyTimeline)
            .where(FamilyTimeline.family_id == f.id)
            .order_by(FamilyTimeline.position)
        ).scalars().all()
    )

    muts_rows = session.execute(
        select(FamilyMutation, Token, TokenTrade)
        .join(Token, Token.token_address == FamilyMutation.token_address)
        .outerjoin(TokenTrade, TokenTrade.token_address == Token.token_address)
        .where(FamilyMutation.family_id == f.id)
        .order_by(Token.created_at)
    ).all()

    mutations = [
        MutationDTO(
            token_address=t.token_address,
            symbol=t.symbol,
            name=t.name,
            description=t.description,
            created_at=t.created_at,
            deployer=t.deployer,
            bonding_progress=t.bonding_progress,
            migrated=t.migrated,
            is_origin_strain=m.is_origin_strain,
            is_dominant_strain=m.is_dominant_strain,
            is_fastest_mutation=m.is_fastest_mutation,
            why_this_mutation_belongs=m.why_this_mutation_belongs,
            trading=TradingDTO(
                volume_24h_usd=float(trade.volume_24h_usd) if trade else 0.0,
                market_cap_usd=float(trade.market_cap_usd) if trade else 0.0,
                holders=int(trade.holders) if trade else 0,
                price_usd=float(trade.price_usd) if trade else 0.0,
                liquidity_usd=float(trade.liquidity_usd) if trade else 0.0,
                trades_24h=int(trade.trades_24h) if trade else 0,
            ),
            image_url=t.image_url,
            header_url=t.header_url,
            website_url=t.website_url,
            twitter_url=t.twitter_url,
            telegram_url=t.telegram_url,
        )
        for (m, t, trade) in muts_rows
    ]

    curve_rows = list(
        session.execute(
            select(FamilyTimepoint)
            .where(FamilyTimepoint.family_id == f.id)
            .order_by(FamilyTimepoint.bucket)
        ).scalars().all()
    )

    research_provider: str | None = None
    try:
        research_provider = WebResearcher().provider
    except Exception:  # noqa: BLE001
        research_provider = None

    return DnaFamilyDetail(
        **summary.model_dump(),
        references=[
            ReferenceDTO(url=r.url, type=r.ref_type, title=r.title) for r in refs
        ],
        timeline_of_event=[TimelinePoint(at=p.at, event=p.event) for p in timeline],
        mutations=mutations,
        evolution_curve=[
            EvolutionPoint(t=p.bucket, mutations=p.mutations, volume_usd=p.volume_usd)
            for p in curve_rows
        ],
        onchain_tx_hash=f.onchain_tx_hash,
        ai=AIMetadata(
            model=f.llm_model,
            version=f.llm_version,
            reasoning=f.llm_reasoning,
            research_provider=research_provider,
            references_count=len(refs),
        ),
    )
