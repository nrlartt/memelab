from sqlalchemy import text

from memedna.db import engine

with engine.connect() as c:
    print("tokens     :", c.execute(text("SELECT COUNT(*) FROM tokens")).scalar())
    print("embeddings :", c.execute(text("SELECT COUNT(*) FROM token_embeddings")).scalar())
    print("families   :", c.execute(text("SELECT COUNT(*) FROM dna_families")).scalar())
    print("mutations  :", c.execute(text("SELECT COUNT(*) FROM family_mutations")).scalar())
    r = c.execute(
        text(
            "SELECT id, started_at, finished_at, status, tokens_ingested, "
            "families_updated, degraded, stages FROM pipeline_runs "
            "ORDER BY id DESC LIMIT 1"
        )
    ).mappings().first()
    if r:
        print("-- last run --")
        for k, v in r.items():
            print(f"  {k}: {v}")
