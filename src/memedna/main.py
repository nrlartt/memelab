"""FastAPI entrypoint for MemeLab (memedna package)."""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta, timezone

from apscheduler.executors.pool import ThreadPoolExecutor
from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
from loguru import logger
from sqlalchemy import func, select, text

from .api.admin import router as admin_router
from .api.dna_families import router as families_router
from .api.explorer import router as explorer_router
from .api.mutations import router as mutations_router
from .api.social import router as social_router
from .api.trending import router as trending_router
from .api.lab_report import router as lab_report_router
from .api.wallet import router as wallet_router
from .config import get_settings
from .db import SessionLocal
from .models import PipelineRun

settings = get_settings()
# IMPORTANT: this is a **thread-backed** ``BackgroundScheduler``, not the
# old ``AsyncIOScheduler``. The async variant ran every job inside uvicorn's
# main event loop, which meant a 25-minute pipeline tick (or even a slow
# DexScreener batch inside the trade-refresh tick) would freeze every
# HTTP handler — including ``/healthz`` — until the tick finished. We
# observed exactly that symptom: Lab Report hung for 90+ seconds after
# the scheduler started enriching the 140-cluster backlog.
#
# The background scheduler runs jobs in a dedicated worker thread, and
# each async job spins up its own short-lived event loop via
# ``asyncio.run(...)``. The API event loop is now only responsible for
# serving HTTP traffic.
_scheduler: BackgroundScheduler | None = None

# JSON API lives under ``/api/*`` so the Next.js UI can own human paths like
# ``/mutation/{address}`` without colliding with FastAPI routes (same path was
# used for both in the split-port dev setup).
API_PREFIX = "/api"

