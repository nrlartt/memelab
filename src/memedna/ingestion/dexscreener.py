"""DexScreener ingestor.

DexScreener exposes a free, key-less REST API that covers every BNB Chain
token we care about (including pre-migration Four.Meme tokens as soon as a
PancakeSwap pair exists). We use it for:

  - price_usd
  - volume_24h_usd
  - liquidity_usd
  - market_cap_usd (falls back to fdv)

Endpoint:
  GET https://api.dexscreener.com/tokens/v1/bsc/<address[,address2,...]>
  (batch endpoint, up to 30 addresses per call)

Rate limit: ~300 req/min anonymous. We batch 30 → 1607 tokens ≈ 54 requests.
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any, Iterable

import httpx
from loguru import logger

DEXSCREENER_BATCH_URL = "https://api.dexscreener.com/tokens/v1/bsc/{addrs}"
# DexScreener accepts up to 30 comma-separated addresses per call.
BATCH_SIZE = 30
REQUEST_TIMEOUT = 15.0
MAX_CONCURRENCY = 6


def _chunks(seq: list[str], n: int) -> Iterable[list[str]]:
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def _pair_sort_key(p: dict[str, Any]) -> tuple[float, float]:
    """Prefer real AMM depth; when DexScreener leaves ``liquidity`` blank on
    ``fourmeme`` bonding pairs, fall back to 24h volume then FDV so we don't
    pick an arbitrary empty row among duplicates.
    """
    liq = float((p.get("liquidity") or {}).get("usd") or 0.0)
    vol = float((p.get("volume") or {}).get("h24") or 0.0)
    fdv = float(p.get("fdv") or p.get("marketCap") or 0.0)
    return (liq, vol + fdv * 1e-6)


def _pick_best_pair(pairs: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Largest-liquidity pair is the 'canonical' market for the token."""
    if not pairs:
        return None
    return max(pairs, key=_pair_sort_key)


def _first_social(info: dict[str, Any], kind: str) -> str | None:
    """Return the first social URL of the requested ``type`` (e.g. ``twitter``).

    DexScreener's ``info.socials`` is a list of ``{"type": "twitter"|"telegram"|...,
    "url": "..."}`` dicts. We store one canonical URL per platform because our
    cards have room for exactly one icon each.
    """
    for entry in info.get("socials") or []:
        if not isinstance(entry, dict):
            continue
        if (entry.get("type") or "").lower() == kind:
            url = entry.get("url")
            if isinstance(url, str) and url.startswith("http"):
                return url
    return None


def _first_website(info: dict[str, Any]) -> str | None:
    for entry in info.get("websites") or []:
        if not isinstance(entry, dict):
            continue
        url = entry.get("url")
        if isinstance(url, str) and url.startswith("http"):
            return url
    return None


def _extract(pair: dict[str, Any]) -> dict[str, Any]:
    liq = pair.get("liquidity") or {}
    vol = pair.get("volume") or {}
    info = pair.get("info") or {}
    # ``info`` is optional — tokens with no brand metadata still show up as
    # bare pairs. We normalise to ``None`` so the upsert below can skip
    # overwriting a previously-good value with an empty string.
    image = info.get("imageUrl") if isinstance(info, dict) else None
    header = info.get("header") if isinstance(info, dict) else None
    website = _first_website(info) if isinstance(info, dict) else None
    twitter = _first_social(info, "twitter") if isinstance(info, dict) else None
    telegram = _first_social(info, "telegram") if isinstance(info, dict) else None
    return {
        "price_usd": float(pair.get("priceUsd") or 0.0),
        "liquidity_usd": float(liq.get("usd") or 0.0),
        "volume_24h_usd": float(vol.get("h24") or 0.0),
        "market_cap_usd": float(pair.get("marketCap") or pair.get("fdv") or 0.0),
        "trades_24h": int((pair.get("txns") or {}).get("h24", {}).get("buys", 0))
        + int((pair.get("txns") or {}).get("h24", {}).get("sells", 0)),
        "pair_url": pair.get("url"),
        "dex_id": pair.get("dexId"),
        "image_url": image if isinstance(image, str) and image else None,
        "header_url": header if isinstance(header, str) and header else None,
        "website_url": website,
        "twitter_url": twitter,
        "telegram_url": telegram,
    }


async def fetch_token_metrics(
    addresses: list[str],
    max_concurrency: int = MAX_CONCURRENCY,
) -> dict[str, dict[str, Any]]:
    """Batch-fetch metrics for many tokens. Returns addr.lower() → metrics dict.

    Missing tokens (no pair on any BSC DEX) simply aren't in the result.
    """
    if not addresses:
        return {}

    addresses = [a.lower() for a in addresses if a]
    sem = asyncio.Semaphore(max_concurrency)
    results: dict[str, dict[str, Any]] = {}

    async with httpx.AsyncClient(
        timeout=REQUEST_TIMEOUT,
        headers={"User-Agent": "MemeDNA/1.0 (+https://memedna.local)"},
    ) as client:

        async def _one_batch(batch: list[str]) -> None:
            url = DEXSCREENER_BATCH_URL.format(addrs=",".join(batch))
            async with sem:
                try:
                    resp = await client.get(url)
                    if resp.status_code == 429:
                        await asyncio.sleep(2.5)
                        resp = await client.get(url)
                    resp.raise_for_status()
                except Exception as exc:  # noqa: BLE001
                    logger.debug("dexscreener batch failed ({}): {}", len(batch), exc)
                    return
                data = resp.json()
                # API historically returns EITHER a bare list of pairs OR
                # {"pairs": [...]} depending on the batch endpoint version.
                if isinstance(data, dict):
                    pairs = data.get("pairs") or []
                else:
                    pairs = data or []
                by_token: dict[str, list[dict[str, Any]]] = {}
                for p in pairs:
                    base = (p.get("baseToken") or {}).get("address", "").lower()
                    if not base or base not in batch:
                        continue
                    by_token.setdefault(base, []).append(p)
                for addr, token_pairs in by_token.items():
                    best = _pick_best_pair(token_pairs)
                    if best is not None:
                        results[addr] = _extract(best)

        tasks = [_one_batch(b) for b in _chunks(addresses, BATCH_SIZE)]
        await asyncio.gather(*tasks)

    return results


