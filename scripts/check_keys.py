"""Non-disclosing liveness checks for JINA_API_KEY and BITQUERY_API_KEY.

Prints ONLY: presence, key length, HTTP status, and a tiny result sample.
NEVER prints the key itself or any substring of it.
"""

from __future__ import annotations

import asyncio

import httpx

from memedna.config import get_settings


async def check_jina(key: str) -> str:
    if not key:
        return "no key"
    url = "https://s.jina.ai/four.meme"
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {key}",
        "X-Respond-With": "no-content",
    }
    try:
        async with httpx.AsyncClient(timeout=25.0) as c:
            r = await c.get(url, headers=headers)
        ctype = r.headers.get("content-type", "")
        n = 0
        if "json" in ctype:
            data = r.json()
            if isinstance(data, dict):
                n = len(data.get("data") or data.get("results") or [])
        else:
            n = r.text.count("\n[1] ") + r.text.count("\n[2] ")
        remaining = (
            r.headers.get("x-ratelimit-remaining")
            or r.headers.get("x-rate-limit-remaining")
            or "?"
        )
        return (
            f"status={r.status_code} bytes={len(r.content)} "
            f"approx_results={n} rate_remaining={remaining}"
        )
    except Exception as e:  # noqa: BLE001
        return f"ERROR {type(e).__name__}: {e}"


async def check_bitquery(key: str, endpoint: str) -> str:
    if not key:
        return "no key"
    query = "{ EVM(network: bsc) { Blocks(limit: {count: 1}) { Block { Number Time } } } }"
    try:
        async with httpx.AsyncClient(timeout=30.0) as c:
            r = await c.post(
                endpoint,
                json={"query": query},
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {key}",
                    "X-API-KEY": key,
                },
            )
        body = r.json()
        if body.get("errors"):
            first = body["errors"][0]
            msg = str(first.get("message", "?"))[:80]
            return f"status={r.status_code} errors={msg}"
        blocks = (
            ((body.get("data") or {}).get("EVM") or {}).get("Blocks")
            or [{}]
        )
        block = blocks[0].get("Block") or {}
        return (
            f"status={r.status_code} latest_block={block.get('Number')} "
            f"time={block.get('Time')}"
        )
    except Exception as e:  # noqa: BLE001
        return f"ERROR {type(e).__name__}: {e}"


async def main() -> None:
    s = get_settings()
    j = (s.jina_api_key or "").strip()
    b = (s.bitquery_api_key or "").strip()
    print(f"JINA key loaded:     {bool(j)}  (len={len(j)})")
    print(f"BITQUERY key loaded: {bool(b)}  (len={len(b)})")
    jina_msg, bitq_msg = await asyncio.gather(
        check_jina(j),
        check_bitquery(b, s.bitquery_endpoint),
    )
    print(f"JINA     -> {jina_msg}")
    print(f"BITQUERY -> {bitq_msg}")


if __name__ == "__main__":
    asyncio.run(main())
