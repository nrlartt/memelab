#!/usr/bin/env pwsh
# ingest_latest.ps1 — "catch the latest Four.Meme tokens"
#
# Behaviour:
#   1. If the local API is running (http://127.0.0.1:8000/healthz responds)
#      → POST /internal/ingest/quick (fast, LLM-free, 10–30s).
#   2. Otherwise → run scripts/run_ingest.py in-process via .venv python.
#
# Designed for Windows Task Scheduler — exits 0 on success, 1 on failure.
# Run with:
#     pwsh .\scripts\ingest_latest.ps1 -SinceHours 2 -MaxTokens 1500
#
# The companion XML (scripts/TaskScheduler_IngestLatest.xml) schedules this
# script every 5 minutes.

param(
    [int]$SinceHours = 2,
    [int]$MaxTokens  = 1500,
    [switch]$EnrichOnChain,
    [string]$ApiBase = "http://127.0.0.1:8000",
    [switch]$ForceInProcess
)

$ErrorActionPreference = "Stop"
Push-Location $PSScriptRoot\..
try {
    if (-not (Test-Path .env)) { throw ".env missing (run from repo root)." }

    # Load admin token from .env (skip when we fall back to in-process).
    $envLines = Get-Content .env | Where-Object { $_ -match '^[A-Z_]+=' -and $_ -notmatch '^#' }
    $envMap = @{}
    foreach ($line in $envLines) {
        $k, $v = $line -split '=', 2
        $envMap[$k.Trim()] = $v.Trim()
    }
    $adminToken = $envMap["MEMEDNA_ADMIN_TOKEN"]

    $apiAlive = $false
    if (-not $ForceInProcess) {
        try {
            $null = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri "$ApiBase/healthz"
            $apiAlive = $true
        } catch { $apiAlive = $false }
    }

    if ($apiAlive -and $adminToken) {
        Write-Host "[ingest_latest] API up → POST /internal/ingest/quick" -ForegroundColor Cyan
        $body = @{
            since_hours     = $SinceHours
            max_tokens      = $MaxTokens
            enrich_on_chain = [bool]$EnrichOnChain
        } | ConvertTo-Json -Compress
        $resp = Invoke-RestMethod -Method Post `
            -Uri "$ApiBase/internal/ingest/quick" `
            -Headers @{ "X-Admin-Token" = $adminToken; "content-type" = "application/json" } `
            -Body $body -TimeoutSec 120
        Write-Host ("[ingest_latest] inserted={0} updated={1} enriched={2} new_1h={3} lag={4} ({5}s)" `
            -f $resp.inserted, $resp.updated, $resp.enriched, $resp.new_1h, $resp.lag_blocks, $resp.duration_s)
        exit 0
    }

    # Fallback: direct python call (works even if API is down).
    $py = ".\.venv\Scripts\python.exe"
    if (-not (Test-Path $py)) { throw "Python venv not found at $py. Run scripts\launch_local.ps1 first." }
    $env:PYTHONPATH = "src"
    $env:PYTHONIOENCODING = "utf-8"
    Write-Host "[ingest_latest] API not reachable → in-process run_ingest.py" -ForegroundColor Yellow
    & $py -m scripts.run_ingest --since-hours $SinceHours --max-tokens $MaxTokens
    if ($LASTEXITCODE -ne 0) { throw "run_ingest.py exited with code $LASTEXITCODE" }
}
catch {
    Write-Host "[ingest_latest] FAILED: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    Pop-Location
}
