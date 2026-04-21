# MemeDNA – Architecture

## 1. System overview

MemeDNA is a batch-oriented event-intelligence system composed of five layers:

1. **Ingestion Layer** – pulls token-creation and trading data from Four.Meme on BNB Chain.
2. **Storage Layer** – PostgreSQL + `pgvector`, normalised schema for tokens, trades, families.
3. **AI Processing Pipeline** – embeddings → clustering → LLM validation → enrichment.
4. **Analytics Engine** – derives Origin, Dominant, Fastest strains and the Evolution Curve.
5. **Delivery Layer** – FastAPI REST + optional BNB Chain smart-contract anchoring.

```
                  ┌───────────────────────────┐
                  │  Four.Meme on BNB Chain   │
                  │  TokenManager2 contract   │
                  └────────────┬──────────────┘
                               │ logs / state
      ┌────────────────────────┼────────────────────────┐
      ▼                        ▼                        ▼
┌────────────┐          ┌─────────────┐          ┌───────────────┐
│ BSC RPC    │          │ Bitquery    │          │ Web research  │
│ (web3.py)  │          │ GraphQL EAP │          │ SerpAPI/Tavily│
└─────┬──────┘          └──────┬──────┘          └───────┬───────┘
      │                        │                         │
      └────────────┬───────────┘                         │
                   ▼                                     │
           ┌───────────────┐                             │
           │  Ingestion    │                             │
           │  Service      │                             │
           └───────┬───────┘                             │
                   ▼                                     │
           ┌───────────────┐                             │
           │   Postgres    │                             │
           │  + pgvector   │◄────────────────────────────┘
           └───────┬───────┘
                   ▼
           ┌───────────────┐
           │  AI Pipeline  │
           │ (APScheduler) │
           └───────┬───────┘
                   ▼
           ┌───────────────┐
           │  Analytics    │
           └───────┬───────┘
                   ▼
           ┌───────────────┐         ┌──────────────────────┐
           │  FastAPI      │────────►│ MemeDNARegistry.sol  │
           │  /dna-*       │         │   (BNB Chain)        │
           └───────────────┘         └──────────────────────┘
```

## 2. Data model (DNA abstraction)

All externally-exposed entities use the DNA vocabulary. Internally the schema is normalised:

| Internal table       | DNA meaning                   |
| -------------------- | ----------------------------- |
| `tokens`             | raw meme-token records        |
| `token_embeddings`   | vector per token              |
| `dna_families`       | cluster / real-world event    |
| `family_mutations`   | token ↔ family membership     |
| `family_centers`     | the 4 event centers           |
| `family_references`  | external URLs / sources       |
| `token_trades`       | aggregated trading stats      |
| `family_metrics`     | origin, dominant, fastest ids |
| `family_timepoints`  | evolution-curve samples       |
| `pipeline_runs`      | job audit log                 |

## 3. AI pipeline stages

Stage | Component | Input | Output
--- | --- | --- | ---
S1   | `ai.embeddings`   | name + symbol + description + time-of-day | 1536-d vector
S2   | `ai.clustering`   | vectors                                   | candidate clusters (HDBSCAN)
S3   | `ai.llm.validate` | cluster members                           | confirmed DNA family + confidence
S4   | `ai.centers`      | family + sample mutations                 | 4 centers (source/entity/geo/community)
S5   | `ai.research`     | centers + family                          | web references + timeline
S6   | `ai.enrichment`   | full family                               | title, summary, per-mutation reasoning
S7   | `analytics`       | family + trades                           | strains + evolution curve
S8   | `blockchain`      | final family digest                       | tx hash on BSC

Noise points (HDBSCAN label = -1) are kept as **singleton mutations** (unaffiliated) and
re-clustered on the next run.

## 4. Batching & scheduling

* `PIPELINE_INTERVAL_MINUTES` (default 5) controls APScheduler.
* Each run:
  1. incremental ingest (last `PIPELINE_LOOKBACK_HOURS` of Four.Meme tokens);
  2. embed only **new** tokens (content hash check);
  3. re-cluster last 24h tokens;
  4. enrich *changed* families only (dirty-flag).
* Runs are recorded in `pipeline_runs` with stage-level timings.

## 5. Caching

* `token_embeddings.content_hash` prevents re-embedding identical text.
* LLM calls cached by `(prompt_template_name, sha256(inputs))` via `lru_cache` / Postgres.
* Bitquery responses cached 60s to avoid hammering the quota.

## 6. Failure modes

* If OpenAI is unavailable: pipeline falls back to a deterministic MiniLM-style hash embedding
  (still runnable, lower quality) and marks the run as `degraded=true`.
* If Bitquery is unavailable: the on-chain RPC path (TokenManager2 event logs) is used as the
  authoritative source.
* All external calls use exponential-backoff retries via `tenacity`.