app = FastAPI(
    title="MemeLab",
    description="Decodes the origin, evolution, and dominance of meme tokens on BNB Chain.",
    version="0.1.0",
    default_response_class=ORJSONResponse,
    docs_url=f"{API_PREFIX}/docs",
    redoc_url=f"{API_PREFIX}/redoc",
    openapi_url=f"{API_PREFIX}/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.api_cors_origins.split(",") if o.strip()] or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _ensure_token_media_columns() -> None:
    """Idempotent schema migration for the token media / socials columns.

    We don't use alembic, so every new column has to survive both a clean
    install (``CREATE TABLE`` from ``sql/001_init.sql``) and a rolling
    deploy on an existing DB. Postgres' ``IF NOT EXISTS`` makes the call
    a cheap no-op after the first boot and avoids a "column already exists"
    crash that would take the whole API down on restart.
    """
    try:
        with SessionLocal() as session:
            session.execute(
                text(
                    "ALTER TABLE tokens "
                    "  ADD COLUMN IF NOT EXISTS image_url    VARCHAR, "
                    "  ADD COLUMN IF NOT EXISTS header_url   VARCHAR, "
                    "  ADD COLUMN IF NOT EXISTS website_url  VARCHAR, "
                    "  ADD COLUMN IF NOT EXISTS twitter_url  VARCHAR, "
                    "  ADD COLUMN IF NOT EXISTS telegram_url VARCHAR"
                )
            )
            session.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("token media columns migration skipped: {}", exc)


def _finalize_ghost_pipeline_runs() -> int:
    """Mark abandoned ``PipelineRun`` rows as failed on startup.

    A process crash (OOM, `kill -9`, Windows sign-out, etc.) leaves the
    previous run's row in ``status='running'`` forever, which pollutes
    ``/stats/scanning`` and the ``readyz`` health signal. On each boot
    we assume any still-running row belongs to a dead process (only one
    scheduler runs per DB anyway, guarded by the advisory lock) and
    close it out.
    """
    try:
        with SessionLocal() as session:
            ghosts = list(
                session.execute(
                    select(PipelineRun).where(PipelineRun.status == "running")
                ).scalars().all()
            )
            now = datetime.now(tz=timezone.utc)
            for r in ghosts:
                r.status = "failed"
                r.error = "abandoned by previous process (startup sweep)"
                r.finished_at = now
            session.commit()
            return len(ghosts)
    except Exception as exc:  # noqa: BLE001
        logger.warning("ghost pipeline-run sweep failed: {}", exc)
        return 0


@app.on_event("startup")
async def _startup() -> None:
    logger.info(
        "MemeLab API starting. openai={}, bitquery={}, web_search={}, registry={}",
        settings.has_openai, settings.has_bitquery, settings.has_web_search, settings.has_registry,
    )

    _ensure_token_media_columns()

    cleaned = _finalize_ghost_pipeline_runs()
    if cleaned:
        logger.info("Closed {} ghost pipeline_run rows from previous boot", cleaned)

    # Embedded scheduler lets a single `uvicorn` process keep the pipeline
    # live. Disable via MEMEDNA_DISABLE_SCHEDULER=1 (useful in local dev
    # when you don't want background CPU burn).
    if os.getenv("MEMEDNA_DISABLE_SCHEDULER", "0") != "1":
        from .pipeline.run_pipeline import run_pipeline
        from .pipeline.trade_refresh import refresh_all_trades_once

        global _scheduler
        # Dedicated worker threads so the pipeline (long, LLM-heavy) and
        # trade-refresh (short, network-heavy) never queue behind each
        # other. ``max_workers=2`` matches the job count — we don't want
        # extra overlapping runs because ``max_instances=1`` already
        # guards against that per-job.
        _scheduler = BackgroundScheduler(
            executors={"default": ThreadPoolExecutor(max_workers=2)},
            timezone="UTC",
        )

        def _run_async_job(name: str, coro_factory):
            """Run an async job in its own event loop, inside a worker thread.

            APScheduler's ``BackgroundScheduler`` gives us a plain thread
            per trigger; we create a fresh asyncio loop for each invocation
            so the pipeline's own ``asyncio.gather`` / ``async with`` code
            paths keep working unchanged. Exceptions are caught so a
            failing tick never poisons the scheduler.
            """
            try:
                asyncio.run(coro_factory())
            except Exception as exc:  # noqa: BLE001
                logger.warning("{} tick failed: {}", name, exc)

        def _tick() -> None:
            async def _inner():
                result = await run_pipeline()
                logger.info(
                    "scheduler tick ok: tokens={}, families={}, stages={}",
                    result.tokens_ingested, result.families_updated, result.stages,
                )
            _run_async_job("pipeline", _inner)

        def _trade_tick() -> None:
            # Live trade refresh runs independently of the heavy pipeline
            # so fresh Four.Meme launches don't show stale volume/liq for
            # 30+ minutes while the LLM enrichment chain is still busy.
            _run_async_job("trade-refresh", refresh_all_trades_once)

        _scheduler.add_job(
            _tick,
            "interval",
            minutes=settings.pipeline_interval_minutes,
            id="memedna-pipeline",
            coalesce=True,
            max_instances=1,
            # Start the first tick after boot so health checks, Next.js boot,
            # and early user traffic are not competing with a multi-minute
            # on-chain RPC catch-up on the same CPU.
            next_run_time=datetime.now(tz=timezone.utc) + timedelta(seconds=120),
        )
        # Fast trade refresher: cheap (DexScreener only), high-frequency.
        # Kicked off 10s after boot so it doesn't race with the readiness
        # probe on container startup.
        _scheduler.add_job(
            _trade_tick,
            "interval",
            minutes=settings.trade_refresh_interval_minutes,
            id="memedna-trade-refresh",
            coalesce=True,
            max_instances=1,
            next_run_time=datetime.now(tz=timezone.utc) + timedelta(seconds=10),
        )
        _scheduler.start()
        logger.info(
            "Scheduler armed (thread pool): pipeline every {}m "
            "(lookback={}h, incremental={}), trade-refresh every {}m",
            settings.pipeline_interval_minutes,
            settings.pipeline_lookback_hours,
            settings.pipeline_incremental,
            settings.trade_refresh_interval_minutes,
        )


@app.on_event("shutdown")
async def _shutdown() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None


@app.get(f"{API_PREFIX}/meta", tags=["meta"])
def api_meta() -> dict:
    """Small manifest for operators when the SPA is served on ``/`` (same host)."""
    return {
        "name": "MemeLab",
        "tagline": "MemeLab decodes the origin, evolution, and dominance of meme tokens.",
        "version": "0.1.0",
        "docs": f"{API_PREFIX}/docs",
    }


@app.get("/healthz", tags=["meta"])
def healthz() -> dict:
    return {"status": "ok"}


@app.get("/readyz", tags=["meta"])
def readyz() -> dict:
    with SessionLocal() as session:
        try:
            session.execute(text("SELECT 1"))
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=503, detail=f"db unreachable: {exc}")
        last = session.execute(
            select(PipelineRun).order_by(PipelineRun.started_at.desc()).limit(1)
        ).scalar_one_or_none()
    fresh = False
    last_status = None
    last_finished = None
    if last:
        last_status = last.status
        last_finished = last.finished_at
        if last.finished_at:
            fresh = last.finished_at >= datetime.now(tz=timezone.utc) - timedelta(minutes=30)
    return {
        "status": "ok",
        "db": "ok",
        "pipeline_fresh": fresh,
        "last_run_status": last_status,
        "last_run_finished_at": last_finished.isoformat() if last_finished else None,
        "scheduler": _scheduler is not None,
    }