async def refresh_trades_via_dexscreener(session, addresses: list[str]) -> int:
    """Pull current metrics from DexScreener and upsert into `token_trades`.

    Returns: number of rows upserted with a non-zero liquidity (i.e. found).
    """
    from sqlalchemy import text
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    from ..models import TokenTrade

    if not addresses:
        return 0

    metrics = await fetch_token_metrics(addresses)
    if not metrics:
        logger.info("DexScreener: no pairs found for {} addresses", len(addresses))
        return 0

    # Bonding-curve pairs: DexScreener leaves ``liquidity.usd`` unset. Fill
    # ``liquidity_usd`` from on-chain ``funds`` × BNB/USD so UI matches
    # four.meme (see :meth:`OnchainFourMemeClient.estimate_bonding_liquidity_usd`).
    from ..ingestion.onchain import OnchainFourMemeClient

    _rpc = OnchainFourMemeClient()
    _sem = asyncio.Semaphore(12)

    async def _patch_bonding_liquidity(addr: str, m: dict[str, Any]) -> None:
        if float(m.get("liquidity_usd") or 0) > 0:
            return
        if str(m.get("dex_id") or "").lower() != "fourmeme":
            return
        async with _sem:
            est = await asyncio.to_thread(
                _rpc.estimate_bonding_liquidity_usd, addr
            )
        if est and est > 0:
            m["liquidity_usd"] = float(est)

    await asyncio.gather(
        *(_patch_bonding_liquidity(a, metrics[a]) for a in metrics)
    )

    now = datetime.utcnow()
    rows: list[dict[str, Any]] = []
    media_rows: list[dict[str, Any]] = []
    for addr, m in metrics.items():
        rows.append(
            {
                "token_address": addr,
                "volume_24h_usd": m["volume_24h_usd"],
                "market_cap_usd": m["market_cap_usd"],
                "liquidity_usd": m["liquidity_usd"],
                "trades_24h": m["trades_24h"],
                "price_usd": m["price_usd"],
                "updated_at": now,
            }
        )
        # Only queue a media update when DexScreener actually handed us
        # at least one branded asset for this token — otherwise we'd blow
        # away a previously-good ``image_url`` every time a pair temporarily
        # loses its ``info`` block (happens after DS CDN refreshes).
        media = {
            k: m.get(k)
            for k in ("image_url", "header_url", "website_url", "twitter_url", "telegram_url")
            if m.get(k)
        }
        if media:
            media_rows.append({"addr": addr, **media})

    CHUNK = 300
    for i in range(0, len(rows), CHUNK):
        batch = rows[i : i + CHUNK]
        stmt = pg_insert(TokenTrade.__table__).values(batch)
        stmt = stmt.on_conflict_do_update(
            index_elements=["token_address"],
            set_={
                "volume_24h_usd": stmt.excluded.volume_24h_usd,
                "market_cap_usd": stmt.excluded.market_cap_usd,
                "liquidity_usd": stmt.excluded.liquidity_usd,
                "trades_24h": stmt.excluded.trades_24h,
                "price_usd": stmt.excluded.price_usd,
                "updated_at": stmt.excluded.updated_at,
            },
        )
        session.execute(stmt)

    # Media / socials update: ``COALESCE(:col, col)`` semantics so a
    # partial response (e.g. only ``imageUrl``) still fills the image but
    # never nulls a previously-populated ``twitter_url``. Raw SQL keeps
    # this readable and gives executemany batching for free.
    if media_rows:
        media_stmt = text(
            """
            UPDATE tokens SET
              image_url    = COALESCE(:image_url,    image_url),
              header_url   = COALESCE(:header_url,   header_url),
              website_url  = COALESCE(:website_url,  website_url),
              twitter_url  = COALESCE(:twitter_url,  twitter_url),
              telegram_url = COALESCE(:telegram_url, telegram_url)
            WHERE token_address = :addr
            """
        )
        media_params = [
            {
                "addr": r["addr"],
                "image_url": r.get("image_url"),
                "header_url": r.get("header_url"),
                "website_url": r.get("website_url"),
                "twitter_url": r.get("twitter_url"),
                "telegram_url": r.get("telegram_url"),
            }
            for r in media_rows
        ]
        session.execute(media_stmt, media_params)

    logger.info(
        "DexScreener: refreshed {}/{} tokens (total volume ${:,.0f}, media {})",
        len(metrics),
        len(addresses),
        sum(m["volume_24h_usd"] for m in metrics.values()),
        len(media_rows),
    )
    return len(metrics)
