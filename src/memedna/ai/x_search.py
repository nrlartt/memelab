"""X / Twitter search provider for WebResearcher.

Cookie-authenticated, Python-native. No Node subprocess, no third-party
scraper dependency.  Uses the exact same pair of secrets the CoinTheHat
twitter-scraper relies on (``auth_token`` + ``ct0``).

Why we want this
----------------
For meme-token archetypes the ``source_center`` almost always lives on X
(tweet that sparked the copycat wave).  Tavily / SerpAPI / DuckDuckGo
surface X results but can't scroll inside them; scraping X directly gives
us:

  - the *original tweet text*  → feeds summaries, centers, timeline
  - follower / view / like counts → ranks candidates for ``source_center``
  - tweet URL + author → ``source_url``

Security & ethics
-----------------
- Cookies never leave the server process.
- The endpoint we hit is the one every browser logged into x.com uses.
- If cookies are missing or invalid, we simply return no results - every
  caller must gracefully degrade to another research provider.
- A single cookie pair should be used from a dedicated secondary X
  account, *never* the user's primary account (rate-limit / ban risk).
"""

from __future__ import annotations

import os
from typing import Any

import httpx
from loguru import logger

# Public Bearer used by x.com's web client. Constant across all users.
_X_BEARER = (
    "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs"
    "=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"
)

_SEARCH_URL = (
    "https://x.com/i/api/graphql/nK1dw4oV3k4w5TdtcAdSww/SearchTimeline"
)

_DEFAULT_TIMEOUT = 12.0


def _auth_headers(auth_token: str, ct0: str) -> dict[str, str]:
    return {
        "authorization": _X_BEARER,
        "x-csrf-token": ct0,
        "cookie": f"auth_token={auth_token}; ct0={ct0}",
        "accept": "*/*",
        "accept-language": "en-US,en;q=0.9",
        "content-type": "application/json",
        "user-agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/125.0 Safari/537.36"
        ),
        "x-twitter-client-language": "en",
        "x-twitter-active-user": "yes",
        "x-twitter-auth-type": "OAuth2Session",
    }


def _variables(query: str, count: int) -> str:
    import orjson

    return orjson.dumps(
        {
            "rawQuery": query,
            "count": count,
            "querySource": "typed_query",
            "product": "Top",
        }
    ).decode()


def _features() -> str:
    # X's GraphQL requires a giant feature-flag blob; these are the flags
    # active in the current web client as of 2026. If X flips a flag and
    # returns 400, we log and return no results - the research chain
    # simply falls through to the next provider.
    import orjson

    return orjson.dumps(
        {
            "rweb_video_screen_enabled": False,
            "profile_label_improvements_pcf_label_in_post_enabled": True,
            "rweb_tipjar_consumption_enabled": True,
            "verified_phone_label_enabled": False,
            "creator_subscriptions_tweet_preview_api_enabled": True,
            "responsive_web_graphql_timeline_navigation_enabled": True,
            "responsive_web_graphql_skip_user_profile_image_extensions_enabled": False,
            "premium_content_api_read_enabled": False,
            "communities_web_enable_tweet_community_results_fetch": True,
            "c9s_tweet_anatomy_moderator_badge_enabled": True,
            "responsive_web_grok_analyze_button_fetch_trends_enabled": False,
            "responsive_web_grok_analyze_post_followups_enabled": True,
            "responsive_web_jetfuel_frame": False,
            "responsive_web_grok_share_attachment_enabled": True,
            "articles_preview_enabled": True,
            "responsive_web_edit_tweet_api_enabled": True,
            "graphql_is_translatable_rweb_tweet_is_translatable_enabled": True,
            "view_counts_everywhere_api_enabled": True,
            "longform_notetweets_consumption_enabled": True,
            "responsive_web_twitter_article_tweet_consumption_enabled": True,
            "tweet_awards_web_tipping_enabled": False,
            "responsive_web_grok_show_grok_translated_post": False,
            "responsive_web_grok_analysis_button_from_backend": True,
            "creator_subscriptions_quote_tweet_preview_enabled": False,
            "freedom_of_speech_not_reach_fetch_enabled": True,
            "standardized_nudges_misinfo": True,
            "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": True,
            "longform_notetweets_rich_text_read_enabled": True,
            "longform_notetweets_inline_media_enabled": True,
            "responsive_web_grok_image_annotation_enabled": True,
            "responsive_web_grok_imagine_annotation_enabled": True,
            "responsive_web_grok_community_note_auto_translation_is_enabled": False,
            "responsive_web_enhance_cards_enabled": False,
        }
    ).decode()


