"""Holder-count ingestor.

Module name is historical - we now fetch holder counts from the **GoPlus
Security** public API, which is free, key-less, reliable, and covers every
BEP-20 token on BNB Chain (chainid 56). BscScan HTML and Etherscan V2 are
kept as fallbacks so the pipeline is resilient if GoPlus is ever rate
limited or down.

Resolution order for each address:

1. **GoPlus** (`/token_security/56?contract_addresses=…`) - free, ~300ms.
2. **Etherscan V2** (paid plan required for BNB Chain on free tier).
3. **BscScan public HTML** (meta-description: ``Holders: N``).

Gracefully returns 0 when every source fails.
"""

from __future__ import annotations

import asyncio
import re
import threading
import time
from datetime import datetime
from typing import Iterable

import httpx
from loguru import logger
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import TokenTrade


GOPLUS_URL = "https://api.gopluslabs.io/api/v1/token_security/56"
ETHERSCAN_V2 = "https://api.etherscan.io/v2/api"
BSCSCAN_TOKEN_URL = "https://bscscan.com/token/{addr}"
BSC_CHAIN_ID = 56

# GoPlus free tier is strict: ~30 req/min per IP. We stay well below that
# so long cold-start backfills don't trip the 4029 "too many requests" code.
MAX_CONCURRENCY = 1
REQUEST_TIMEOUT = 15.0
# Minimum gap between any two GoPlus calls (seconds). 2.2s × 1 worker =
# ~27 req/min, safely under the documented 30/min ceiling.
GOPLUS_MIN_INTERVAL = 2.2
# When GoPlus returns 4029 we back off the entire module for this long.
GOPLUS_COOLDOWN_SECONDS = 90.0

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

_HOLDERS_RE = re.compile(r"Holders?:\s*([\d,]+)", re.IGNORECASE)

# Module-level state for adaptive GoPlus throttling: once a 4029 is observed,
# we sleep out a cooldown before any worker makes another request.
#
# IMPORTANT: We used to guard this with an ``asyncio.Lock`` but that binds to
# the *first* event loop it sees. The app has two loops in play (uvicorn's
# main loop for FastAPI + scheduler, and ephemeral loops created by
# ``asyncio.run`` inside threadpool workers for lazy-ingest). An
# ``asyncio.Lock`` attached to the wrong loop silently hangs forever instead
# of raising, which froze both the scheduler tick and API serving for 10+
# minutes. A plain ``threading.Lock`` around the scalar `cooldown_until`
# float keeps things loop-agnostic — the actual wait uses ``asyncio.sleep``
# in whichever loop is current, with no cross-loop await.
_goplus_cooldown_until = 0.0
_goplus_cooldown_lock = threading.Lock()


def _goplus_cooldown_remaining() -> float:
    with _goplus_cooldown_lock:
        return max(0.0, _goplus_cooldown_until - time.monotonic())


def _goplus_cooldown_set(duration: float) -> None:
    global _goplus_cooldown_until
    with _goplus_cooldown_lock:
        _goplus_cooldown_until = time.monotonic() + duration


async def _fetch_goplus(client: httpx.AsyncClient, address: str) -> int | None:
    wait = _goplus_cooldown_remaining()
    # After a 4029 the module sets a 90s cooldown. Sleeping that long inside
    # ``refresh_holders`` (even for a single token) blocks the pipeline,
    # lazy-ingest, and any code awaiting the same event loop. Skip the fetch
    # instead of stalling — holders are nice-to-have, not-worth minutes.
    if wait > 8.0:
        logger.debug(
            "GoPlus: skipping {} (cooldown {:.0f}s > 8s cap)",
            address[:10],
            wait,
        )
        return None
    if wait > 0:
        await asyncio.sleep(wait)

    try:
        r = await client.get(
            GOPLUS_URL,
            params={"contract_addresses": address},
        )
        if r.status_code != 200:
            return None
        payload = r.json()
        code = int(payload.get("code", 0))
        if code == 4029:
            _goplus_cooldown_set(GOPLUS_COOLDOWN_SECONDS)
            logger.warning(
                "GoPlus rate-limited (4029); cooling down {}s",
                int(GOPLUS_COOLDOWN_SECONDS),
            )
            return None
        if code != 1:
            return None
        result = (payload.get("result") or {}).get(address.lower())
        if not result:
            return None
        raw = result.get("holder_count")
        if raw in (None, "", "null"):
            return None
        await asyncio.sleep(GOPLUS_MIN_INTERVAL)
        return int(raw)
    except Exception as exc:  # noqa: BLE001
        logger.debug("GoPlus holders failed for {}: {}", address, exc)
        return None


