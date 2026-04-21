"""Print schema + row counts for every MemeDNA table."""

from __future__ import annotations

from sqlalchemy import text

from memedna.db import engine

TABLES = [
    "tokens",
    "token_trades",
    "token_embeddings",
    "dna_families",
    "family_mutations",
    "family_centers",
    "family_references",
    "family_timeline",
    "family_timepoints",
    "pipeline_runs",
    "research_cache",
]


def main() -> None:
    with engine.connect() as c:
        installed = [
            r[0]
            for r in c.execute(
                text("SELECT extname FROM pg_extension ORDER BY extname")
            )
        ]
        print(f"extensions installed: {installed}")
        print()
        print(f"{'table':<22} {'rows':>10}")
        print("-" * 34)
        total = 0
        for t in TABLES:
            n = c.execute(text(f"SELECT count(*) FROM {t}")).scalar() or 0
            total += n
            print(f"{t:<22} {n:>10}")
        print("-" * 34)
        print(f"{'TOTAL':<22} {total:>10}")


if __name__ == "__main__":
    main()
