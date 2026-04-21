"""Operational diagnostics: see exactly how much of the Four.Meme genome we
currently hold, and where the bottlenecks are."""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]

from memedna.config import get_settings
from memedna.db import engine


def rule(title: str) -> None:
    print(f"\n── {title} " + "─" * max(0, 72 - len(title)))


def main() -> None:
    s = get_settings()
    rule("config")
    print(f"lookback_hours      : {s.pipeline_lookback_hours}")
    print(f"min_cluster_size    : {s.pipeline_min_cluster_size}")
    print(f"batch_size          : {s.pipeline_batch_size}")
    print(f"chat_llm            : {'ON (' + s.openai_chat_model + ')' if s.has_chat_llm else 'OFF'}")
    print(f"embed_llm           : {'ON (' + s.resolved_embeddings_model + ')' if s.has_embedding_llm else 'local fallback'}")
    print(f"bsc_rpc             : {s.bsc_rpc_url}")
    print(f"bitquery            : {'ON' if s.bitquery_api_key else 'OFF'}")
    print(f"web_research        : tavily={'on' if s.tavily_api_key else 'off'} serp={'on' if s.serpapi_api_key else 'off'}")

    with engine.connect() as c:
        rule("token coverage")
        n_tokens = c.execute(text("SELECT COUNT(*) FROM tokens")).scalar() or 0
        earliest = c.execute(text("SELECT MIN(created_at) FROM tokens")).scalar()
        latest = c.execute(text("SELECT MAX(created_at) FROM tokens")).scalar()
        with_desc = c.execute(text("SELECT COUNT(*) FROM tokens WHERE COALESCE(description,'') <> ''")).scalar() or 0
        migrated = c.execute(text("SELECT COUNT(*) FROM tokens WHERE migrated IS TRUE")).scalar() or 0
        by_source = c.execute(text(
            "SELECT source, COUNT(*) FROM tokens GROUP BY source ORDER BY 2 DESC"
        )).all()
        print(f"total tokens        : {n_tokens:,}")
        print(f"earliest            : {earliest}")
        print(f"latest              : {latest}")
        print(f"with description    : {with_desc:,} ({(with_desc / max(1, n_tokens)) * 100:.1f}%)")
        print(f"migrated (graduated): {migrated:,}")
        print("by source           :")
        for src, n in by_source:
            print(f"  {src:<24} {n:>8}")

        rule("embeddings")
        emb = c.execute(text("SELECT COUNT(*) FROM token_embeddings")).scalar() or 0
        print(f"embedded tokens     : {emb:,} / {n_tokens:,}")

        rule("dna families")
        fams = c.execute(text("SELECT COUNT(*) FROM dna_families")).scalar() or 0
        fams_hi = c.execute(text(
            "SELECT COUNT(*) FROM dna_families WHERE confidence_score >= 0.6"
        )).scalar() or 0
        avg_mut = c.execute(text(
            "SELECT ROUND(AVG(mutations_count)::numeric, 1) FROM dna_families"
        )).scalar()
        clustered_tokens = c.execute(text("SELECT COUNT(*) FROM family_mutations")).scalar() or 0
        print(f"families            : {fams}")
        print(f"  high-confidence   : {fams_hi}")
        print(f"  avg mutations     : {avg_mut}")
        print(f"tokens in a family  : {clustered_tokens:,} ({(clustered_tokens / max(1, n_tokens)) * 100:.1f}% of tokens clustered)")

        rule("last 24h velocity (tokens/hour)")
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        per_hour = c.execute(text(
            "SELECT date_trunc('hour', created_at) AS h, COUNT(*) "
            "FROM tokens WHERE created_at >= :cutoff GROUP BY 1 ORDER BY 1 DESC LIMIT 24"
        ), {"cutoff": cutoff}).all()
        for h, n in per_hour[:12]:
            bar = "█" * min(60, int(n))
            print(f"  {h.strftime('%Y-%m-%d %H:00')}  {n:>4}  {bar}")

        rule("last pipeline run")
        row = c.execute(text(
            "SELECT started_at, finished_at, status, tokens_ingested, families_updated, degraded, stages "
            "FROM pipeline_runs ORDER BY id DESC LIMIT 1"
        )).mappings().first()
        if row:
            print(f"started      : {row['started_at']}")
            print(f"finished     : {row['finished_at']}")
            print(f"status       : {row['status']}   degraded={row['degraded']}")
            print(f"ingested     : {row['tokens_ingested']}")
            print(f"families     : {row['families_updated']}")
            stages = row.get("stages") or {}
            for k, v in (stages or {}).items():
                print(f"  stage {k:<24} {v}")
        else:
            print("no runs recorded yet")


if __name__ == "__main__":
    main()
