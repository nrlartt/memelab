"""Quickly probe the configured Postgres for pgvector + connectivity."""

from __future__ import annotations

from sqlalchemy import text

from memedna.db import engine


def main() -> None:
    with engine.connect() as c:
        version = c.execute(text("SHOW server_version")).scalar()
        print(f"server_version: {version}")
        rows = list(
            c.execute(
                text(
                    "SELECT name, default_version "
                    "FROM pg_available_extensions "
                    "WHERE name IN ('vector', 'pgcrypto') "
                    "ORDER BY name"
                )
            )
        )
        print("available extensions:", rows)
        try:
            c.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            c.commit()
            print("pgvector: INSTALLED / available")
        except Exception as exc:  # noqa: BLE001
            print(f"pgvector ERROR: {exc}")


if __name__ == "__main__":
    main()
