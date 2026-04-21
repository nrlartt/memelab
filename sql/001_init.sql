-- MemeDNA schema. Runs automatically on first Postgres boot via docker-entrypoint-initdb.d.
-- Also invoked by scripts/bootstrap_db.py for manual setup.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── tokens ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tokens (
    token_address      TEXT PRIMARY KEY,
    chain_id           INTEGER      NOT NULL DEFAULT 56,
    symbol             TEXT         NOT NULL,
    name               TEXT         NOT NULL,
    description        TEXT         NOT NULL DEFAULT '',
    deployer           TEXT,
    created_at         TIMESTAMPTZ  NOT NULL,
    discovered_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    -- Four.Meme specific
    bonding_progress   DOUBLE PRECISION NOT NULL DEFAULT 0,
    migrated           BOOLEAN      NOT NULL DEFAULT false,
    launch_tx_hash     TEXT,
    source             TEXT         NOT NULL DEFAULT 'fourmeme',
    metadata_uri       TEXT,
    raw_metadata       JSONB        NOT NULL DEFAULT '{}'::jsonb,
    content_hash       TEXT         NOT NULL,
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_tokens_created_at    ON tokens (created_at DESC);
CREATE INDEX IF NOT EXISTS ix_tokens_symbol        ON tokens (symbol);
CREATE INDEX IF NOT EXISTS ix_tokens_content_hash  ON tokens (content_hash);
CREATE INDEX IF NOT EXISTS ix_tokens_chain         ON tokens (chain_id);

-- ─── token_trades (aggregated snapshots) ────────────────────────────────
CREATE TABLE IF NOT EXISTS token_trades (
    token_address   TEXT PRIMARY KEY REFERENCES tokens(token_address) ON DELETE CASCADE,
    volume_24h_usd  DOUBLE PRECISION NOT NULL DEFAULT 0,
    volume_total_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    market_cap_usd  DOUBLE PRECISION NOT NULL DEFAULT 0,
    liquidity_usd   DOUBLE PRECISION NOT NULL DEFAULT 0,
    holders         INTEGER          NOT NULL DEFAULT 0,
    trades_24h      INTEGER          NOT NULL DEFAULT 0,
    price_usd       DOUBLE PRECISION NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ      NOT NULL DEFAULT now()
);

-- ─── embeddings ─────────────────────────────────────────────────────────
-- 1536 = OpenAI text-embedding-3-small
CREATE TABLE IF NOT EXISTS token_embeddings (
    token_address   TEXT PRIMARY KEY REFERENCES tokens(token_address) ON DELETE CASCADE,
    model           TEXT          NOT NULL,
    content_hash    TEXT          NOT NULL,
    embedding       vector(1536)  NOT NULL,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_token_embeddings_vec
    ON token_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ─── dna_families ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dna_families (
    id                  TEXT PRIMARY KEY,
    event_title         TEXT         NOT NULL,
    event_summary       TEXT         NOT NULL,
    confidence_score    DOUBLE PRECISION NOT NULL DEFAULT 0,
    mutations_count     INTEGER      NOT NULL DEFAULT 0,
    total_volume_usd    DOUBLE PRECISION NOT NULL DEFAULT 0,
    evolution_score     DOUBLE PRECISION NOT NULL DEFAULT 0,
    origin_strain       TEXT REFERENCES tokens(token_address),
    dominant_strain     TEXT REFERENCES tokens(token_address),
    fastest_mutation    TEXT REFERENCES tokens(token_address),
    first_seen_at       TIMESTAMPTZ  NOT NULL,
    last_seen_at        TIMESTAMPTZ  NOT NULL,
    signature_vector    vector(1536),
    llm_model           TEXT,
    llm_version         TEXT,
    onchain_tx_hash     TEXT,
    dirty               BOOLEAN      NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_dna_families_evolution ON dna_families (evolution_score DESC);
CREATE INDEX IF NOT EXISTS ix_dna_families_last_seen ON dna_families (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS ix_dna_families_dirty     ON dna_families (dirty) WHERE dirty = true;

-- ─── family_mutations ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS family_mutations (
    family_id            TEXT NOT NULL REFERENCES dna_families(id) ON DELETE CASCADE,
    token_address        TEXT NOT NULL REFERENCES tokens(token_address) ON DELETE CASCADE,
    is_origin_strain     BOOLEAN NOT NULL DEFAULT false,
    is_dominant_strain   BOOLEAN NOT NULL DEFAULT false,
    is_fastest_mutation  BOOLEAN NOT NULL DEFAULT false,
    why_this_mutation_belongs TEXT NOT NULL DEFAULT '',
    assigned_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (family_id, token_address)
);

CREATE INDEX IF NOT EXISTS ix_family_mutations_token ON family_mutations (token_address);

-- ─── family_centers (4 event centers) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS family_centers (
    family_id     TEXT PRIMARY KEY REFERENCES dna_families(id) ON DELETE CASCADE,
    source_value  TEXT,
    source_url    TEXT,
    source_evidence TEXT,
    entity_value  TEXT,
    entity_evidence TEXT,
    geo_value     TEXT,
    geo_evidence  TEXT,
    community_value TEXT,
    community_evidence TEXT,
    extracted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── family_references ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS family_references (
    id          BIGSERIAL PRIMARY KEY,
    family_id   TEXT NOT NULL REFERENCES dna_families(id) ON DELETE CASCADE,
    url         TEXT NOT NULL,
    ref_type    TEXT NOT NULL DEFAULT 'other',
    title       TEXT,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (family_id, url)
);

CREATE INDEX IF NOT EXISTS ix_family_refs_family ON family_references (family_id);

-- ─── family_timeline ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS family_timeline (
    id          BIGSERIAL PRIMARY KEY,
    family_id   TEXT NOT NULL REFERENCES dna_families(id) ON DELETE CASCADE,
    at          TIMESTAMPTZ,
    event       TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS ix_family_timeline_family ON family_timeline (family_id, position);

-- ─── family_timepoints (evolution curve samples) ────────────────────────
CREATE TABLE IF NOT EXISTS family_timepoints (
    family_id     TEXT NOT NULL REFERENCES dna_families(id) ON DELETE CASCADE,
    bucket        TIMESTAMPTZ NOT NULL,
    mutations     INTEGER NOT NULL DEFAULT 0,
    volume_usd    DOUBLE PRECISION NOT NULL DEFAULT 0,
    PRIMARY KEY (family_id, bucket)
);

-- ─── pipeline_runs (audit log) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_runs (
    id              BIGSERIAL PRIMARY KEY,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ,
    status          TEXT        NOT NULL DEFAULT 'running',
    stages          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    tokens_ingested INTEGER     NOT NULL DEFAULT 0,
    families_updated INTEGER    NOT NULL DEFAULT 0,
    degraded        BOOLEAN     NOT NULL DEFAULT false,
    error           TEXT
);

-- ─── research_cache (LLM + web search) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS research_cache (
    cache_key   TEXT PRIMARY KEY,
    template    TEXT NOT NULL,
    version     TEXT NOT NULL,
    payload     JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── helper view: families with centers ─────────────────────────────────
CREATE OR REPLACE VIEW v_dna_family_full AS
SELECT
    f.*,
    c.source_value, c.source_url, c.source_evidence,
    c.entity_value, c.entity_evidence,
    c.geo_value, c.geo_evidence,
    c.community_value, c.community_evidence
FROM dna_families f
LEFT JOIN family_centers c ON c.family_id = f.id;
