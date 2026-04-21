"""LLM-driven enrichment: cluster validation, web-research synthesis, per-mutation reasoning."""

from __future__ import annotations

import statistics
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import orjson
from loguru import logger

from ..cache import cache_get, cache_put
from ..models import Token
from .llm import get_llm
from .prompts import (
    CLUSTER_VALIDATION_NAME,
    CLUSTER_VALIDATION_SYSTEM,
    CLUSTER_VALIDATION_USER,
    CLUSTER_VALIDATION_VERSION,
    WEB_RESEARCH_NAME,
    WEB_RESEARCH_SYSTEM,
    WEB_RESEARCH_USER,
    WEB_RESEARCH_VERSION,
    WHY_BELONGS_NAME,
    WHY_BELONGS_SYSTEM,
    WHY_BELONGS_USER,
    WHY_BELONGS_VERSION,
)


@dataclass
class ClusterValidation:
    is_same_event: bool
    confidence: float
    event_title: str
    event_summary: str
    reasoning: str


def _tokens_block(tokens: list[Token]) -> str:
    lines = []
    for t in tokens[:30]:
        desc = (t.description or "").replace("\n", " ")[:180]
        lines.append(f"- {t.symbol} ({t.name}) at {t.created_at.isoformat()} | desc: {desc}")
    return "\n".join(lines)


def _median_gap_minutes(tokens: list[Token]) -> float:
    tss = sorted(t.created_at for t in tokens if t.created_at)
    if len(tss) < 2:
        return 0.0
    gaps = [(tss[i] - tss[i - 1]).total_seconds() / 60.0 for i in range(1, len(tss))]
    return round(statistics.median(gaps), 2)


async def validate_cluster(
    session, tokens: list[Token], archetype: str | None = None
) -> ClusterValidation:
    llm = get_llm()
    earliest = min(t.created_at for t in tokens)
    latest = max(t.created_at for t in tokens)

    payload_in = {
        "addresses": sorted(t.token_address for t in tokens),
        "version": CLUSTER_VALIDATION_VERSION,
        "archetype": archetype or "",
    }
    cached = cache_get(session, CLUSTER_VALIDATION_NAME, CLUSTER_VALIDATION_VERSION, payload_in)
    if cached:
        return ClusterValidation(**cached)

    if not llm.enabled:
        return _heuristic_validate(tokens, archetype=archetype)

    tokens_block = _tokens_block(tokens)
    if archetype:
        # Nudge the validator with a deterministic archetype hint so cluster
        # titles stay on-topic ("Dog meme tokens" rather than the generic
        # "Internet Mascot Meme Tokens" catch-all).
        tokens_block = (
            f"[archetype hint: all tokens below share the '{archetype}' "
            f"archetype - prefer a title that names it explicitly]\n"
            + tokens_block
        )
    user = CLUSTER_VALIDATION_USER.format(
        n=len(tokens),
        tokens_block=tokens_block,
        earliest_ts=earliest.isoformat(),
        latest_ts=latest.isoformat(),
        median_gap_minutes=_median_gap_minutes(tokens),
    )
    try:
        data = await llm.chat_json(
            CLUSTER_VALIDATION_SYSTEM, user, temperature=0.0, max_output_tokens=400
        )
    except Exception as exc:  # noqa: BLE001
        # Groq daily-quota (TPD), OpenAI daily-spend caps, transient 5xx -
        # don't poison the whole pipeline run. Fall back to the deterministic
        # archetype-aware validator so families still get published.
        err = str(exc).lower()
        is_quota = (
            "rate_limit" in err
            or "rate limit" in err
            or "429" in err
            or "insufficient_quota" in err
            or "quota" in err
        )
        level = logger.warning if is_quota else logger.error
        level(
            "validate_cluster: LLM failed ({}), using heuristic fallback for "
            "cluster of {} tokens (archetype={})",
            exc.__class__.__name__,
            len(tokens),
            archetype or "-",
        )
        return _heuristic_validate(tokens, archetype=archetype)
    cv = ClusterValidation(
        is_same_event=bool(data.get("is_same_event")),
        confidence=float(data.get("confidence") or 0.0),
        event_title=str(data.get("event_title") or ""),
        event_summary=str(data.get("event_summary") or ""),
        reasoning=str(data.get("reasoning") or ""),
    )
    cache_put(session, CLUSTER_VALIDATION_NAME, CLUSTER_VALIDATION_VERSION, payload_in, cv.__dict__)
    return cv


_STOPWORDS = {
    "the", "and", "for", "with", "from", "meme", "coin", "token", "bsc",
    "bnb", "usdt", "usd", "pump", "dump", "moon", "launch", "community",
}


