"""Web research layer used to enrich DNA families.

Provider precedence (first available wins):

1. Tavily                (if ``TAVILY_API_KEY`` set) - best structured results
2. SerpAPI               (if ``SERPAPI_API_KEY`` set) - Google SERP mirror
3. Jina Reader / Search  - free, key-less, inspired by Agent-Reach
   (https://github.com/Panniantong/Agent-Reach)

Even without paid keys, MemeDNA can still do useful research by hitting
Jina's public endpoints:

  - ``https://s.jina.ai/<query>``   → web search results (markdown)
  - ``https://r.jina.ai/<url>``     → webpage cleaned to markdown

These are generous rate-limit ed anonymous endpoints; above a light load
Jina recommends using an API key, which ``JINA_API_KEY`` adds to requests.
"""

from __future__ import annotations

import asyncio
import os
import re
import time
from typing import Any
from urllib.parse import quote

import httpx
from loguru import logger

from ..config import get_settings
from .x_search import search_x, tweets_to_snippets


# ---------------------------------------------------------------------------
# Process-wide circuit breaker
# ---------------------------------------------------------------------------
# Hitting a dead/quota'd provider once per query ballooned Lab Report response
# time to minutes when tavily returned 432 or serpapi returned 429 — each
# query blew through a 20s timeout before falling through to the next
# provider, and ``_attach_social_signals`` dispatches 5-6 queries.
#
# The breaker is just a mapping ``provider_name → epoch_when_usable_again``.
# When a call fails with a "don't retry soon" status the provider gets shelved
# for ``_COOLDOWN_AFTER_FAILURE_S``. Subsequent calls skip it entirely, so a
# quota-exhausted Tavily now costs us ~0 ms instead of 6s × N queries.
_PROVIDER_COOLDOWN_UNTIL: dict[str, float] = {}
_COOLDOWN_AFTER_FAILURE_S = 90.0

# Status codes that mean "don't hammer me" — we cool the provider down.
# 432 is Tavily's quota-exhausted code, 402 = payment required (Jina),
# 401/403 = auth wrong, 5xx = provider on fire.
_COOLDOWN_STATUSES: frozenset[int] = frozenset({401, 402, 403, 429, 432, 500, 502, 503, 504})


def _trip_breaker(name: str, reason: str) -> None:
    _PROVIDER_COOLDOWN_UNTIL[name] = time.monotonic() + _COOLDOWN_AFTER_FAILURE_S
    logger.info(
        "web-research: cooling down provider={!r} for {}s ({})",
        name, int(_COOLDOWN_AFTER_FAILURE_S), reason,
    )


def _is_tripped(name: str) -> bool:
    until = _PROVIDER_COOLDOWN_UNTIL.get(name)
    if until is None:
        return False
    if time.monotonic() >= until:
        _PROVIDER_COOLDOWN_UNTIL.pop(name, None)
        return False
    return True


def _maybe_trip_from_http_error(name: str, exc: BaseException) -> None:
    """If ``exc`` is an HTTPStatusError with a cool-down-worthy code, trip."""
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        if code in _COOLDOWN_STATUSES:
            _trip_breaker(name, f"HTTP {code}")


