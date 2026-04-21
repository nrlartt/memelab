from memedna.db import SessionLocal
from sqlalchemy import text


def main() -> None:
    with SessionLocal() as s:
        cols = s.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'pipeline_runs'"
            )
        ).scalars().all()
        print("pipeline_runs columns:", cols)
        rows = s.execute(
            text(
                "SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT 6"
            )
        ).mappings().all()
        for r in rows:
            d = dict(r)
            print({k: d[k] for k in ("status", "started_at", "finished_at") if k in d})


if __name__ == "__main__":
    main()
