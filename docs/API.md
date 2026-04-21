# MemeDNA – API reference

All endpoints return JSON. Base URL: `http://<host>:8000`.

---

## `GET /dna-families`

List DNA Families.

**Query parameters**

| Name               | Type    | Default | Description                              |
| ------------------ | ------- | ------- | ---------------------------------------- |
| `limit`            | int     | 20      | 1–100                                    |
| `offset`           | int     | 0       |                                          |
| `since_hours`      | int     | 24      | window used for ingestion cutoff         |
| `min_confidence`   | float   | 0.5     | LLM cluster confidence                   |
| `min_mutations`    | int     | 3       |                                          |
| `sort`             | enum    | `evolution_score` | `evolution_score` / `volume` / `created_at` |

**Response**

```json
{
  "items": [
    {
      "id": "fam_01H...",
      "event_title": "XRP ETF approval",
      "event_summary": "SEC approval of spot XRP ETF triggered a wave of XRP-themed meme tokens.",
      "confidence_score": 0.91,
      "mutations_count": 27,
      "total_volume_usd": 182340.5,
      "origin_strain": {"token": "0xabc...", "symbol": "XRPAPE"},
      "dominant_strain": {"token": "0xdef...", "symbol": "XRPKING"},
      "fastest_mutation": {"token": "0x123...", "symbol": "XRPFOMO"},
      "centers": {
        "source_center": "https://x.com/SEC_News/status/...",
        "entity_center": "U.S. Securities and Exchange Commission",
        "geo_center": "United States",
        "community_center": "X / Crypto Twitter"
      },
      "created_at": "2026-04-18T11:03:00Z"
    }
  ],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

---

## `GET /dna-family/{id}`

Full DNA family including all mutations and the evolution curve.

```json
{
  "id": "fam_01H...",
  "event_title": "XRP ETF approval",
  "event_summary": "...",
  "confidence_score": 0.91,
  "centers": { ... },
  "references": [
    {"url": "https://x.com/SEC_News/status/...", "type": "tweet"},
    {"url": "https://www.sec.gov/news/...", "type": "press_release"}
  ],
  "timeline_of_event": [
    {"at": "2026-04-18T10:00:00Z", "event": "SEC filing indexed"},
    {"at": "2026-04-18T10:42:00Z", "event": "First XRP meme token deployed on Four.Meme"}
  ],
  "mutations": [
    {
      "token_address": "0xabc...",
      "symbol": "XRPAPE",
      "name": "XRP Ape",
      "description": "...",
      "created_at": "2026-04-18T10:42:00Z",
      "market_cap_usd": 38210.0,
      "volume_24h_usd": 12110.0,
      "holders": 214,
      "bonding_progress": 0.41,
      "is_origin_strain": true,
      "is_dominant_strain": false,
      "is_fastest_mutation": false,
      "why_this_mutation_belongs":
        "Symbol contains 'XRP'. Description references the SEC approval. Deployed 42 minutes after the SEC announcement."
    }
  ],
  "evolution_curve": [
    {"t": "2026-04-18T11:00:00Z", "mutations": 1, "volume_usd": 0},
    {"t": "2026-04-18T12:00:00Z", "mutations": 7, "volume_usd": 24010.2},
    {"t": "2026-04-18T13:00:00Z", "mutations": 18, "volume_usd": 88125.9}
  ]
}
```

---

## `GET /mutation/{token_address}`

Returns a single token as a mutation (with family reference and reasoning).

```json
{
  "token_address": "0xabc...",
  "symbol": "XRPAPE",
  "name": "XRP Ape",
  "description": "...",
  "created_at": "2026-04-18T10:42:00Z",
  "deployer": "0x...",
  "bonding_progress": 0.41,
  "migrated": false,
  "trading": {
    "volume_24h_usd": 12110.0,
    "market_cap_usd": 38210.0,
    "holders": 214
  },
  "family": {
    "id": "fam_01H...",
    "event_title": "XRP ETF approval",
    "is_origin_strain": true,
    "why_this_mutation_belongs": "..."
  }
}
```

---

## `GET /trending-dna`

Top DNA families ranked by an *evolution score* combining growth velocity, volume, and
mutation count.

```json
{
  "items": [
    {"id": "fam_01H...", "event_title": "XRP ETF approval",  "evolution_score": 92.4},
    {"id": "fam_02H...", "event_title": "Solana outage meme", "evolution_score": 71.1}
  ]
}
```

---

## `POST /internal/pipeline/run`

Trigger a pipeline run synchronously (bounded lookback). Protected by `X-Admin-Token`
header (value = `MEMEDNA_ADMIN_TOKEN`).

```json
{"lookback_hours": 24, "force_recluster": true}
```

Returns the `pipeline_run` record.

---

## Error shape

```json
{"error": "not_found", "message": "DNA Family 'fam_xyz' does not exist"}
```
