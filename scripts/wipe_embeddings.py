"""Wipe embeddings + families so the next pipeline run rebuilds them with
the upgraded local-semantic tokenizer and fresh clustering parameters."""
from sqlalchemy import text

from memedna.db import engine

with engine.connect() as c:
    for stmt in (
        "DELETE FROM family_mutations",
        "DELETE FROM family_timepoints",
        "DELETE FROM family_references",
        "DELETE FROM family_timeline",
        "DELETE FROM family_centers",
        "DELETE FROM dna_families",
        "DELETE FROM token_embeddings",
        "DELETE FROM llm_cache",
    ):
        n = c.execute(text(stmt))
        print(f"{stmt}: {n.rowcount}")
    c.commit()
print("reset complete — next pipeline run will rebuild embeddings + clusters")
