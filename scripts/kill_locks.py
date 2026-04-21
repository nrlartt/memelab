"""Hard-terminate any backend holding the MemeDNA advisory lock."""
from sqlalchemy import text

from memedna.db import engine

LOCK_KEY = 7391739173917391  # must match ADVISORY_LOCK_KEY in db.py


def main() -> None:
    with engine.connect() as c:
        rows = c.execute(
            text(
                """
                SELECT pl.pid, a.state, a.query, a.application_name
                FROM pg_locks pl
                LEFT JOIN pg_stat_activity a ON a.pid = pl.pid
                WHERE pl.locktype = 'advisory'
                """
            )
        ).fetchall()
        print("advisory lock holders:", rows)
        for r in rows:
            pid = r[0]
            if pid is None:
                continue
            try:
                c.execute(text("SELECT pg_terminate_backend(:p)"), {"p": pid})
                print(f"terminated backend pid={pid}")
            except Exception as exc:  # noqa: BLE001
                print(f"could not terminate {pid}: {exc}")
        c.execute(
            text(
                "UPDATE pipeline_runs SET status='aborted', finished_at=NOW() "
                "WHERE status='running'"
            )
        )
        c.commit()
    print("ok: backends terminated + stale runs aborted")


if __name__ == "__main__":
    main()
