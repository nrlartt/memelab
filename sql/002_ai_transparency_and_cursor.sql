-- Migration 002: AI transparency + incremental ingest cursor.

-- Store the LLM's reasoning for each DNA Family so the UI can explain
-- "why MemeDNA thinks these tokens are the same event".
ALTER TABLE dna_families ADD COLUMN IF NOT EXISTS llm_reasoning TEXT;

-- Incremental ingest state: remembers how far we've scanned on each
-- (source, chain) pair. Scheduler only pulls new blocks after `last_block`.
CREATE TABLE IF NOT EXISTS ingest_cursors (
    source      TEXT        NOT NULL,
    chain_id    INTEGER     NOT NULL DEFAULT 56,
    last_block  BIGINT      NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source, chain_id)
);

-- Helpful composite index for family listing (confidence + mutation count).
CREATE INDEX IF NOT EXISTS ix_dna_families_conf_mut
    ON dna_families (confidence_score DESC, mutations_count DESC);

-- Volume sort index.
CREATE INDEX IF NOT EXISTS ix_dna_families_volume
    ON dna_families (total_volume_usd DESC);

-- Recompute helpful index on trades for analytics joins.
CREATE INDEX IF NOT EXISTS ix_token_trades_volume ON token_trades (volume_24h_usd DESC);
CREATE INDEX IF NOT EXISTS ix_token_trades_liquidity ON token_trades (liquidity_usd DESC);
