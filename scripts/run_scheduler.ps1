#!/usr/bin/env pwsh
# run_scheduler.ps1 — long-running MemeDNA APScheduler loop.
#
# This is the process you want pinned to Windows at boot. It imports the
# scheduler module and awaits forever; every PIPELINE_INTERVAL_MINUTES
# (default 5) it runs the full ingest→embed→cluster→analyse cycle.
#
# Usage (foreground):
#     pwsh .\scripts\run_scheduler.ps1
#
# For unattended operation, see docs/INGEST_SERVICE.md; either:
#   • Task Scheduler with scripts/TaskScheduler_Scheduler.xml (At logon + restart on fail)
#   • nssm install MemeDNAScheduler "pwsh" "-File C:\Users\user\Desktop\MemeDNA\scripts\run_scheduler.ps1"

$ErrorActionPreference = "Stop"
Push-Location $PSScriptRoot\..
try {
    if (-not (Test-Path .env)) { throw ".env missing (run from repo root)." }
    $py = ".\.venv\Scripts\python.exe"
    if (-not (Test-Path $py)) { throw "Python venv not found. Run scripts\launch_local.ps1 once first." }
    $env:PYTHONPATH = "src"
    $env:PYTHONIOENCODING = "utf-8"
    Write-Host "==> Starting memedna.pipeline.scheduler (Ctrl+C to stop)" -ForegroundColor Cyan
    & $py -m memedna.pipeline.scheduler
    if ($LASTEXITCODE -ne 0) { throw "scheduler exited with code $LASTEXITCODE" }
}
finally {
    Pop-Location
}
