"""SQLAlchemy ORM models mirroring sql/001_init.sql."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Token(Base):
    __tablename__ = "tokens"

    token_address: Mapped[str] = mapped_column(String, primary_key=True)
    chain_id: Mapped[int] = mapped_column(Integer, default=56, nullable=False)
    symbol: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    deployer: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    discovered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    bonding_progress: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    migrated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    launch_tx_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    source: Mapped[str] = mapped_column(String, nullable=False, default="fourmeme")
    metadata_uri: Mapped[str | None] = mapped_column(String, nullable=True)
    raw_metadata: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    content_hash: Mapped[str] = mapped_column(String, nullable=False)
    # Rich media & socials - sourced primarily from DexScreener's free
    # ``info`` block (``imageUrl`` / ``header`` / ``openGraph`` /
    # ``websites`` / ``socials``). Falls back to ``raw_metadata`` from
    # Bitquery / on-chain when DexScreener has no pair yet. Nullable so
    # tokens that exist on-chain but haven't surfaced on any DEX still
    # write without failing the ingest.
    image_url: Mapped[str | None] = mapped_column(String, nullable=True)
    header_url: Mapped[str | None] = mapped_column(String, nullable=True)
    website_url: Mapped[str | None] = mapped_column(String, nullable=True)
    twitter_url: Mapped[str | None] = mapped_column(String, nullable=True)
    telegram_url: Mapped[str | None] = mapped_column(String, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class TokenTrade(Base):
    __tablename__ = "token_trades"

    token_address: Mapped[str] = mapped_column(
        String, ForeignKey("tokens.token_address", ondelete="CASCADE"), primary_key=True
    )
    volume_24h_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    volume_total_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    market_cap_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    liquidity_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    holders: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    trades_24h: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    price_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class TokenEmbedding(Base):
    __tablename__ = "token_embeddings"

    token_address: Mapped[str] = mapped_column(
        String, ForeignKey("tokens.token_address", ondelete="CASCADE"), primary_key=True
    )
    model: Mapped[str] = mapped_column(String, nullable=False)
    content_hash: Mapped[str] = mapped_column(String, nullable=False)
    embedding: Mapped[list[float]] = mapped_column(Vector(1536), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class DnaFamily(Base):
    __tablename__ = "dna_families"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    event_title: Mapped[str] = mapped_column(String, nullable=False)
    event_summary: Mapped[str] = mapped_column(Text, nullable=False)
    confidence_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    mutations_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_volume_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    evolution_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    origin_strain: Mapped[str | None] = mapped_column(
        String, ForeignKey("tokens.token_address"), nullable=True
    )
    dominant_strain: Mapped[str | None] = mapped_column(
        String, ForeignKey("tokens.token_address"), nullable=True
    )
    fastest_mutation: Mapped[str | None] = mapped_column(
        String, ForeignKey("tokens.token_address"), nullable=True
    )
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    signature_vector: Mapped[list[float] | None] = mapped_column(Vector(1536), nullable=True)
    llm_model: Mapped[str | None] = mapped_column(String, nullable=True)
    llm_version: Mapped[str | None] = mapped_column(String, nullable=True)
    llm_reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    onchain_tx_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    dirty: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    mutations: Mapped[list["FamilyMutation"]] = relationship(
        back_populates="family", cascade="all, delete-orphan"
    )
    centers: Mapped["FamilyCenter | None"] = relationship(
        back_populates="family", cascade="all, delete-orphan", uselist=False
    )
    references: Mapped[list["FamilyReference"]] = relationship(
        back_populates="family", cascade="all, delete-orphan"
    )
    timeline: Mapped[list["FamilyTimeline"]] = relationship(
        back_populates="family", cascade="all, delete-orphan"
    )
    timepoints: Mapped[list["FamilyTimepoint"]] = relationship(
        back_populates="family", cascade="all, delete-orphan"
    )


class FamilyMutation(Base):
    __tablename__ = "family_mutations"

    family_id: Mapped[str] = mapped_column(
        String, ForeignKey("dna_families.id", ondelete="CASCADE"), primary_key=True
    )
    token_address: Mapped[str] = mapped_column(
        String, ForeignKey("tokens.token_address", ondelete="CASCADE"), primary_key=True
    )
    is_origin_strain: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_dominant_strain: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_fastest_mutation: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    why_this_mutation_belongs: Mapped[str] = mapped_column(Text, nullable=False, default="")
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    family: Mapped[DnaFamily] = relationship(back_populates="mutations")


class FamilyCenter(Base):
    __tablename__ = "family_centers"

    family_id: Mapped[str] = mapped_column(
        String, ForeignKey("dna_families.id", ondelete="CASCADE"), primary_key=True
    )
    source_value: Mapped[str | None] = mapped_column(String, nullable=True)
    source_url: Mapped[str | None] = mapped_column(String, nullable=True)
    source_evidence: Mapped[str | None] = mapped_column(Text, nullable=True)
    entity_value: Mapped[str | None] = mapped_column(String, nullable=True)
    entity_evidence: Mapped[str | None] = mapped_column(Text, nullable=True)
    geo_value: Mapped[str | None] = mapped_column(String, nullable=True)
    geo_evidence: Mapped[str | None] = mapped_column(Text, nullable=True)
    community_value: Mapped[str | None] = mapped_column(String, nullable=True)
    community_evidence: Mapped[str | None] = mapped_column(Text, nullable=True)
    extracted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    family: Mapped[DnaFamily] = relationship(back_populates="centers")


class FamilyReference(Base):
    __tablename__ = "family_references"
    __table_args__ = (UniqueConstraint("family_id", "url", name="uq_family_refs"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    family_id: Mapped[str] = mapped_column(
        String, ForeignKey("dna_families.id", ondelete="CASCADE"), nullable=False
    )
    url: Mapped[str] = mapped_column(String, nullable=False)
    ref_type: Mapped[str] = mapped_column(String, nullable=False, default="other")
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    family: Mapped[DnaFamily] = relationship(back_populates="references")


class FamilyTimeline(Base):
    __tablename__ = "family_timeline"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    family_id: Mapped[str] = mapped_column(
        String, ForeignKey("dna_families.id", ondelete="CASCADE"), nullable=False
    )
    at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    event: Mapped[str] = mapped_column(Text, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    family: Mapped[DnaFamily] = relationship(back_populates="timeline")


class FamilyTimepoint(Base):
    __tablename__ = "family_timepoints"

    family_id: Mapped[str] = mapped_column(
        String, ForeignKey("dna_families.id", ondelete="CASCADE"), primary_key=True
    )
    bucket: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    mutations: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    volume_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    family: Mapped[DnaFamily] = relationship(back_populates="timepoints")


class PipelineRun(Base):
    __tablename__ = "pipeline_runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="running")
    stages: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    tokens_ingested: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    families_updated: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    degraded: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class IngestCursor(Base):
    """Tracks the last block we've scanned on each (chain, source) pair.

    Lets the scheduler run every few minutes and only pull *new* blocks,
    instead of re-scanning the last N hours every time.
    """

    __tablename__ = "ingest_cursors"

    source: Mapped[str] = mapped_column(String, primary_key=True)
    chain_id: Mapped[int] = mapped_column(Integer, primary_key=True, default=56)
    last_block: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class ResearchCache(Base):
    __tablename__ = "research_cache"

    cache_key: Mapped[str] = mapped_column(String, primary_key=True)
    template: Mapped[str] = mapped_column(String, nullable=False)
    version: Mapped[str] = mapped_column(String, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
