# Keeping MemeDNA ingestion always-on

MemeDNA's scheduler (`memedna.pipeline.scheduler`) is what continuously
catches the **latest Four.Meme tokens**. It wakes up every
`PIPELINE_INTERVAL_MINUTES` (default: 5) and runs the full
`ingest → embed → cluster → validate → enrich → analyse → anchor`
pipeline, advancing the `IngestCursor` so each run only scans *new* blocks.

**Multi-replica note:** on-chain ingest holds advisory lock **41**; the expensive
LLM stages hold lock **42**. That way a second API instance can still pull new
tokens even while the first is busy enriching — a common cause of a "stuck"
indexed token count when only one global lock was used before.

**Head pass:** each normal ingest also merges a **newest-first** scan of the last
``INGEST_HEAD_BLOCKS`` (default 6000 ≈ ~2 h on BSC), matching the admin
``/internal/ingest/quick`` head step. Set ``INGEST_HEAD_BLOCKS=0`` only to save RPC
if you are sure the incremental cursor alone is enough.

If nothing new shows up in the Explorer or Lab Reports, the scheduler is
almost certainly not running. This doc lists the three recommended ways to
keep it alive on Windows.

## Quick one-shot (manual)

```powershell
pwsh .\scripts\ingest_latest.ps1 -SinceHours 2 -MaxTokens 1500
```

This calls `POST /internal/ingest/quick` if the API is up (fast, 10-30 s,
no LLM / clustering). Otherwise it falls back to in-process
`scripts/run_ingest.py`. Good for a one-off "catch up now" poke.

## Option A — Windows Task Scheduler (recommended, no admin)

Runs the scheduler process at logon/boot and restarts it on crash.

### 1. One-time setup

Edit `scripts\TaskScheduler_Scheduler.xml` and replace
`CHANGE_ME_USERNAME` with your Windows user (e.g. `DESKTOP-XYZ\user`).
Do the same for `scripts\TaskScheduler_IngestLatest.xml` if you want a
*second* task that pings `ingest_latest.ps1` every 5 minutes as a safety
net.

### 2. Import the tasks

```powershell
# Long-running scheduler (ideal)
schtasks /Create /TN "MemeDNA Pipeline Scheduler" `
    /XML "scripts\TaskScheduler_Scheduler.xml" /F

# (optional) 5-minute poke-safety-net
schtasks /Create /TN "MemeDNA Ingest Latest" `
    /XML "scripts\TaskScheduler_IngestLatest.xml" /F
```

### 3. Start it right now (without waiting for a reboot)

```powershell
schtasks /Run /TN "MemeDNA Pipeline Scheduler"
```

### 4. Check status

```powershell
schtasks /Query /TN "MemeDNA Pipeline Scheduler" /V /FO LIST | Select-String Status
```

### 5. Disable / remove

```powershell
schtasks /End    /TN "MemeDNA Pipeline Scheduler"
schtasks /Delete /TN "MemeDNA Pipeline Scheduler" /F
```

## Option B — NSSM (install as a proper Windows service)

Requires admin. `nssm` is a 1-file utility: download from <https://nssm.cc>.

```powershell
# Install the service
nssm install MemeDNAScheduler "pwsh.exe" `
    "-NoProfile -ExecutionPolicy Bypass -File C:\Users\user\Desktop\MemeDNA\scripts\run_scheduler.ps1"

# Pin the working directory and log files
nssm set MemeDNAScheduler AppDirectory "C:\Users\user\Desktop\MemeDNA"
nssm set MemeDNAScheduler AppStdout    "C:\Users\user\Desktop\MemeDNA\scripts\_scheduler_run.log"
nssm set MemeDNAScheduler AppStderr    "C:\Users\user\Desktop\MemeDNA\scripts\_scheduler_run.err"
nssm set MemeDNAScheduler Start SERVICE_AUTO_START

# Start / stop / status
nssm start   MemeDNAScheduler
nssm stop    MemeDNAScheduler
sc   query   MemeDNAScheduler
nssm remove  MemeDNAScheduler confirm
```

## Option C — Start it in-process with the API

`launch_local.ps1` already boots `uvicorn memedna.main:app`. On startup it
also boots the APScheduler as long as `MEMEDNA_DISABLE_SCHEDULER=0` (the
default). So in development you can simply leave the API process open and
ingestion ticks along with it. The downside is that closing the terminal
kills ingestion.

## Health / observability

The `/stats/scanning` endpoint now returns:

| Field          | Meaning                                                |
|----------------|--------------------------------------------------------|
| `chain_head`   | Latest BSC block as reported by RPC                    |
| `cursor.last_block` | Highest block the ingester has processed          |
| `lag_blocks`   | `chain_head - cursor.last_block` (blocks behind)       |
| `cursor.age_seconds` | Seconds since the cursor was last advanced       |
| `stale`        | `true` if lag > 900 blocks (~45 min) or age > 30 min   |

The `/scanning` UI page paints a red banner when `stale = true`. If that
lights up, jump back to **Option A / B** above — usually it means the
scheduler service has exited.

## Admin endpoints (require `X-Admin-Token`)

| Endpoint                         | When to use                          |
|----------------------------------|--------------------------------------|
| `POST /internal/pipeline/run`    | Manual full pipeline run             |
| `POST /internal/ingest/quick`    | "Catch the last N hours" in seconds  |
| `GET  /internal/runs`            | Inspect recent pipeline runs         |

`MEMEDNA_ADMIN_TOKEN` must be set in `.env` for these to work. The UI
"Refresh ingest" button uses `/internal/ingest/quick` — it will prompt
you for the admin token on first use and cache it in `localStorage`.
