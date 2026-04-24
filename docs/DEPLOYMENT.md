# MemeDNA – Deployment

## 1. Prerequisites

* Docker 24+
* A BSC RPC endpoint (public `https://bsc-dataseed.bnbchain.org` works; QuickNode / Ankr
  recommended for production). Set `BSC_QUICKNODE_URL` to your full QuickNode HTTPS
  URL if you use it so it is always **first** in the client chain (a missing
  `BSC_RPC_URL` in the host environment otherwise falls back to a public default).
* OpenAI API key (any tier that allows embeddings + chat).
* Optional: Bitquery API key (https://bitquery.io), SerpAPI / Tavily key for web research.
* Optional: a BNB Chain EOA with some tBNB (testnet) to deploy `MemeDNARegistry.sol`.

## 2. Local / single-host

```bash
git clone https://github.com/nrlartt/memelab.git memelab && cd memelab
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
* Multiple API replicas are OK: **ingest** uses advisory lock `41` and the
  heavy **LLM pipeline** uses lock `42`, so one replica can index new on-chain
  tokens while another runs clustering. Still avoid running the embedded API
  scheduler and a separate `scheduler` container *both* with duplicate cadence
  on the same DB unless you intend double timer frequency.
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
