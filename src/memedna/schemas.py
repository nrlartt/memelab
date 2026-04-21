"""Pydantic DTOs for the public API. Uses the DNA vocabulary exclusively."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class CentersDTO(BaseModel):
    source_center: str | None = None
    source_url: str | None = None
    entity_center: str | None = None
    geo_center: str | None = None
    community_center: str | None = None


class StrainRef(BaseModel):
    token: str
    symbol: str


class DnaFamilySummary(BaseModel):
    id: str
    event_title: str
    event_summary: str
    confidence_score: float
    mutations_count: int
    total_volume_usd: float
    evolution_score: float
    origin_strain: StrainRef | None = None
    dominant_strain: StrainRef | None = None
    fastest_mutation: StrainRef | None = None
    centers: CentersDTO = Field(default_factory=CentersDTO)
    first_seen_at: datetime
    last_seen_at: datetime
    # Tiny sparkline (last ~10 bucket mutation counts) so list cards can
    # render a visual trajectory without a second round-trip.
    evolution_spark: list[float] = Field(default_factory=list)


class DnaFamilyList(BaseModel):
    items: list[DnaFamilySummary]
    total: int
    limit: int
    offset: int


class ReferenceDTO(BaseModel):
    url: str
    type: str
    title: str | None = None


class TimelinePoint(BaseModel):
    at: datetime | None = None
    event: str


class TradingDTO(BaseModel):
    volume_24h_usd: float = 0.0
    market_cap_usd: float = 0.0
    holders: int = 0
    price_usd: float = 0.0
    liquidity_usd: float = 0.0
    trades_24h: int = 0


class MutationDTO(BaseModel):
    token_address: str
    symbol: str
    name: str
    description: str
    created_at: datetime
    deployer: str | None = None
    bonding_progress: float = 0.0
    migrated: bool = False
    is_origin_strain: bool = False
    is_dominant_strain: bool = False
    is_fastest_mutation: bool = False
    why_this_mutation_belongs: str = ""
    trading: TradingDTO = Field(default_factory=TradingDTO)
    # Brand media (see ``Token.image_url`` - populated by DexScreener).
    image_url: str | None = None
    header_url: str | None = None
    website_url: str | None = None
    twitter_url: str | None = None
    telegram_url: str | None = None


class EvolutionPoint(BaseModel):
    t: datetime
    mutations: int
    volume_usd: float


class AIMetadata(BaseModel):
    """Everything the AI stack contributed to this family.

    Surfaced in the UI so people can see *what* MemeDNA thinks and *why*.
    """

    model: str | None = None
    version: str | None = None
    reasoning: str | None = None
    research_provider: str | None = None
    references_count: int = 0


class DnaFamilyDetail(DnaFamilySummary):
    references: list[ReferenceDTO] = Field(default_factory=list)
    timeline_of_event: list[TimelinePoint] = Field(default_factory=list)
    mutations: list[MutationDTO] = Field(default_factory=list)
    evolution_curve: list[EvolutionPoint] = Field(default_factory=list)
    onchain_tx_hash: str | None = None
    ai: AIMetadata = Field(default_factory=AIMetadata)


class MutationWithFamily(MutationDTO):
    family: "MutationFamilyStub | None" = None


class MutationFamilyStub(BaseModel):
    id: str
    event_title: str


class TrendingItem(BaseModel):
    id: str
    event_title: str
    evolution_score: float
    mutations_count: int
    total_volume_usd: float


class TrendingList(BaseModel):
    items: list[TrendingItem]


class PipelineRunDTO(BaseModel):
    id: int
    started_at: datetime
    finished_at: datetime | None
    status: str
    stages: dict
    tokens_ingested: int
    families_updated: int
    degraded: bool
    error: str | None


class PipelineTriggerRequest(BaseModel):
    lookback_hours: int = 24
    force_recluster: bool = False


SortKey = Literal["evolution_score", "volume", "created_at", "mutations"]

MutationWithFamily.model_rebuild()