async def _fetch_etherscan_v2(
    client: httpx.AsyncClient, address: str, api_key: str
) -> int | None:
    try:
        r = await client.get(
            ETHERSCAN_V2,
            params={
                "chainid": BSC_CHAIN_ID,
                "module": "token",
                "action": "tokenholdercount",
                "contractaddress": address,
                "apikey": api_key,
            },
        )
        r.raise_for_status()
        data = r.json()
        if str(data.get("status")) == "1":
            return int(data.get("result") or 0)
        return None
    except Exception as exc:  # noqa: BLE001
        logger.debug("Etherscan V2 holders failed for {}: {}", address, exc)
        return None


async def _fetch_bscscan_html(
    client: httpx.AsyncClient, address: str
) -> int | None:
    try:
        r = await client.get(
            BSCSCAN_TOKEN_URL.format(addr=address),
            headers={
                "User-Agent": BROWSER_UA,
                "Accept-Language": "en-US,en;q=0.8",
            },
            follow_redirects=True,
        )
        if r.status_code != 200:
            return None
        head = r.text[:4096]
        m = _HOLDERS_RE.search(head)
        if not m:
            return None
        return int(m.group(1).replace(",", ""))
    except Exception as exc:  # noqa: BLE001
        logger.debug("BscScan HTML holders failed for {}: {}", address, exc)
        return None


async def _fetch_one(
    client: httpx.AsyncClient, address: str, api_key: str | None
) -> int | None:
    val = await _fetch_goplus(client, address)
    if val is not None:
        return val
    if api_key:
        val = await _fetch_etherscan_v2(client, address, api_key)
        if val is not None:
            return val
    return await _fetch_bscscan_html(client, address)


async def refresh_holders(
    session: Session,
    addresses: Iterable[str],
    max_concurrency: int = MAX_CONCURRENCY,
) -> int:
    """Fetch holder counts for each address and upsert into ``token_trades``.

    Returns the number of rows we actually updated. Never raises.
    """
    settings = get_settings()
    api_key = (settings.bscscan_api_key or "").strip() or None

    addrs = [a.lower() for a in addresses if a]
    if not addrs:
        return 0

    sem = asyncio.Semaphore(max_concurrency)
    updated = 0

    async def _one(client: httpx.AsyncClient, addr: str) -> tuple[str, int | None]:
        async with sem:
            return addr, await _fetch_one(client, addr, api_key)

    CHUNK = 80
    now = datetime.utcnow()
    async with httpx.AsyncClient(
        timeout=REQUEST_TIMEOUT,
        headers={"User-Agent": BROWSER_UA},
    ) as client:
        for i in range(0, len(addrs), CHUNK):
            batch = addrs[i : i + CHUNK]
            results = await asyncio.gather(*(_one(client, a) for a in batch))
            rows = [
                {"token_address": a, "holders": int(h), "updated_at": now}
                for a, h in results
                if h is not None
            ]
            if not rows:
                continue
            stmt = pg_insert(TokenTrade.__table__).values(rows)
            stmt = stmt.on_conflict_do_update(
                index_elements=["token_address"],
                set_={
                    "holders": stmt.excluded.holders,
                    "updated_at": stmt.excluded.updated_at,
                },
            )
            session.execute(stmt)
            updated += len(rows)

    logger.info("holders: updated {} tokens", updated)
    return updated
