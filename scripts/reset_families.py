"""Nuke all DnaFamily rows so the next pipeline run rebuilds them.

When the clustering algorithm or the ``_family_id_for`` strategy changes
(as in the 0.28-eps + archetype-split + week-bucketed ID rework), the
existing ``dna_families`` rows are stranded under old IDs the new
pipeline will never touch. This script deletes every family + its
children (family_mutations, family_centers, family_references,
family_timeline, family_timepoints) so the next pipeline tick has a
clean slate.

Tokens, trades, and embeddings are NOT touched - they regenerate the
families in minutes with zero re-ingest or re-embedding cost.

Usage
-----
    python scripts/reset_families.py --dry-run
    python scripts/reset_families.py        # apply (asks for confirmation)
    python scripts/reset_families.py --yes  # apply without prompt
"""

from __future__ import annotations

import argparse

from loguru import logger
from sqlalchemy import text

from memedna.db import SessionLocal


TABLES_CHILD_FIRST = [
    "family_timepoints",
    "family_timeline",
    "family_references",
    "family_centers",
    "family_mutations",
    "dna_families",
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true", help="Skip the confirmation prompt.")
    args = parser.parse_args()

    with SessionLocal() as session:
        counts = {
            t: int(
                session.execute(text(f"SELECT count(*) FROM {t}")).scalar_one()
            )
            for t in TABLES_CHILD_FIRST
        }
        logger.info("current row counts: {}", counts)
        if args.dry_run:
            logger.info("Dry-run: nothing was deleted.")
            return
        if not args.yes:
            msg = (
                "\nThis will DELETE every dna_families row and their children.\n"
                "Tokens and embeddings are preserved; the scheduler will\n"
                "re-cluster within ~5-10 minutes. Type 'reset' to continue: "
            )
            try:
                confirm = input(msg).strip()
            except EOFError:
                confirm = ""
            if confirm != "reset":
                logger.info("Aborted.")
                return

        for tbl in TABLES_CHILD_FIRST:
            n = session.execute(text(f"DELETE FROM {tbl}")).rowcount
            logger.info("  cleared {:<22} {} rows", tbl, n)
        session.commit()

        after = {
            t: int(
                session.execute(text(f"SELECT count(*) FROM {t}")).scalar_one()
            )
            for t in TABLES_CHILD_FIRST
        }
        logger.info("post-reset counts: {}", after)


if __name__ == "__main__":
    main()
