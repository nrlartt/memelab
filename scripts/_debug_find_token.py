"""Locate on-chain evidence for a given Four.Meme token address.

Usage:
    python -m scripts._debug_find_token 0x3292ac9ffa41c10731b12f4f443413d4534d4444
"""
from __future__ import annotations

import argparse
import sys

import httpx

from memedna.config import get_settings


_TOPIC_TOKEN_CREATE = (
    "0x396d5e902b675b032348d3d2e9517ee8f0c4a926603fbc075d3d282ff00cad20"
)


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    ap = argparse.ArgumentParser()
    ap.add_argument("address")
    ap.add_argument("--span", type=int, default=5000, help="blocks to scan backwards")
    args = ap.parse_args()

    s = get_settings()
    url = s.bsc_rpc_url
    addr = args.address.lower()
    manager = s.fourmeme_token_manager.lower()
    needle = addr[2:]

    code = httpx.post(
        url,
        json={
            "jsonrpc": "2.0", "id": 1, "method": "eth_getCode",
            "params": [addr, "latest"],
        },
        timeout=20,
    ).json().get("result", "")
    head = int(
        httpx.post(
            url,
            json={"jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": []},
            timeout=10,
        ).json()["result"],
        16,
    )
    print(f"address    : {addr}")
    print(f"contract?  : {len(code) > 2} ({len(code)} chars of bytecode)")
    print(f"rpc head   : {head:,}")
    print(f"manager    : {manager}")

    from_ = max(head - args.span, 0)
    body = {
        "jsonrpc": "2.0", "id": 1, "method": "eth_getLogs",
        "params": [{
            "fromBlock": hex(from_),
            "toBlock": hex(head),
            "address": manager,
            "topics": [_TOPIC_TOKEN_CREATE],
        }],
    }
    logs = httpx.post(url, json=body, timeout=40).json().get("result", [])
    print(
        f"\nTokenCreate events from manager in last {args.span} blocks: {len(logs)}"
    )
    hits = [l for l in logs if needle in l.get("data", "").lower()]
    print(f"  hits mentioning {addr}: {len(hits)}")
    for l in hits[:3]:
        blk = int(l["blockNumber"], 16)
        print(f"    block={blk:,}  tx={l['transactionHash']}")

    if not hits:
        print("\nNo TokenCreate hit. Trying raw contract logs…")
        body2 = {
            "jsonrpc": "2.0", "id": 1, "method": "eth_getLogs",
            "params": [{
                "fromBlock": hex(from_),
                "toBlock": hex(head),
                "address": addr,
            }],
        }
        logs2 = httpx.post(url, json=body2, timeout=40).json().get("result", [])
        print(f"  raw logs from {addr}: {len(logs2)}")
        if logs2:
            blocks = sorted({int(l["blockNumber"], 16) for l in logs2})
            print(f"  earliest block: {blocks[0]:,}")
            print(f"  latest block  : {blocks[-1]:,}")
            topics = {l["topics"][0] for l in logs2 if l.get("topics")}
            print(f"  distinct topic0: {len(topics)}")
            for t in list(topics)[:5]:
                print(f"    {t}")

    # Also probe how far behind our cursor is vs where this token was born.
    from memedna.db import get_session
    from memedna.models import IngestCursor

    db = next(get_session())
    from sqlalchemy import select
    cur = db.execute(
        select(IngestCursor).where(IngestCursor.source == "fourmeme")
    ).scalar_one_or_none()
    if cur:
        print(
            f"\ningest cursor   : block {cur.last_block:,}  "
            f"(lag={head - cur.last_block:,} blocks)"
        )
    else:
        print("\ningest cursor   : <not set>")


if __name__ == "__main__":
    main()
