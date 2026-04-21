"""Manual ingest-only entrypoint: pulls Four.Meme tokens without running the full pipeline."""

from __future__ import annotations

import argparse
import asyncio

from loguru import logger

from memedna.db import session_scope
from memedna.ingestion.four_meme import ingest_four_meme_tokens


async def _main(since_hours: int, max_tokens: int, enrich: bool) -> None:
    with session_scope() as session:
        stats = await ingest_four_meme_tokens(
            session, since_hours=since_hours, enrich_on_chain=enrich, max_tokens=max_tokens
        )
    logger.info("Ingest stats: {}", stats)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--since-hours", type=int, default=24)
    parser.add_argument("--max-tokens", type=int, default=500)
    parser.add_argument("--no-enrich", action="store_true")
    args = parser.parse_args()
    asyncio.run(_main(args.since_hours, args.max_tokens, not args.no_enrich))
