"""Release PG advisory lock and mark any stale running pipeline_runs rows."""
from sqlalchemy import text

from memedna.db import engine

with engine.connect() as c:
    c.execute(text("SELECT pg_advisory_unlock_all()"))
    c.execute(
        text(
            "UPDATE pipeline_runs SET status='aborted', finished_at=NOW() "
            "WHERE status='running'"
        )
    )
    c.commit()
print("ok: locks released + stale runs aborted")