def _heuristic_validate(
    tokens: list[Token], archetype: str | None = None
) -> ClusterValidation:
    """Offline / degraded-LLM fallback.

    The candidate cluster has already survived DBSCAN at ``eps=0.28`` -
    that is *already* a strong "same-event" signal (cosine < 0.28 in a
    normalised 1536-d OpenAI embedding space is genuinely tight). So we
    bias the fallback toward acceptance: the only hard rejection is a
    pathological cluster where no lexical structure survives either.

    Confidence ladder:
      archetype hit          -> 0.58
      shared keyword >= 50%  -> 0.55
      shared keyword >= 30%  -> 0.45
      no shared keyword      -> 0.40  (still accepted; titled by its
                                         earliest token's symbol)

    All four tiers clear the default ``min_confidence=0.35`` gate in
    ``_process_cluster`` so no archetype-less cluster is silently dropped
    when Groq is exhausted.
    """
    n = max(1, len(tokens))
    words: dict[str, int] = {}
    for t in tokens:
        for w in (t.symbol + " " + t.name).lower().split():
            w = "".join(ch for ch in w if ch.isalnum())
            if len(w) >= 3 and w not in _STOPWORDS:
                words[w] = words.get(w, 0) + 1
    top = sorted(words.items(), key=lambda x: -x[1])[:3]

    if archetype:
        title = f"{archetype.title()} meme wave"
        summary = f"Tokens cluster around the '{archetype}' archetype."
        return ClusterValidation(True, 0.58, title, summary, "Archetype heuristic.")

    if top and top[0][1] >= max(2, n // 2):
        kw = top[0][0]
        title = f"{kw.upper()} meme wave"
        return ClusterValidation(
            True, 0.55, title,
            f"Most tokens share the keyword '{kw}'.",
            "Offline heuristic; LLM unavailable.",
        )

    if top and top[0][1] >= max(2, (n + 2) // 3):
        kw = top[0][0]
        title = f"{kw.upper()} narrative"
        return ClusterValidation(
            True, 0.45, title,
            f"A third of the tokens share the keyword '{kw}'.",
            "Offline heuristic; LLM unavailable.",
        )

    # Pure-embedding cluster with no lexical signal. DBSCAN already vouched
    # that these tokens are semantically close - give them a placeholder
    # title based on the earliest token so the family surfaces in the UI
    # and a later LLM pass can rename it.
    tokens_sorted = sorted(tokens, key=lambda t: t.created_at)
    anchor = tokens_sorted[0]
    title = (anchor.symbol or anchor.name or "Emerging narrative").strip()[:60]
    return ClusterValidation(
        True, 0.40,
        f"{title} narrative",
        f"Semantic cluster around '{title}' and {n - 1} similar tokens.",
        "Offline heuristic; embedding-only cluster.",
    )


async def synthesise_research(
    session, event_title: str, snippets: list[dict[str, Any]]
) -> dict[str, Any]:
    llm = get_llm()
    if not llm.enabled or not snippets:
        return {"timeline_of_event": [], "references": _snippet_to_refs(snippets)}

    payload_in = {"title": event_title, "urls": sorted(s.get("url", "") for s in snippets)}
    cached = cache_get(session, WEB_RESEARCH_NAME, WEB_RESEARCH_VERSION, payload_in)
    if cached:
        return cached

    user = WEB_RESEARCH_USER.format(
        event_title=event_title, search_results_json=orjson.dumps(snippets[:10]).decode()
    )
    try:
        data = await llm.chat_json(
            WEB_RESEARCH_SYSTEM, user, temperature=0.1, max_output_tokens=600
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "synthesise_research: LLM failed ({}), returning raw references only",
            exc.__class__.__name__,
        )
        return {"timeline_of_event": [], "references": _snippet_to_refs(snippets)}
    data.setdefault("timeline_of_event", [])
    data.setdefault("references", _snippet_to_refs(snippets))
    cache_put(session, WEB_RESEARCH_NAME, WEB_RESEARCH_VERSION, payload_in, data)
    return data


def _snippet_to_refs(snips: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for s in snips:
        url = s.get("url") or ""
        if not url or url in seen:
            continue
        seen.add(url)
        out.append({"url": url, "type": s.get("type") or "other", "title": s.get("title")})
    return out


async def explain_mutation(
    session,
    event_title: str,
    event_summary: str,
    family_earliest: datetime,
    token: Token,
) -> str:
    llm = get_llm()
    payload_in = {
        "event_title": event_title,
        "token": token.token_address,
        "content_hash": token.content_hash,
    }
    cached = cache_get(session, WHY_BELONGS_NAME, WHY_BELONGS_VERSION, payload_in)
    if cached:
        return cached.get("why_this_mutation_belongs", "")

    if not llm.enabled:
        reason = _heuristic_reason(event_title, token)
        cache_put(
            session,
            WHY_BELONGS_NAME,
            WHY_BELONGS_VERSION,
            payload_in,
            {"why_this_mutation_belongs": reason},
        )
        return reason

    user = WHY_BELONGS_USER.format(
        event_title=event_title,
        event_summary=event_summary,
        symbol=token.symbol,
        name=token.name,
        description=(token.description or "")[:240],
        created_at=token.created_at.isoformat(),
        earliest_ts=family_earliest.isoformat(),
    )
    try:
        data = await llm.chat_json(WHY_BELONGS_SYSTEM, user, temperature=0.2, max_output_tokens=180)
    except Exception as exc:  # noqa: BLE001
        logger.warning("why_belongs LLM failed for {}: {}", token.token_address, exc)
        reason = _heuristic_reason(event_title, token)
    else:
        reason = str(data.get("why_this_mutation_belongs") or "").strip()
        if not reason:
            reason = _heuristic_reason(event_title, token)

    cache_put(
        session,
        WHY_BELONGS_NAME,
        WHY_BELONGS_VERSION,
        payload_in,
        {"why_this_mutation_belongs": reason},
    )
    return reason


def _heuristic_reason(event_title: str, token: Token) -> str:
    tokens_lower = (token.symbol + " " + token.name + " " + (token.description or "")).lower()
    keywords = [w for w in event_title.lower().split() if len(w) >= 3][:3]
    hits = [k for k in keywords if k in tokens_lower]
    if hits:
        return f"Mentions '{hits[0]}' in symbol/name/description, matching the family theme."
    return f"Launched close to the family window at {token.created_at.isoformat()}."
