"""Four-center extraction for a DNA family.

Two-stage design:

1. Ask the LLM (v2 prompt is already lenient and asks it to populate at
   least 3 of 4 centers whenever possible).
2. Whatever it returns is then passed through `_enrich_with_heuristics` so
   that even null values get a sensible default. For Four.Meme meme-coins
   the community center is almost always X/Twitter, the entity center is
   almost always the meme archetype in the family title, and the geo
   center can often be inferred from the script used in token symbols.
"""

from __future__ import annotations

import re
from typing import Any

import orjson

from ..cache import cache_get, cache_put
from ..models import Token
from .llm import get_llm
from .prompts import (
    FOUR_CENTER_NAME,
    FOUR_CENTER_SYSTEM,
    FOUR_CENTER_USER,
    FOUR_CENTER_VERSION,
)


def _tokens_block(tokens: list[Token]) -> str:
    lines = []
    for t in tokens[:20]:
        desc = (t.description or "").replace("\n", " ")[:200]
        lines.append(f"- {t.symbol} ({t.name}) @ {t.created_at.isoformat()} | {desc}")
    return "\n".join(lines)


async def extract_centers(
    session,
    event_title: str,
    event_summary: str,
    tokens: list[Token],
    web_snippets: list[dict[str, Any]],
) -> dict[str, Any]:
    llm = get_llm()

    payload_in = {
        "event_title": event_title,
        "event_summary": event_summary,
        "tokens": [t.token_address for t in tokens[:20]],
        "web_snippets_hash": _hash_snippets(web_snippets),
    }
    cached = cache_get(session, FOUR_CENTER_NAME, FOUR_CENTER_VERSION, payload_in)
    if cached:
        return _enrich_with_heuristics(cached, event_title, event_summary, tokens)

    data: dict[str, Any] = {}
    if llm.enabled:
        user = FOUR_CENTER_USER.format(
            event_title=event_title,
            event_summary=event_summary,
            tokens_block=_tokens_block(tokens),
            web_snippets=orjson.dumps(web_snippets[:8]).decode(),
        )
        try:
            data = await llm.chat_json(
                FOUR_CENTER_SYSTEM, user, temperature=0.0, max_output_tokens=500
            )
        except Exception:  # noqa: BLE001
            data = {}

    enriched = _enrich_with_heuristics(data, event_title, event_summary, tokens)
    cache_put(session, FOUR_CENTER_NAME, FOUR_CENTER_VERSION, payload_in, enriched)
    return enriched


def _hash_snippets(snips: list[dict[str, Any]]) -> str:
    import hashlib

    blob = orjson.dumps([s.get("url") for s in snips], option=orjson.OPT_SORT_KEYS)
    return hashlib.sha256(blob).hexdigest()


# ── heuristic fill-ins ───────────────────────────────────────────────────

_HAN = re.compile(r"[\u4e00-\u9fff]")
_HIRAGANA = re.compile(r"[\u3040-\u30ff]")
_HANGUL = re.compile(r"[\uac00-\ud7af]")
_CYRILLIC = re.compile(r"[\u0400-\u04ff]")
_ARABIC = re.compile(r"[\u0600-\u06ff]")


def _script_to_region(text: str) -> str | None:
    """Infer geo from dominant Unicode block in the cluster's symbols."""
    if _HIRAGANA.search(text):
        return "Japan"
    if _HANGUL.search(text):
        return "South Korea"
    if _HAN.search(text):
        return "Greater China"
    if _CYRILLIC.search(text):
        return "Russia / CIS"
    if _ARABIC.search(text):
        return "Arabic-speaking regions"
    return None


def _archetype_from_title(title: str) -> str | None:
    """Pull the core meme archetype out of the family title.

    E.g. "Cute Mascot & Robot Meme Wave" → "Cute Mascot & Robot".
    """
    t = (title or "").strip()
    if not t:
        return None
    for trailer in (" Meme Wave", " meme wave", " Launches", " Cluster", " Family"):
        if t.endswith(trailer):
            t = t[: -len(trailer)]
    return t[:60] or None


def _ensure(block: Any) -> dict[str, Any]:
    if isinstance(block, dict):
        return dict(block)
    return {}


def _enrich_with_heuristics(
    data: dict[str, Any],
    event_title: str,
    event_summary: str,
    tokens: list[Token],
) -> dict[str, Any]:
    """Fill null fields with best-effort heuristics so the UI never has 4
    empty cards for a legitimate cluster."""
    out = {
        "source_center": _ensure(data.get("source_center")),
        "entity_center": _ensure(data.get("entity_center")),
        "geo_center": _ensure(data.get("geo_center")),
        "community_center": _ensure(data.get("community_center")),
    }

    # community: almost always X for Four.Meme
    if not out["community_center"].get("value"):
        out["community_center"] = {
            "value": "X (Twitter)",
            "evidence": (
                "Default for Four.Meme launches - virality on Four.Meme is "
                "overwhelmingly driven by X even when no specific thread is "
                "linked."
            ),
        }

    # entity: the family title's archetype
    if not out["entity_center"].get("value"):
        archetype = _archetype_from_title(event_title)
        if archetype:
            out["entity_center"] = {
                "value": archetype,
                "evidence": f"Inferred from the cluster's archetype: \"{event_title}\".",
            }

    # geo: dominant script in token symbols
    if not out["geo_center"].get("value"):
        symbol_blob = " ".join(
            f"{t.symbol or ''} {t.name or ''}" for t in tokens[:40]
        )
        region = _script_to_region(symbol_blob)
        if region:
            out["geo_center"] = {
                "value": region,
                "evidence": (
                    f"Dominant script in this cluster's token symbols "
                    f"indicates {region}."
                ),
            }

    # source: keep null if truly unknown but never leave UI blank - mark as
    # "on-chain deploy burst" so the UX signals we know *something*.
    if not out["source_center"].get("value"):
        out["source_center"] = {
            "value": "On-chain deploy burst",
            "url": None,
            "evidence": (
                "No specific public source was surfaced by research. The "
                "cluster was identified from synchronized Four.Meme TokenCreate "
                "events."
            ),
        }

    return out
