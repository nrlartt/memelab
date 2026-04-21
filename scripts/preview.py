"""Human-readable preview of what the last pipeline run wrote to Postgres."""

from __future__ import annotations

from sqlalchemy import text

from memedna.db import engine


def main() -> None:
    with engine.connect() as c:
        print("=" * 76)
        print("MemeDNA - Railway Postgres snapshot")
        print("=" * 76)

        counts = {
            "tokens": c.execute(text("SELECT count(*) FROM tokens")).scalar(),
            "token_embeddings": c.execute(text("SELECT count(*) FROM token_embeddings")).scalar(),
            "dna_families": c.execute(text("SELECT count(*) FROM dna_families")).scalar(),
            "family_mutations": c.execute(text("SELECT count(*) FROM family_mutations")).scalar(),
            "family_centers": c.execute(text("SELECT count(*) FROM family_centers")).scalar(),
            "family_timepoints": c.execute(text("SELECT count(*) FROM family_timepoints")).scalar(),
            "pipeline_runs": c.execute(text("SELECT count(*) FROM pipeline_runs")).scalar(),
        }
        for k, v in counts.items():
            print(f"  {k:<20} {v}")

        print()
        print("-- Last pipeline run --------------------------------------------------------")
        row = c.execute(
            text(
                "SELECT started_at, finished_at, status, tokens_ingested, families_updated, degraded, stages "
                "FROM pipeline_runs ORDER BY id DESC LIMIT 1"
            )
        ).mappings().first()
        if row:
            for k, v in row.items():
                print(f"  {k:<18} {v}")

        print()
        print("-- DNA families (top 12 by confidence) --------------------------------------")
        rows = c.execute(
            text(
                "SELECT f.id, f.event_title, f.confidence_score, f.evolution_score, "
                "       f.origin_strain, f.dominant_strain, f.fastest_mutation, "
                "       f.mutations_count, f.total_volume_usd, f.first_seen_at, f.last_seen_at "
                "FROM dna_families f "
                "ORDER BY f.confidence_score DESC NULLS LAST, f.mutations_count DESC LIMIT 12"
            )
        ).mappings().all()
        for r in rows:
            t = (r["event_title"] or "(untitled)")[:42]
            orig = (r["origin_strain"] or "")[:10]
            dom = (r["dominant_strain"] or "")[:10]
            vol = f"${float(r['total_volume_usd'] or 0):,.0f}"
            print(
                f"  conf={float(r['confidence_score'] or 0):.2f}  "
                f"evo={float(r['evolution_score'] or 0):5.2f}  "
                f"mut={r['mutations_count']:>3}  vol={vol:>12}  "
                f"origin={orig:<10} dom={dom:<10}  {t}"
            )

        print()
        print("-- Sample mutations of top 3 families ---------------------------------------")
        tops = c.execute(
            text(
                "SELECT id, event_title, event_summary, confidence_score "
                "FROM dna_families "
                "ORDER BY confidence_score DESC NULLS LAST, mutations_count DESC LIMIT 3"
            )
        ).mappings().all()
        for top in tops:
            print()
            print(f"  FAMILY {top['id']}  conf={float(top['confidence_score'] or 0):.2f}")
            print(f"    title  : {top['event_title']}")
            summary = (top["event_summary"] or "").strip().replace("\n", " ")
            print(f"    summary: {summary[:140]}")
            sample = c.execute(
                text(
                    "SELECT t.symbol, t.name, t.token_address, t.created_at, "
                    "       m.is_origin_strain, m.is_dominant_strain, m.is_fastest_mutation, "
                    "       m.why_this_mutation_belongs "
                    "FROM family_mutations m JOIN tokens t ON t.token_address = m.token_address "
                    "WHERE m.family_id = :fid "
                    "ORDER BY t.created_at ASC LIMIT 8"
                ),
                {"fid": top["id"]},
            ).all()
            for s in sample:
                tag = []
                if s.is_origin_strain: tag.append("ORIGIN")
                if s.is_dominant_strain: tag.append("DOMINANT")
                if s.is_fastest_mutation: tag.append("FASTEST")
                tagstr = (",".join(tag)) or "-"
                sym = (s.symbol or "")[:14]
                nm = (s.name or "")[:22]
                print(f"      {sym:<14} {nm:<22} {s.token_address[:10]}...  [{tagstr}]")


if __name__ == "__main__":
    main()
