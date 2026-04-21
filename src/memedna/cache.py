"""Tiny disk/DB-backed cache for LLM + web-search responses."""

from __future__ import annotations

import hashlib
from typing import Any

import orjson
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from .models import ResearchCache


def make_cache_key(template: str, version: str, payload: Any) -> str:
    blob = orjson.dumps(payload, option=orjson.OPT_SORT_KEYS)
    h = hashlib.sha256(blob).hexdigest()
    return f"{template}:{version}:{h}"


def cache_get(session: Session, template: str, version: str, payload: Any) -> Any | None:
    key = make_cache_key(template, version, payload)
    row = session.execute(
        select(ResearchCache).where(ResearchCache.cache_key == key)
    ).scalar_one_or_none()
    return row.payload if row else None


def cache_put(session: Session, template: str, version: str, payload_in: Any, payload_out: Any) -> None:
    key = make_cache_key(template, version, payload_in)
    stmt = pg_insert(ResearchCache.__table__).values(
        cache_key=key,
        template=template,
        version=version,
        payload=payload_out,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["cache_key"],
        set_={"payload": stmt.excluded.payload},
    )
    session.execute(stmt)
