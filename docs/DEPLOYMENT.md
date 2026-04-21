# MemeDNA – Deployment

## 1. Prerequisites

* Docker 24+
* A BSC RPC endpoint (public `https://bsc-dataseed.bnbchain.org` works; QuickNode / Ankr
  recommended for production).
* OpenAI API key (any tier that allows embeddings + chat).
* Optional: Bitquery API key (https://bitquery.io), SerpAPI / Tavily key for web research.
* Optional: a BNB Chain EOA with some tBNB (testnet) to deploy `MemeDNARegistry.sol`.

## 2. Local / single-host

```bash
git clone <this-repo> memedna && cd memedna
cp .env.example .env
# edit .env with your keys

docker compose up -d postgres
docker compose run --rm api python -m scripts.bootstrap_db
docker compose up -d api scheduler
```

Logs:

```bash
docker compose logs -f api
docker compose logs -f scheduler
```

Bootstrapping data:

```bash
# pull last 24h of Four.Meme tokens from BSC + Bitquery
docker compose run --rm api python -m scripts.run_ingest --since-hours 24

# run one full AI pipeline pass
docker compose run --rm api python -m scripts.run_pipeline
```

## 3. Smart contract deployment (optional)

```bash
cd contracts
cp ../.env ./.env           # hardhat reads from this file
npm install
npx hardhat compile

# deploy to BSC testnet (chainId 97)
npx hardhat run scripts/deploy.js --network bsctestnet

# or to BSC mainnet
npx hardhat run scripts/deploy.js --network bsc
```

Copy the printed address into `.env` as `MEMEDNA_REGISTRY_ADDRESS=0x...` and restart the
API. The pipeline will start anchoring each finalised DNA family on-chain.

## 4. Production recommendations

* Front the API with a reverse proxy (Caddy or nginx) terminating TLS.
* Run Postgres with `shared_preload_libraries = 'vector'` already set (the
  `pgvector/pgvector:pg16` image does this).
* Pin the API to 1 replica or make the scheduler a leader-elected singleton
  (the pipeline takes an advisory lock `pg_try_advisory_lock(42)`).
* Configure log shipping (`loguru` writes JSON to stdout).
* Rotate OpenAI keys; set `OPENAI_BASE_URL` to a proxy if you want rate-limit control.

## 5. Health checks

* `GET /healthz`     – liveness (always 200 unless app crashed)
* `GET /readyz`      – readiness (DB ping + last successful pipeline run < 30 min old)

## 6. Backups

```bash
docker exec memedna-postgres pg_dump -U memedna memedna > backup_$(date +%F).sql
```

Embeddings can be regenerated from raw tokens, so only the `tokens`, `dna_families`,
`family_mutations`, `family_centers`, and `family_references` tables are strictly
irreplaceable.