def _extract_tweets(data: dict[str, Any], limit: int) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    try:
        instructions = (
            data["data"]["search_by_raw_query"]["search_timeline"]["timeline"][
                "instructions"
            ]
        )
    except (KeyError, TypeError):
        return []

    def _walk(entries: list[dict[str, Any]]) -> None:
        for e in entries:
            content = e.get("content") or {}
            item = content.get("itemContent") or {}
            if item.get("itemType") != "TimelineTweet":
                # Top-level modules (quoted tweets, carousels) nest one level
                items = (content.get("items") or [])
                if items:
                    _walk(
                        [{"content": i.get("item", {}).get("itemContent", {})}
                         for i in items]
                    )
                continue
            tres = item.get("tweet_results", {}).get("result") or {}
            if tres.get("__typename") == "TweetWithVisibilityResults":
                tres = tres.get("tweet") or {}
            if not tres:
                continue
            legacy = tres.get("legacy") or {}
            core = (
                tres.get("core", {})
                .get("user_results", {})
                .get("result", {})
                .get("legacy")
                or {}
            )
            tid = tres.get("rest_id") or legacy.get("id_str")
            screen_name = core.get("screen_name") or ""
            out.append(
                {
                    "id": tid,
                    "text": legacy.get("full_text") or "",
                    "author_name": core.get("name") or "",
                    "author_handle": screen_name,
                    "followers": int(core.get("followers_count") or 0),
                    "likes": int(legacy.get("favorite_count") or 0),
                    "retweets": int(legacy.get("retweet_count") or 0),
                    "views": int(
                        (tres.get("views") or {}).get("count", 0) or 0
                    ),
                    "created_at": legacy.get("created_at") or "",
                    "url": f"https://x.com/{screen_name}/status/{tid}"
                    if screen_name and tid
                    else None,
                }
            )
            if len(out) >= limit:
                return

    for ins in instructions:
        if len(out) >= limit:
            break
        if ins.get("type") == "TimelineAddEntries":
            _walk(ins.get("entries") or [])

    return out


async def search_x(
    query: str,
    *,
    auth_token: str | None = None,
    ct0: str | None = None,
    limit: int = 8,
    timeout: float = _DEFAULT_TIMEOUT,
) -> list[dict[str, Any]]:
    """Run a single SearchTimeline query against x.com.

    Returns an empty list on any auth / rate-limit failure (never raises).
    The caller (``WebResearcher``) should treat an empty list as "this
    provider produced no results" and fall through to the next one.
    """
    token = auth_token or os.getenv("TWITTER_AUTH_TOKEN") or ""
    csrf = ct0 or os.getenv("TWITTER_CT0") or ""
    if not token or not csrf:
        return []

    params = {
        "variables": _variables(query, limit),
        "features": _features(),
    }

    try:
        async with httpx.AsyncClient(
            timeout=timeout,
            headers=_auth_headers(token, csrf),
        ) as client:
            resp = await client.get(_SEARCH_URL, params=params)
        if resp.status_code == 429:
            logger.warning("X search 429 rate limited for query {!r}", query)
            return []
        if resp.status_code in (401, 403):
            logger.warning(
                "X search auth failed ({}); cookie likely expired.",
                resp.status_code,
            )
            return []
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:  # noqa: BLE001
        logger.debug("X search failed ({}): {}", type(exc).__name__, exc)
        return []

    tweets = _extract_tweets(data, limit)
    logger.debug("X search '{}' → {} tweets", query, len(tweets))
    return tweets


def tweets_to_snippets(tweets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Coerce X results into the standard ``WebResearcher`` result shape.

    Emits the same keys as the other providers (``title``, ``url``,
    ``snippet``, ``type``, ``provider``) plus a handful of X-specific
    engagement fields that the UI uses to render proper tweet cards.
    """
    out: list[dict[str, Any]] = []
    for t in tweets:
        body = t.get("text") or ""
        if not body:
            continue
        handle = t.get("author_handle") or "anonymous"
        out.append(
            {
                "url": t.get("url") or "",
                "title": f"@{handle}",
                "snippet": body[:500],
                "type": "tweet",
                "provider": "x",
                "author_name": t.get("author_name") or handle,
                "author_handle": handle,
                "followers": t.get("followers", 0),
                "likes": t.get("likes", 0),
                "retweets": t.get("retweets", 0),
                "views": t.get("views", 0),
                "published_at": t.get("created_at"),
                # Legacy keys for older consumers:
                "source": "x",
                "meta": {
                    "author": handle,
                    "followers": t.get("followers", 0),
                    "likes": t.get("likes", 0),
                    "views": t.get("views", 0),
                    "created_at": t.get("created_at"),
                },
            }
        )
    return out