# Short-TTL cache for the global overview. Ingest cadence is >5 min, so a
# 20 s cache is effectively always "live" but saves 5-6 aggregate queries
# per page load when many browser tabs hit the homepage at once.
_OVERVIEW_CACHE: dict[str, float | dict] = {"at": 0.0, "data": {}}
_OVERVIEW_TTL_S = 20.0


@app.get(f"{API_PREFIX}/stats/overview", tags=["meta"])
def stats_overview() -> dict:
    """Global rollup across *every* Four.Meme token and family.

    The UI uses this for the hero strip so users see real totals, not a
    per-request aggregate of the current page.
    """
    import time

    from sqlalchemy import Integer, case, cast

    from .models import DnaFamily, Token, TokenTrade

    now = time.monotonic()
    cached = _OVERVIEW_CACHE.get("data") or {}
    if cached and now - float(_OVERVIEW_CACHE.get("at") or 0.0) < _OVERVIEW_TTL_S:
        return cached  # type: ignore[return-value]

    with SessionLocal() as session:
        fam_row = session.execute(
            select(
                func.count(DnaFamily.id),
                func.coalesce(func.sum(DnaFamily.mutations_count), 0),
            )
        ).one()
        families_total = int(fam_row[0] or 0)
        mutations_total = int(fam_row[1] or 0)

        tokens_total = int(
            session.execute(select(func.count(Token.token_address))).scalar_one() or 0
        )

        # Collapse 3 TokenTrade scans into one - volume, liquidity, and the
        # "has liquidity" count all come from the same row set.
        trade_row = session.execute(
            select(
                func.coalesce(func.sum(TokenTrade.volume_24h_usd), 0.0),
                func.coalesce(func.sum(TokenTrade.liquidity_usd), 0.0),
                func.coalesce(
                    func.sum(
                        case((TokenTrade.liquidity_usd > 0, 1), else_=0)
                    ),
                    0,
                ),
            )
        ).one()
        volume_total = float(trade_row[0] or 0.0)
        liquidity_total = float(trade_row[1] or 0.0)
        tracked_tokens = int(trade_row[2] or 0)

    data = {
        "families_total": families_total,
        "tokens_total": tokens_total,
        "mutations_total": mutations_total,
        "volume_24h_usd": volume_total,
        "liquidity_usd": liquidity_total,
        "tokens_with_liquidity": tracked_tokens,
    }
    _OVERVIEW_CACHE["data"] = data
    _OVERVIEW_CACHE["at"] = now
    return data