class WebResearcher:
    """Pluggable multi-provider web research client."""

    def __init__(self) -> None:
        s = get_settings()
        self.serpapi_key = s.serpapi_api_key
        self.tavily_key = s.tavily_api_key
        self.jina_key = s.jina_api_key
        # X (Twitter) cookie-auth scraping. Opt-in: set both secrets
        # on a **dedicated alt account**, never your main one.
        self.x_auth = os.getenv("TWITTER_AUTH_TOKEN") or ""
        self.x_ct0 = os.getenv("TWITTER_CT0") or ""
        # Per-provider HTTP timeout. Kept tight (was 20s) so a slow/dead
        # provider degrades in <10s rather than blocking the whole chain.
        self._timeout = 6.0
        # Hard per-query budget across all providers for this query.
        # ``search()`` enforces it via ``asyncio.wait_for``. Keeps a single
        # query from swallowing the caller's total budget.
        self._query_budget_s = 9.0

    # ---- public --------------------------------------------------------

    @property
    def enabled(self) -> bool:
        """We always have *some* web-research capability thanks to Jina."""
        return True

    @property
    def provider(self) -> str:
        parts: list[str] = []
        if self.x_auth and self.x_ct0:
            parts.append("x")
        if self.tavily_key:
            parts.append("tavily")
        if self.serpapi_key:
            parts.append("serpapi")
        if self.jina_key:
            parts.append("jina")
        parts.append("duckduckgo")
        return " → ".join(parts)

    async def search(self, query: str, max_results: int = 8) -> list[dict[str, Any]]:
        """Main entry. Never raises; degrades to [] on repeated failures.

        Fallback chain:

        1. ``X (Twitter)`` - if cookies are present. Meme-token narratives
           are born here; we want the tweets that triggered the wave.
        2. ``Tavily`` (if keyed) - highest-quality structured SERP
        3. ``SerpAPI`` (if keyed) - Google SERP mirror
        4. ``Jina Search`` (if keyed) - Agent-Reach style
        5. ``DuckDuckGo HTML`` - always-on keyless fallback

        Providers that have recently returned a cooldown-worthy HTTP
        status (429/432/5xx/…) are skipped via the process-wide circuit
        breaker so we don't burn the whole query budget on a provider we
        already know is dead.

        The entire ``search()`` call is bounded by ``_query_budget_s`` —
        on timeout we return whatever partial results we already have
        (typically zero) rather than letting one slow query stall the
        caller. This is what keeps Lab Report responsive.
        """
        try:
            return await asyncio.wait_for(
                self._search_impl(query, max_results),
                timeout=self._query_budget_s,
            )
        except asyncio.TimeoutError:
            logger.info(
                "web-research: query budget exhausted after {}s for {!r}",
                self._query_budget_s, query[:60],
            )
            return []

    async def _search_impl(self, query: str, max_results: int) -> list[dict[str, Any]]:
        query = (query or "").strip()
        if not query:
            return []

        merged: list[dict[str, Any]] = []

        # Stage 1: X / Twitter (keyed, optional).
        if self.x_auth and self.x_ct0 and not _is_tripped("x"):
            try:
                tweets = await search_x(
                    query,
                    auth_token=self.x_auth,
                    ct0=self.x_ct0,
                    limit=max(3, max_results // 2),
                )
                merged.extend(tweets_to_snippets(tweets))
            except Exception as exc:  # noqa: BLE001
                logger.warning("X search failed: {}", exc)
                _maybe_trip_from_http_error("x", exc)

        # Stage 2: pick the first working general web provider and add its
        # results until we hit ``max_results``.
        providers: list[tuple[str, Any]] = []
        if self.tavily_key:
            providers.append(("tavily", self._tavily))
        if self.serpapi_key:
            providers.append(("serpapi", self._serpapi))
        if self.jina_key:
            providers.append(("jina", self._jina_search))
        providers.append(("duckduckgo", self._duckduckgo))

        for name, fn in providers:
            if _is_tripped(name):
                # Silent skip - debug only so a cool-down doesn't spam
                # the logs on every query.
                logger.debug("web-research: skipping {!r} (cooling down)", name)
                continue
            try:
                remaining = max_results - len(merged)
                if remaining <= 0:
                    break
                results = await fn(query, remaining)
                if results:
                    merged.extend(results)
                    break
            except Exception as exc:  # noqa: BLE001
                logger.warning("web research ({}) failed: {}", name, exc)
                _maybe_trip_from_http_error(name, exc)

        return merged[:max_results]

    async def read_url(self, url: str) -> str | None:
        """Clean-markdown version of ``url`` via Jina Reader. Returns None on error."""
        if not url:
            return None
        jina_url = f"https://r.jina.ai/{url}"
        headers = {"Accept": "text/markdown"}
        if self.jina_key:
            headers["Authorization"] = f"Bearer {self.jina_key}"
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(jina_url, headers=headers)
                resp.raise_for_status()
                return resp.text[:20_000]
        except Exception as exc:  # noqa: BLE001
            logger.debug("jina reader failed for {}: {}", url, exc)
            return None

    # ---- providers -----------------------------------------------------

    async def _tavily(self, query: str, max_results: int) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": self.tavily_key,
                    "query": query,
                    "max_results": max_results,
                    "search_depth": "basic",
                    "include_answer": False,
                },
            )
            resp.raise_for_status()
            data = resp.json()
        return [
            {
                "title": r.get("title"),
                "url": r.get("url"),
                "snippet": r.get("content"),
                "type": _guess_type(r.get("url", "")),
                "provider": "tavily",
            }
            for r in data.get("results", [])[:max_results]
        ]

    async def _serpapi(self, query: str, max_results: int) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(
                "https://serpapi.com/search.json",
                params={"q": query, "api_key": self.serpapi_key, "num": max_results},
            )
            resp.raise_for_status()
            data = resp.json()
        return [
            {
                "title": r.get("title"),
                "url": r.get("link"),
                "snippet": r.get("snippet"),
                "type": _guess_type(r.get("link", "")),
                "provider": "serpapi",
            }
            for r in data.get("organic_results", [])[:max_results]
        ]

    async def _jina_search(self, query: str, max_results: int) -> list[dict[str, Any]]:
        """Jina s.jina.ai returns markdown; we parse the first N result blocks.

        As of late 2025 the anonymous endpoint started returning 401 for most
        requests, so we only call this when ``JINA_API_KEY`` is set.
        """
        url = f"https://s.jina.ai/{quote(query)}"
        headers = {"Accept": "application/json", "X-Respond-With": "no-content"}
        if self.jina_key:
            headers["Authorization"] = f"Bearer {self.jina_key}"
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code in (401, 402):
                return []
            resp.raise_for_status()
            ctype = resp.headers.get("content-type", "")
            if "json" in ctype:
                return _parse_jina_json(resp.json(), max_results)
            return _parse_jina_markdown(resp.text, max_results)

    async def _duckduckgo(
        self, query: str, max_results: int
    ) -> list[dict[str, Any]]:
        """Genuinely keyless search via DuckDuckGo's HTML endpoint.

        DDG redirects SERP anchors through ``//duckduckgo.com/l/?uddg=…`` so we
        extract and decode the real URL. Less rich than Tavily, but zero-config
        and enough to seed external references.
        """
        url = "https://html.duckduckgo.com/html/"
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (compatible; MemeDNA/0.1; +https://memedna.ai)"
            ),
            "Accept-Language": "en-US,en;q=0.8",
        }
        async with httpx.AsyncClient(
            timeout=self._timeout,
            follow_redirects=True,
            headers=headers,
        ) as client:
            resp = await client.post(url, data={"q": query, "b": ""})
            resp.raise_for_status()
            return _parse_ddg_html(resp.text, max_results)


