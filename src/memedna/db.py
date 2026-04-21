"""Database engine, session, and a tiny helper for advisory locks."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from .config import get_settings

_settings = get_settings()

# ``connect_timeout`` avoids hanging for minutes when Postgres is down,
# DNS for ``postgres`` (docker hostname) fails on the host, or the pool is
# wedged — a common cause of "Lab Report spins forever" with no error.
# ``pool_timeout`` surfaces pool exhaustion as a fast failure instead of
# blocking until the OS TCP stack gives up.
engine = create_engine(
    _settings.database_url,
    pool_pre_ping=True,
    pool_size=15,
    max_overflow=10,
    pool_timeout=30,
    connect_args={"connect_timeout": 12},
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_session() -> Iterator[Session]:
    """FastAPI dependency."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional scope for scripts / pipeline."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def try_advisory_lock(session: Session, key: int = 42) -> bool:
    """Postgres advisory lock so only one pipeline runs at a time."""
    row = session.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": key}).scalar()
    return bool(row)


def release_advisory_lock(session: Session, key: int = 42) -> None:
    session.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": key})