@app.get(f"{API_PREFIX}/stats/scanning", tags=["meta"])
def stats_scanning() -> dict:
    """Live pipeline telemetry: last 20 runs, current cursor, token/family deltas.

    Powers the /scanning dashboard so humans can watch MemeDNA ingest in
    real time.
    """
    from .models import DnaFamily, IngestCursor, PipelineRun, Token, TokenTrade

    with SessionLocal() as session:
        runs = list(
            session.execute(
                select(PipelineRun).order_by(PipelineRun.started_at.desc()).limit(20)
            ).scalars().all()
        )
        cursor_row = session.execute(
            select(IngestCursor).order_by(IngestCursor.updated_at.desc()).limit(1)
        ).scalar_one_or_none()

        last_hour = datetime.now(tz=timezone.utc) - timedelta(hours=1)
        last_day = datetime.now(tz=timezone.utc) - timedelta(hours=24)
        new_tokens_1h = int(
            session.execute(
                select(func.count(Token.token_address)).where(
                    Token.discovered_at >= last_hour
                )
            ).scalar_one()
            or 0
        )
        new_tokens_24h = int(
            session.execute(
                select(func.count(Token.token_address)).where(
                    Token.discovered_at >= last_day
                )
            ).scalar_one()
            or 0
        )
        tokens_total = int(
            session.execute(select(func.count(Token.token_address))).scalar_one() or 0
        )
        families_total = int(
            session.execute(select(func.count(DnaFamily.id))).scalar_one() or 0
        )
        migrated_total = int(
            session.execute(
                select(func.count(Token.token_address)).where(Token.migrated == True)  # noqa: E712
            ).scalar_one()
            or 0
        )
        with_liquidity = int(
            session.execute(
                select(func.count(TokenTrade.token_address)).where(
                    TokenTrade.liquidity_usd > 0
                )
            ).scalar_one()
            or 0
        )

    chain_head: int | None = None
    lag_blocks: int | None = None
    stale: bool = False
    cursor_age_s: float | None = None
    try:
        from .ingestion.onchain import OnchainFourMemeClient

        rpc = OnchainFourMemeClient()
        chain_head = int(rpc.latest_block())
    except Exception as exc:  # noqa: BLE001
        logger.debug("scanning stats: could not read head block: {}", exc)

    cur_block = int(cursor_row.last_block) if cursor_row else 0
    if chain_head is not None and cur_block:
        lag_blocks = max(0, chain_head - cur_block)
        # BSC ~3s/block → 1200 blocks ≈ 1h. Treat >900 blocks (≈45 min)
        # behind as stale; UI shows a red banner.
        stale = lag_blocks > 900
    if cursor_row is not None and cursor_row.updated_at:
        cu = cursor_row.updated_at
        if cu.tzinfo is None:
            cu = cu.replace(tzinfo=timezone.utc)
        cursor_age_s = (datetime.now(tz=timezone.utc) - cu).total_seconds()
        if cursor_age_s and cursor_age_s > 1800:  # 30 minutes without a write
            stale = True

    return {
        "tokens_total": tokens_total,
        "families_total": families_total,
        "migrated_total": migrated_total,
        "tokens_with_liquidity": with_liquidity,
        "new_tokens_1h": new_tokens_1h,
        "new_tokens_24h": new_tokens_24h,
        "cursor": {
            "source": cursor_row.source if cursor_row else None,
            "last_block": cur_block,
            "updated_at": cursor_row.updated_at.isoformat() if cursor_row else None,
            "age_seconds": round(cursor_age_s, 1) if cursor_age_s is not None else None,
        },
        "chain_head": chain_head,
        "lag_blocks": lag_blocks,
        "stale": stale,
        "runs": [
            {
                "id": r.id,
                "status": r.status,
                "started_at": r.started_at.isoformat() if r.started_at else None,
                "finished_at": r.finished_at.isoformat() if r.finished_at else None,
                "duration_s": (
                    (r.finished_at - r.started_at).total_seconds()
                    if (r.finished_at and r.started_at)
                    else None
                ),
                "tokens_ingested": int(r.tokens_ingested or 0),
                "families_updated": int(r.families_updated or 0),
                "degraded": bool(r.degraded),
                "error": r.error,
            }
            for r in runs
        ],
        "scheduler": _scheduler is not None,
    }


@app.get(f"{API_PREFIX}/stack-info", tags=["meta"])
def stack_info() -> dict:
    """What the current MemeLab stack is actually using - for UI transparency."""
    from .ai.research import WebResearcher

    researcher = WebResearcher()
    return {
        "chat_llm": {
            "enabled": settings.has_chat_llm,
            "model": settings.openai_chat_model if settings.has_chat_llm else None,
            "provider": "groq" if settings.is_groq else ("openai" if settings.has_chat_llm else None),
        },
        "embeddings": {
            "enabled": settings.has_embedding_llm,
            "model": settings.resolved_embeddings_model if settings.has_embedding_llm else "local-semantic-hash",
            "fallback": not settings.has_embedding_llm,
        },
        "data_sources": {
            "four_meme_onchain": True,
            "bitquery": settings.has_bitquery,
            "dexscreener": True,
        },
        "research": {"provider": researcher.provider, "enabled": researcher.enabled},
        "blockchain": {
            "chain_id": settings.bsc_chain_id,
            "registry": settings.has_registry,
            "anchor_address": settings.memedna_registry_address or None,
        },
        "pipeline": {
            "interval_minutes": settings.pipeline_interval_minutes,
            "lookback_hours": settings.pipeline_lookback_hours,
            "incremental": settings.pipeline_incremental,
            "min_confidence": settings.pipeline_min_confidence,
            "cluster_eps": settings.pipeline_cluster_eps,
        },
    }


app.include_router(families_router, prefix=API_PREFIX)
app.include_router(mutations_router, prefix=API_PREFIX)
app.include_router(trending_router, prefix=API_PREFIX)
app.include_router(social_router, prefix=API_PREFIX)
app.include_router(explorer_router, prefix=API_PREFIX)
app.include_router(wallet_router, prefix=API_PREFIX)
app.include_router(lab_report_router, prefix=API_PREFIX)
app.include_router(admin_router, prefix=API_PREFIX)
