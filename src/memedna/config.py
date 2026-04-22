"""Centralised settings for MemeDNA. Values come from environment / .env."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = Field("postgresql+psycopg://memedna:memedna@postgres:5432/memedna")

    @field_validator("database_url", mode="after")
    @classmethod
    def _normalize_database_url(cls, v: str) -> str:
        """Accept whatever Railway/Neon/Supabase hand out and coerce to psycopg3.

        Cloud providers usually emit `postgres://` or `postgresql://` URLs;
        SQLAlchemy with the pinned psycopg3 wheel requires `postgresql+psycopg://`.
        """
        if not v:
            return v
        if v.startswith("postgres://"):
            v = "postgresql://" + v[len("postgres://") :]
        if v.startswith("postgresql://"):
            v = "postgresql+psycopg://" + v[len("postgresql://") :]
        # Cloud providers (Railway, Neon, Supabase) require TLS. Add sslmode
        # automatically unless the user already set one, but skip for local dev.
        if "sslmode=" not in v and not any(h in v for h in ("@localhost", "@postgres:", "@127.0.0.1")):
            sep = "&" if "?" in v else "?"
            v = f"{v}{sep}sslmode=require"
        return v

    # ── Chat LLM (OpenAI-compatible: OpenAI, Groq, Together, Fireworks, Azure…) ──
    openai_api_key: str = Field("")
    openai_base_url: str = Field("https://api.openai.com/v1")
    openai_chat_model: str = Field("gpt-4o-mini")
    # Optional provider-specific knob, forwarded when the chat backend supports it
    # (e.g. Groq gpt-oss-120b accepts `reasoning_effort` = low|medium|high).
    openai_reasoning_effort: str = Field("")

    # ── Embeddings backend (can diverge from chat; Groq has no embeddings) ──
    # If left blank we auto-fill from OPENAI_* when the chat backend is the real
    # OpenAI platform, otherwise we fall back to a fully-local semantic hash.
    embeddings_api_key: str = Field("")
    embeddings_base_url: str = Field("")
    embeddings_model: str = Field("text-embedding-3-small")
    # Legacy alias kept for .env backwards-compat
    openai_embedding_model: str = Field("text-embedding-3-small")

    bitquery_api_key: str = Field("")
    bitquery_endpoint: str = Field("https://streaming.bitquery.io/eap")

    bsc_rpc_url: str = Field("https://bsc-dataseed.bnbchain.org")
    # Optional: full Alchemy (or any) BNB mainnet URL when the primary
    # (e.g. public) times out. Used by the on-chain client to switch over
    # without restarting the process. Set via BSC_RPC_FALLBACK_URL; never log.
    bsc_rpc_fallback_url: str = Field("")
    bsc_chain_id: int = Field(56)
    # Set to True when BSC_RPC_URL points to an archive-enabled node
    # (QuickNode, Alchemy, Ankr Premium, ...). Allows ``eth_getLogs`` and deployer
    # resolution to reach far enough into block history; public-RPC + pruned nodes
    # cannot. Free Etherscan API keys do not support BNB ``getLogs`` (chain 56) —
    # archive RPC is the practical way to backfill ``TokenCreate`` for old tokens.
    bsc_rpc_archive: bool = Field(False)
    # How many blocks the RPC really serves when NOT in archive mode. Public
    # endpoints usually keep logs for ~18h (~48k blocks at 1.2s). Raise this
    # only if you know the provider's retention window.
    bsc_rpc_safe_history_blocks: int = Field(48_000)
    # Per-call block-range upper bound when fanning out historical chunks.
    # Premium RPCs (QuickNode/Alchemy) tolerate 10k; public nodes ~4k.
    bsc_rpc_max_block_range: int = Field(4_000)
    fourmeme_token_manager: str = Field("0x5c952063c7fc8610FFDB798152D69F0B9550762b")
    fourmeme_factory_deploy_block: int = Field(38500000)

    memedna_registry_address: str = Field("")
    memedna_deployer_private_key: str = Field("")

    serpapi_api_key: str = Field("")
    tavily_api_key: str = Field("")
    # Jina Reader + Search (https://jina.ai). Free anonymous tier works;
    # set a key for higher rate limits. Agent-Reach-style keyless web eyes.
    jina_api_key: str = Field("")
    # BscScan API key - used to fetch holder counts and token info. Free tier:
    # https://bscscan.com/apis. Optional; holders stay 0 without it.
    bscscan_api_key: str = Field("")

    # The default is 720h (= 30 days) so cold starts grab a meaningful
    # historical window, and live runs catch up on anything missed. Set
    # FOURMEME_FULL_SCAN=1 or pass --all to the ingest CLI for a full
    # historical backfill.
    pipeline_lookback_hours: int = Field(720)
    pipeline_min_cluster_size: int = Field(2)
    pipeline_batch_size: int = Field(256)
    pipeline_interval_minutes: int = Field(5)
    # Cadence of the lightweight trade-data refresher (DexScreener only,
    # no LLM). Runs alongside the full pipeline so trade numbers stay
    # live even while a long enrichment tick is in progress.
    trade_refresh_interval_minutes: int = Field(2)
    # How stale a TokenTrade row is allowed to be before a user-facing
    # endpoint (mutation / lab-report) will do a synchronous refresh
    # before serving it. Keep this comfortably above
    # ``trade_refresh_interval_minutes`` so the background job does most
    # of the work and only "idle but suddenly hot" tokens fall through.
    trade_freshness_seconds: int = Field(180)
    # When True, on-chain ingest uses the last-scanned block stored in
    # `ingest_cursor` instead of `since_hours`, turning the pipeline into a
    # continuous incremental indexer. Default on.
    pipeline_incremental: bool = Field(True)
    # Hard cap on TokenCreate events pulled per ingest pass. Four.Meme
    # historically launches ~3k tokens/24h with bursts; keep real headroom
    # so incremental runs never get starved and a cold start over 30 days
    # can pull ~50k events in a single pass.
    pipeline_max_tokens_per_run: int = Field(60_000)
    # When the on-chain cursor is tens of thousands of blocks behind, scanning
    # the whole gap in a single list_new_tokens pass can take many minutes
    # (RPC get_logs) and monopolize CPU, threads, and DB time in the same
    # process as the API. Chunk so each scheduler tick only walks at most
    # this many blocks, advancing the cursor each time. Set 0 to disable
    # (one giant catch-up, not recommended in production on free RPCs).
    pipeline_incremental_max_blocks: int = Field(12_000)
    # Cluster acceptance: minimum LLM confidence to persist a DNA Family.
    # Lowered slightly so borderline-but-meaningful narratives survive and
    # we don't drop 60 % of candidates on a marginal confidence call.
    pipeline_min_confidence: float = Field(0.25)
    # DBSCAN cosine-distance threshold. Tightened from 0.42 -> 0.28 so the
    # embedding space doesn't collapse every animal-mascot meme into one
    # giant "Internet Mascot Meme Tokens" catch-all. With 0.28 we get more,
    # tighter clusters; the archetype sub-split pass in clustering.py
    # handles any residual over-grouping deterministically.
    pipeline_cluster_eps: float = Field(0.28)
    # How many candidate clusters to enrich per run. Raised because the
    # scheduler only runs every 5 min and Groq free-tier can absorb ~120
    # cluster-enrichments per pass when we serialize the LLM calls.
    pipeline_max_clusters_per_run: int = Field(140)

    api_host: str = Field("0.0.0.0")
    api_port: int = Field(8000)
    api_cors_origins: str = Field("*")
    memedna_admin_token: str = Field("changeme")

    log_level: str = Field("INFO")

    # ── Provider helpers ────────────────────────────────────────────────────
    @staticmethod
    def _is_real_key(k: str) -> bool:
        k = (k or "").strip()
        return bool(k) and k.lower() not in {"", "changeme", "sk-...", "replace_me"}

    @property
    def has_chat_llm(self) -> bool:
        """True whenever we have a usable OpenAI-compatible chat backend
        (OpenAI, Groq, Together, Fireworks, Azure, local vLLM, …)."""
        return self._is_real_key(self.openai_api_key)

    # Back-compat alias used by older modules
    @property
    def has_openai(self) -> bool:
        return self.has_chat_llm

    @property
    def is_groq(self) -> bool:
        return "groq.com" in (self.openai_base_url or "").lower()

    @property
    def has_embedding_llm(self) -> bool:
        """We need a genuine embeddings endpoint; Groq does not serve any.

        Priority order:
          1. Explicit EMBEDDINGS_API_KEY + EMBEDDINGS_BASE_URL.
          2. Real OpenAI platform via OPENAI_API_KEY (base URL hostname == api.openai.com).
        Otherwise we fall back to a fully-local semantic hash embedding.
        """
        if self._is_real_key(self.embeddings_api_key) and (
            self.embeddings_base_url or "https://api.openai.com/v1"
        ):
            return True
        if self.has_chat_llm and "api.openai.com" in (self.openai_base_url or ""):
            return True
        return False

    @property
    def resolved_embeddings_base_url(self) -> str:
        return self.embeddings_base_url or "https://api.openai.com/v1"

    @property
    def resolved_embeddings_api_key(self) -> str:
        if self._is_real_key(self.embeddings_api_key):
            return self.embeddings_api_key
        if "api.openai.com" in (self.openai_base_url or ""):
            return self.openai_api_key
        return ""

    @property
    def resolved_embeddings_model(self) -> str:
        return self.embeddings_model or self.openai_embedding_model

    @property
    def has_bitquery(self) -> bool:
        return bool(self.bitquery_api_key)

    @property
    def has_web_search(self) -> bool:
        """Tavily / SerpAPI / Jina (anonymous OK). We always have Jina."""
        return True

    @property
    def has_premium_web_search(self) -> bool:
        return bool(self.serpapi_api_key) or bool(self.tavily_api_key) or bool(
            self.jina_api_key
        )

    @property
    def has_registry(self) -> bool:
        return bool(self.memedna_registry_address) and bool(self.memedna_deployer_private_key)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
