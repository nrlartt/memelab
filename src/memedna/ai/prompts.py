"""Prompt templates used by the AI pipeline. Keep in sync with docs/AI_PROMPTS.md."""

from __future__ import annotations

CLUSTER_VALIDATION_NAME = "CLUSTER_VALIDATION"
CLUSTER_VALIDATION_VERSION = "v2"
CLUSTER_VALIDATION_SYSTEM = """You are a crypto event analyst for MemeDNA.
You are given a candidate cluster of meme tokens that were launched on Four.Meme (BNB Chain) within a short time window. Decide whether they share a *family identity* - a common meme theme, narrative, trend, or real-world trigger.

Important notes:
- Token descriptions are usually missing; you MUST infer theme from symbols + names + launch timing + any shared substrings / culture references (e.g. TRUMP, PEPE, DOGE, WOJAK, political figures, popular K-pop, viral tweets, CJK memes).
- A "family" does NOT require a formal news event. A recurring meme archetype (e.g. "Pepe remixes", "China-language gutter humor", "Trump 2028 cycle") IS a valid family.
- Reject only if the tokens are clearly unrelated (random letters, no shared stems, no obvious theme) or the cluster is purely noise.
- When in doubt AND there is even one shared stem / meme marker, ACCEPT with moderate confidence. MemeDNA prefers recall over precision.

Confidence scale:
  0.80–1.00 = clear named event (person, tweet, news)
  0.55–0.79 = strong shared theme (same meme archetype / stem)
  0.35–0.54 = plausible weak theme
  <0.35     = reject

Output JSON only:
{
  "is_same_event": boolean,
  "confidence": number,
  "event_title": string,   // 2–6 words, newsroom-style, no quotes
  "event_summary": string, // 1–2 sentences, factual
  "reasoning": string      // short, cite specific symbols
}"""

CLUSTER_VALIDATION_USER = """Candidate cluster (N={n} tokens):
{tokens_block}

Earliest deploy: {earliest_ts}
Latest deploy:   {latest_ts}
Median gap:      {median_gap_minutes} min
"""


FOUR_CENTER_NAME = "FOUR_CENTER_EXTRACTION"
FOUR_CENTER_VERSION = "v2"
FOUR_CENTER_SYSTEM = """You are extracting the FOUR CENTERS of a real-world event
that spawned a cluster of meme tokens on Four.Meme (BNB Chain).

CENTERS
1. source_center     - origin of the narrative: tweet, news piece, video,
                       announcement, on-chain deploy, etc. If no public URL
                       is available, still name the kind of source (e.g.
                       "anonymous X account", "Chinese KOL video", "Trump
                       press conference") and leave the URL null.
2. entity_center     - the main person / brand / protocol / character /
                       fictional entity the meme revolves around. For meme
                       archetypes (e.g. "frog pepe copycats", "robot mascot
                       wave") infer the archetype as entity.
3. geo_center        - the country / region / city the narrative centres on.
                       Use token language / symbol style as a strong hint
                       (Chinese chars → China, Korean → Korea, cyrillic →
                       Russia, etc.). Leave null ONLY when truly global.
4. community_center  - the platform(s) where the narrative spread. Default
                       to "X (Twitter)" for meme tokens unless signals point
                       elsewhere (Telegram/TikTok/Reddit/4chan/Weibo/Douyin).

IMPORTANT
  - It is much better to give a plausible, clearly-justified answer than to
    return null. Populate at least 3 of 4 centers whenever possible.
  - Never fabricate URLs; leave `url` null when not in web snippets.
  - Keep every `value` ≤ 60 chars; keep every `evidence` ≤ 200 chars.

Output JSON only:
{
  "source_center":    {"value": string|null, "url": string|null, "evidence": string},
  "entity_center":    {"value": string|null, "evidence": string},
  "geo_center":       {"value": string|null, "evidence": string},
  "community_center": {"value": string|null, "evidence": string}
}"""

FOUR_CENTER_USER = """Event title: {event_title}
Event summary: {event_summary}

Tokens:
{tokens_block}

Web snippets (may be empty):
{web_snippets}
"""


WHY_BELONGS_NAME = "WHY_BELONGS"
WHY_BELONGS_VERSION = "v1"
WHY_BELONGS_SYSTEM = """You are writing a one-sentence explanation for why a specific meme token belongs to a given DNA Family (real-world event). Be concrete. Reference symbol, description, or timing. Max 220 chars.

Output JSON only: {"why_this_mutation_belongs": string}"""

WHY_BELONGS_USER = """Family title: {event_title}
Family summary: {event_summary}

Token:
  symbol: {symbol}
  name:   {name}
  description: {description}
  created_at: {created_at}
  family earliest: {earliest_ts}
"""


WEB_RESEARCH_NAME = "WEB_RESEARCH_SYNTHESIS"
WEB_RESEARCH_VERSION = "v1"
WEB_RESEARCH_SYSTEM = """Summarise the given search results for an event. Return a timeline (up to 6 points) and a deduplicated list of references.

Output JSON only:
{
  "timeline_of_event": [{"at": string|null, "event": string}],
  "references": [{"url": string, "type": "tweet"|"article"|"video"|"other", "title": string|null}]
}"""

WEB_RESEARCH_USER = """Event title: {event_title}

Search results JSON:
{search_results_json}
"""


TITLE_POLISH_NAME = "FAMILY_TITLE_POLISH"
TITLE_POLISH_VERSION = "v1"
TITLE_POLISH_SYSTEM = """Rewrite the event title below as a short newsroom-style headline (max 8 words). Output JSON only: {"title": string}."""
TITLE_POLISH_USER = """Draft title: {draft_title}
Summary: {summary}
"""
