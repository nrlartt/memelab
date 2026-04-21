#!/usr/bin/env pwsh
# Launch MemeDNA locally against a cloud Postgres (no Docker required).
#
#   1. verifies DATABASE_URL is set in .env
#   2. installs any missing Python deps into .venv
#   3. bootstraps the schema (pgvector + tables)
#   4. runs one full pipeline pass (ingest + embed + cluster + enrich + analytics)
#   5. starts the FastAPI server on http://localhost:8000
#
# Usage (from the repo root):
#     pwsh .\scripts\launch_local.ps1
#     pwsh .\scripts\launch_local.ps1 -SkipPipeline   # just start the API
#     pwsh .\scripts\launch_local.ps1 -IngestOnly      # do ingest, skip API

param(
    [switch]$SkipPipeline,
    [switch]$IngestOnly,
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

Push-Location $PSScriptRoot\..
try {
    if (-not (Test-Path .env)) { throw ".env missing. Copy .env.example to .env first." }
    $envLines = Get-Content .env | Where-Object { $_ -match '^[A-Z_]+=' -and $_ -notmatch '^#' }
    $envMap = @{}
    foreach ($line in $envLines) {
        $k, $v = $line -split '=', 2
        $envMap[$k] = $v
    }
    $dbUrl = $envMap["DATABASE_URL"]
    if ([string]::IsNullOrWhiteSpace($dbUrl) -or $dbUrl -match "REPLACE_ME") {
        throw "DATABASE_URL is not configured in .env. Paste your Railway public Postgres URL and retry."
    }
    Write-Host "DATABASE_URL detected (host suffix): ...$((($dbUrl -split '@')[-1] -split '\?')[0])"

    $py = ".\.venv\Scripts\python.exe"
    if (-not (Test-Path $py)) {
        Write-Step "Creating Python virtualenv (.venv)"
        python -m venv .venv
    }

    if (-not $SkipInstall) {
        Write-Step "Installing Python dependencies (may take a few minutes the first time)"
        & $py -m pip install --quiet --upgrade pip
        & $py -m pip install --quiet -r requirements.txt
    }

    $env:PYTHONPATH = "src"
    $env:PYTHONIOENCODING = "utf-8"

    Write-Step "Bootstrapping database schema (pgvector + tables)"
    & $py -m scripts.bootstrap_db
    if ($LASTEXITCODE -ne 0) { throw "bootstrap_db failed" }

    if (-not $SkipPipeline) {
        Write-Step "Running ingest-only pass (last 24h Four.Meme tokens via BSC RPC)"
        & $py -m scripts.run_ingest --since-hours 24 --max-tokens 200
        if ($LASTEXITCODE -ne 0) { Write-Host "ingest exited non-zero (continuing)" -ForegroundColor Yellow }

        if (-not $IngestOnly) {
            Write-Step "Running full AI pipeline pass"
            & $py -m scripts.run_pipeline --lookback-hours 24 --skip-ingest
            if ($LASTEXITCODE -ne 0) { Write-Host "pipeline exited non-zero (continuing)" -ForegroundColor Yellow }
        }
    }

    if ($IngestOnly) {
        Write-Step "Ingest-only mode: done. API not started."
        return
    }

    Write-Step "Starting FastAPI on http://localhost:8000  (Ctrl+C to stop)"
    & $py -m uvicorn memedna.main:app --host 0.0.0.0 --port 8000
}
finally {
    Pop-Location
}
