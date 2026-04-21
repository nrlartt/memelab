"""MemeDNA – decoding the origin, evolution, and dominance of meme tokens on BNB Chain."""

from __future__ import annotations

import os
import sys

from loguru import logger

__version__ = "0.1.0"


def _configure_logging() -> None:
    """Apply the configured LOG_LEVEL once, at process startup.

    Loguru ships with a DEBUG-level default handler that is very noisy for
    on-chain ABI decode errors; we replace it with a single stderr handler
    whose level is driven by ``LOG_LEVEL``.
    """
    level = os.environ.get("LOG_LEVEL", "INFO").upper()
    try:
        logger.remove()
    except ValueError:
        pass
    logger.add(
        sys.stderr,
        level=level,
        enqueue=False,
        backtrace=False,
        diagnose=False,
        format=(
            "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
            "<level>{level:<7}</level> | "
            "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - "
            "<level>{message}</level>"
        ),
    )


_configure_logging()
