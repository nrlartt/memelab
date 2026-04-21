"""Re-run four-center extraction for every existing DNA family.

Use this after prompt versions bump (v1 → v2). We don't touch the pipeline
cadence; we just walk the family table and call ``extract_centers`` with the
same inputs the pipeline would. Heuristic fallbacks guarantee at least 3 of
4 centers get populated even when the LLM returns null.
"""

from __future__ import annotations

import asyncio

from loguru import logger
from sqlalchemy import select

from memedna.ai.centers import extract_centers
from memedna.db import SessionLocal
from memedna.models import DnaFamily, FamilyMutation, Token
from memedna.pipeline.run_pipeline import _persist_centers


async def _one(session, family: DnaFamily) -> int:
    tokens = list(
        session.execute(
            select(Token)
            .join(FamilyMutation, FamilyMutation.token_address == Token.token_address)
            .where(FamilyMutation.family_id == family.id)
            .order_by(Token.created_at)
        ).scalars().all()
    )
    if not tokens:
        return 0
    data = await extract_centers(
        session,
        event_title=family.event_title,
        event_summary=family.event_summary or "",
        tokens=tokens,
        web_snippets=[],
    )
    _persist_centers(session, family.id, data)
    session.commit()
    populated = sum(
        1
        for k in ("source_center", "entity_center", "geo_center", "community_center")
        if (data.get(k) or {}).get("value")
    )
    return populated


async def main() -> None:
    with SessionLocal() as session:
        families = list(
            session.execute(select(DnaFamily).order_by(DnaFamily.mutations_count.desc())).scalars().all()
        )
    logger.info("Backfilling centers for {} families…", len(families))
    total = 0
    for i, f in enumerate(families, 1):
        with SessionLocal() as session:
            fam = session.get(DnaFamily, f.id)
            if fam is None:
                continue
            try:
                populated = await _one(session, fam)
                total += populated
                logger.info("  {:>3}/{}  {} → {}/4 centers", i, len(families), fam.id, populated)
            except Exception as exc:  # noqa: BLE001
                logger.warning("  {:>3}/{}  {} failed: {}", i, len(families), fam.id, exc)
    logger.info("Done. {} center values populated across {} families.", total, len(families))


if __name__ == "__main__":
    asyncio.run(main())
