"""Ad-hoc social search for a single mutation.

The family detail page bakes timelines / references at ingest time, but
users often hit a token detail page for a brand-new or long-tail mutation
whose family hasn't had a research pass yet. This router lets the UI
fetch "what does the web say about this token right now?" on demand.

We never persist these results - it's read-through caching at the
provider side only. The token-address normalization keeps things cheap
even if an endpoint gets hammered.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from loguru import logger
from pydantic import BaseModel

from ..ai.research import WebResearcher

router = APIRouter(tags=["social"])


class SocialMention(BaseModel):
    title: str | None = None
    url: str
    snippet: str | None = None
    type: str = "article"
    provider: str = "duckduckgo"
    # Optional engagement signals the X provider returns:
    author_name: str | None = None
    author_handle: str | None = None
    likes: int | None = None
    retweets: int | None = None
    views: int | None = None
    followers: int | None = None
    published_at: str | None = None


class SocialResponse(BaseModel):
    query: str
    provider_chain: str
    items: list[SocialMention]
    fetched_at: datetime


def _as_mention(r: dict[str, Any]) -> SocialMention:
    return SocialMention(
        title=r.get("title"),
        url=r.get("url") or "",
        snippet=r.get("snippet"),
        type=r.get("type") or "article",
        provider=r.get("provider") or "duckduckgo",
        author_name=r.get("author_name"),
        author_handle=r.get("author_handle"),
        likes=r.get("likes"),
        retweets=r.get("retweets"),
        views=r.get("views"),
        followers=r.get("followers"),
        published_at=r.get("published_at"),
    )


@router.get("/social/search", response_model=SocialResponse)
async def social_search(
    q: str = Query(..., min_length=1, max_length=120),
    limit: int = Query(10, ge=1, le=20),
) -> SocialResponse:
    """Run the web research fallback chain for an ad-hoc query."""
    q = q.strip()
    if not q:
        raise HTTPException(status_code=400, detail="empty query")
    researcher = WebResearcher()
    try:
        results = await researcher.search(q, max_results=limit)
    except Exception as exc:  # noqa: BLE001
        logger.warning("social search failed for {!r}: {}", q, exc)
        results = []
    # Sort: keep X on top (tweets carry the meme narrative), then by length/signal.
    results.sort(
        key=lambda r: (
            0 if r.get("type") == "tweet" else 1,
            -int(r.get("likes") or 0),
        )
    )
    return SocialResponse(
        query=q,
        provider_chain=researcher.provider,
        items=[_as_mention(r) for r in results[:limit]],
        fetched_at=datetime.utcnow(),
    )