# ---- helpers ---------------------------------------------------------------


def _guess_type(url: str) -> str:
    u = (url or "").lower()
    if "twitter.com" in u or "x.com" in u:
        return "tweet"
    if "youtube.com" in u or "youtu.be" in u or "tiktok.com" in u:
        return "video"
    if "telegram.me" in u or "t.me" in u:
        return "telegram"
    if "reddit.com" in u:
        return "reddit"
    if "github.com" in u:
        return "github"
    return "article"


def _parse_jina_json(data: dict[str, Any], limit: int) -> list[dict[str, Any]]:
    rows = data.get("data") or data.get("results") or []
    out: list[dict[str, Any]] = []
    for r in rows[:limit]:
        out.append(
            {
                "title": r.get("title"),
                "url": r.get("url") or r.get("link"),
                "snippet": r.get("description") or r.get("content"),
                "type": _guess_type(r.get("url", "")),
                "provider": "jina",
            }
        )
    return out


_MARKDOWN_LINK = re.compile(r"^\s*\d+\.\s*\[([^\]]+)\]\(([^)]+)\)", re.MULTILINE)


def _parse_jina_markdown(text: str, limit: int) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for title, url in _MARKDOWN_LINK.findall(text)[:limit]:
        out.append(
            {
                "title": title.strip(),
                "url": url.strip(),
                "snippet": None,
                "type": _guess_type(url),
                "provider": "jina",
            }
        )
    return out


# DDG SERP anchor structure:
#   <a class="result__a" href="//duckduckgo.com/l/?uddg=<encoded-url>&...">Title</a>
#   <a class="result__snippet" …>snippet text</a>
_DDG_RESULT = re.compile(
    r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>.*?'
    r'(?:<a[^>]+class="result__snippet"[^>]*>(.*?)</a>)?',
    re.DOTALL,
)
_HTML_TAG = re.compile(r"<[^>]+>")


def _parse_ddg_html(html: str, limit: int) -> list[dict[str, Any]]:
    from urllib.parse import parse_qs, unquote, urlparse

    out: list[dict[str, Any]] = []
    for match in _DDG_RESULT.finditer(html):
        href, raw_title, raw_snippet = match.groups()
        # DDG proxies outbound URLs as //duckduckgo.com/l/?uddg=<encoded>
        if href.startswith("//"):
            href = "https:" + href
        parsed = urlparse(href)
        if parsed.netloc.endswith("duckduckgo.com"):
            qs = parse_qs(parsed.query)
            if "uddg" in qs:
                href = unquote(qs["uddg"][0])
        title = _HTML_TAG.sub("", raw_title or "").strip()
        snippet = _HTML_TAG.sub("", raw_snippet or "").strip() if raw_snippet else None
        if not href or not title:
            continue
        out.append(
            {
                "title": title,
                "url": href,
                "snippet": snippet,
                "type": _guess_type(href),
                "provider": "duckduckgo",
            }
        )
        if len(out) >= limit:
            break
    return out
