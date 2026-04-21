"""Create / upgrade the MemeDNA schema.

Runs every SQL file in ``sql/`` in lexical order (001_init.sql, 002_…, …).
Each file should be idempotent (use ``CREATE TABLE IF NOT EXISTS`` /
``ADD COLUMN IF NOT EXISTS``) so re-running is safe.
"""

from __future__ import annotations

import pathlib

from loguru import logger

from memedna.db import engine


def main() -> None:
    sql_dir = pathlib.Path(__file__).resolve().parents[1] / "sql"
    files = sorted(sql_dir.glob("*.sql"))
    if not files:
        raise SystemExit(f"No SQL files found in {sql_dir}")

    raw_conn = engine.raw_connection()
    try:
        for path in files:
            sql = path.read_text(encoding="utf-8")
            logger.info("Applying {}", path.name)
            with raw_conn.cursor() as cur:
                cur.execute(sql)
            raw_conn.commit()
    finally:
        raw_conn.close()
    logger.info("MemeDNA schema up to date ({} files)", len(files))


if __name__ == "__main__":
    main()
