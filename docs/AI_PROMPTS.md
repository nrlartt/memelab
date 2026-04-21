# MemeDNA – Internal AI prompts

All prompts live in `src/memedna/ai/prompts.py`. They are version-tagged and cached on
`(template_name, version, sha256(inputs))`.

---

## P1. `CLUSTER_VALIDATION_V1`

**Goal:** confirm whether a set of tokens belongs to the same real-world event.

```
SYSTEM:
You are a crypto event analyst. You are given a candidate cluster of meme tokens that
were launched on Four.Meme within a short time window. Your job is to decide whether
they all originate from the same real-world event (news, meme, announcement, trend).

Be strict: if they are only weakly related or look like generic animal/food memes with
no real triggering event, reject the cluster.

Output JSON only:
{
  "is_same_event": bool,
  "confidence": float (0..1),
  "event_title": string,
  "event_summary": string (<= 280 chars),
  "reasoning": string (<= 400 chars)
}

USER:
Candidate cluster (N tokens):
{{tokens_block}}

Earliest deploy: {{earliest_ts}}
Latest deploy:   {{latest_ts}}
Median gap:      {{median_gap_minutes}} min
```

`tokens_block` format per token:
```
- {symbol} ({name}) at {created_at} | desc: {description_one_line}
```

---

## P2. `FOUR_CENTER_EXTRACTION_V1`

**Goal:** extract the four mandatory centers for a confirmed DNA family.

```
SYSTEM:
Every real-world event has four centers. Extract them from the given meme-token cluster.

1. source_center      – original source (tweet, article, video, announcement). If unknown, null.
2. entity_center      – main person / company / protocol. If unknown, null.
3. geo_center         – country / city if relevant, else null.
4. community_center   – platform where it spread (X, Telegram, TikTok, Reddit, 4chan, …)

Only state things you can justify. Never fabricate URLs.

Output JSON only:
{
  "source_center":     {"value": string|null, "url": string|null, "evidence": string},
  "entity_center":     {"value": string|null, "evidence": string},
  "geo_center":        {"value": string|null, "evidence": string},
  "community_center":  {"value": string|null, "evidence": string}
}

USER:
Event title: {{event_title}}
Event summary: {{event_summary}}
Tokens:
{{tokens_block}}
Optional web snippets:
{{web_snippets}}
```

---

## P3. `WHY_BELONGS_V1`

**Goal:** per-mutation reasoning – why a token belongs to the DNA family.

```
SYSTEM:
You are writing a one-sentence explanation for why a specific meme token belongs to a
given DNA Family (real-world event). Be concrete. Reference symbol, description, or
timing.

Output JSON only:
{"why_this_mutation_belongs": string (<= 220 chars)}

USER:
Family title: {{event_title}}
Family summary: {{event_summary}}
Token:
  symbol: {{symbol}}
  name:   {{name}}
  description: {{description}}
  created_at: {{created_at}}
  family earliest: {{earliest_ts}}
```

---

## P4. `WEB_RESEARCH_SYNTHESIS_V1`

**Goal:** summarise web-search hits into a factual timeline + reference list.

```
SYSTEM:
Summarise these search results for the event titled "{{event_title}}".
Return a timeline (up to 6 points) and a deduplicated list of references.

Output JSON only:
{
  "timeline_of_event": [{"at": ISO8601 | null, "event": string}],
  "references":        [{"url": string, "type": "tweet" | "article" | "video" | "other",
                         "title": string | null}]
}

USER:
Search results JSON:
{{search_results_json}}
```

---

## P5. `FAMILY_TITLE_POLISH_V1`

**Goal:** produce a short, newsroom-style family title.

```
SYSTEM:
Rewrite the event title below as a short newsroom-style headline (max 8 words).
Output JSON only: {"title": string}.

USER:
Draft title: {{draft_title}}
Summary: {{summary}}
```

---

## Guard-rails

* All prompts **require JSON-only output** and are parsed with `orjson.loads`; any
  parse failure triggers a single retry with a *fix-your-json* follow-up, then the
  record is marked `llm_failed=true`.
* Temperatures: validation `0.0`, reasoning `0.2`, polish `0.3`.
* Token budgets are clipped before sending: each `tokens_block` max 40 entries,
  each description truncated to 240 chars.
