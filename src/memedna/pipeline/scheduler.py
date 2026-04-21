"""APScheduler entrypoint: runs the pipeline every N minutes."""

from __future__ import annotations

import asyncio

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from loguru import logger

from ..config import get_settings
from .run_pipeline import run_pipeline


async def _job() -> None:
    try:
        result = await run_pipeline()
        logger.info("Scheduled run OK: {}", result)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Scheduled pipeline run failed: {}", exc)


async def main() -> None:
    s = get_settings()
    scheduler = AsyncIOScheduler(timezone="UTC")
    scheduler.add_job(_job, "interval", minutes=s.pipeline_interval_minutes, id="memedna-pipeline")
    scheduler.start()
    logger.info(
        "MemeDNA scheduler started, interval={}m, lookback={}h",
        s.pipeline_interval_minutes,
        s.pipeline_lookback_hours,
    )
    try:
        while True:
            await asyncio.sleep(3600)
    except (KeyboardInterrupt, SystemExit):
        scheduler.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
