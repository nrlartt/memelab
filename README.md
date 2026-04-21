# MemeLab

<p align="center">
  DNA intelligence · Four.Meme on BNB Chain · AI clustering · Next.js + FastAPI
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" /></a>
  <img src="https://img.shields.io/badge/python-3.11+-3776AB?logo=python&logoColor=white" alt="Python" />
  <img src="https://img.shields.io/badge/node-20+-339933?logo=nodedotjs&logoColor=white" alt="Node" />
  <img src="https://img.shields.io/badge/Next.js-15-black?logo=nextdotjs&logoColor=white" alt="Next.js" />
  <img src="https://img.shields.io/badge/FastAPI-0.115+-009688?logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/chain-BNB%20Smart%20Chain-F0B90B?logo=binance&logoColor=black" alt="BNB Chain" />
</p>

<p align="center">
  <a href="#documentation">Documentation</a> ·
  <a href="#architecture-high-level">Architecture</a> ·
  <a href="#core-runtime-flow">Runtime flow</a> ·
  <a href="#quickstart">Quickstart</a> ·
  <a href="#repository-layout">Layout</a>
</p>

---

## Documentation

- **In-app docs:** run the frontend and open `/docs` (MemeLab documentation hub).
- **Deep dives:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/API.md`](docs/API.md) · [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) · [`docs/AI_PROMPTS.md`](docs/AI_PROMPTS.md)
- **Repository:** [github.com/nrlartt/memelab](https://github.com/nrlartt/memelab)

---

MemeLab turns chaotic **Four.Meme** launches on **BNB Chain** into structured **DNA Families** (real-world event clusters), with embeddings, LLM validation, web research enrichment, trading analytics, and an optional on-chain registry anchor.

| Real-world idea | DNA model |
| ---------------- | --------- |
| Event / narrative cluster | **DNA Family** |
| One token | **Mutation** |
| First token in family | **Origin Strain** |
| Strongest market footprint | **Dominant Strain** |
| Fastest-moving mutant | **Fastest Mutation** |

---

## Architecture (high level)

System boundaries: ingestion from chain and vendors → PostgreSQL (+ pgvector) → AI batch pipeline → FastAPI → Next.js UI; optional smart-contract anchoring on BSC.

```mermaid
flowchart LR
  subgraph Client
    FE["Next.js UI\n(lab report, explorer, families)"]
  end

  subgraph API["FastAPI service"]
    REST["REST / JSON"]
    LAB["Lab report · mutations · trending"]
  end

  subgraph Data["PostgreSQL + pgvector"]
    DB[("tokens · families · trades\nembeddings · metrics")]
  end

  subgraph Ingest["Ingestion & pipeline"]
    RPC["BSC RPC · Four.Meme events"]
    BQ["Bitquery / optional indexers"]
    WR["Web research · embeddings"]
  end

  subgraph Chain["BNB Smart Chain"]
    FM["Four.Meme factory"]
    REG["MemeDNARegistry.sol\n(optional anchor)"]
  end

  FE -->|HTTPS| REST
  REST --> DB
  Ingest --> DB
  RPC --> FM
  WR --> DB
  LAB --> DB
  REST -.->|optional anchor| REG
```

For database schema detail and pipeline stages, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Core runtime flow

End-to-end path from new on-chain activity to UI-ready DNA artifacts: scheduled ingest → persist → AI pipeline batches → analytics strains → REST → clients.

```mermaid
sequenceDiagram
  autonumber
  participant Scheduler as APScheduler / cron
  participant Ingest as Ingestion service
  participant BSC as BNB Chain RPC
  participant DB as PostgreSQL
  participant Pipe as AI pipeline
  participant LLM as LLM + embeddings
  participant API as FastAPI
  participant UI as Next.js

  Scheduler->>Ingest: tick (e.g. every few minutes)
  Ingest->>BSC: fetch TokenCreate / logs
  BSC-->>Ingest: new token metadata
  Ingest->>DB: upsert tokens + trades
  Scheduler->>Pipe: run_pipeline job
  Pipe->>LLM: embed · cluster · validate families
  LLM-->>Pipe: DNA families + centers + reasoning
  Pipe->>DB: write families, mutations, metrics
  UI->>API: GET pages / lab-report / explorer
  API->>DB: query aggregates + detail
  DB-->>API: JSON facts + narratives
  API-->>UI: Hypermedia + AI lab reports
```

---

## Quickstart

```bash
cp .env.example .env
# Set OPENAI_API_KEY, BSC_RPC_URL, DATABASE_URL, etc.

docker compose up -d postgres
docker compose run --rm api python -m scripts.bootstrap_db
docker compose run --rm api python -m scripts.run_ingest --since-hours 24
docker compose run --rm api python -m scripts.run_pipeline
docker compose up api
# API: http://localhost:8000/docs

cd frontend && npm install && npm run dev
# UI: http://localhost:3000
```

Full production notes: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

---

## Repository layout

```
├── frontend/           # Next.js 15 · MemeLab UI
├── src/memedna/       # FastAPI app, ingestion, AI, pipeline
├── contracts/         # Solidity registry (Hardhat)
├── sql/              # Postgres bootstrap
├── docs/             # Architecture, API, deployment
├── scripts/          # CLI entrypoints
└── docker-compose.yml
```

---

## API snapshot

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/dna-families` | Paginated DNA families |
| GET | `/dna-family/{id}` | Family detail + strains |
| GET | `/mutation/{token}` | Token as mutation |
| POST | `/lab-report` | AI one-page lab report |

Complete list: [`docs/API.md`](docs/API.md).

---

## License

MIT — see [`LICENSE`](LICENSE).
