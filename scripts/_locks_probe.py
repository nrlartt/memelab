from memedna.db import SessionLocal
from sqlalchemy import text


def main() -> None:
    with SessionLocal() as s:
        rows = s.execute(
            text(
                "SELECT l.pid, l.classid, l.objid, l.objsubid, a.state, "
                "EXTRACT(EPOCH FROM (now() - a.query_start))::int AS query_age_sec, "
                "a.query "
                "FROM pg_locks l "
                "LEFT JOIN pg_stat_activity a ON a.pid = l.pid "
                "WHERE l.locktype = 'advisory'"
            )
        ).mappings().all()
        print(f"advisory locks: {len(rows)}")
        for r in rows:
            d = dict(r)
            q = (d.get("query") or "").replace("\n", " ")[:160]
            print(
                f"  pid={d['pid']} classid={d['classid']} objid={d['objid']} "
                f"state={d.get('state')} age={d.get('query_age_sec')}s\n    q={q}"
            )


if __name__ == "__main__":
    main()
