from memedna.db import SessionLocal
from sqlalchemy import text


def main() -> None:
    with SessionLocal() as s:
        holders = s.execute(
            text("SELECT pid FROM pg_locks WHERE locktype = 'advisory'")
        ).scalars().all()
        print("holders:", holders)
        for pid in holders:
            ok = s.execute(
                text("SELECT pg_terminate_backend(:p)"), {"p": int(pid)}
            ).scalar_one()
            print(f"  terminated pid={pid}: {ok}")
        s.commit()

        orphans = s.execute(
            text(
                "UPDATE pipeline_runs "
                "SET status = 'error', "
                "    finished_at = now(), "
                "    error = 'stale advisory lock holder terminated' "
                "WHERE status = 'running' "
                "  AND started_at < now() - interval '20 minutes'"
            )
        ).rowcount
        s.commit()
        print(f"orphans cleared: {orphans}")


if __name__ == "__main__":
    main()
