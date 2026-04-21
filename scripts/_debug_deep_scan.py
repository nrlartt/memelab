"""Scan a wide block range for any trace of a given address.

Walks the last N blocks in 10k-window chunks against the Four.Meme
TokenManager and reports:

  * total TokenCreate events seen
  * any log whose data blob mentions the needle address
  * whether the address has bytecode at head

This is cheaper than a state-dump and is what you reach for when a user
says "this token is missing" and you need to know if it ever existed on
the current manager.
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
    ap.add_argument("--windows", type=int, default=10, help="how many 10k-block windows back to scan")
    args = ap.parse_args()

    s = get_settings()
    addr = args.address.lower()
    needle = addr[2:]
    url = s.bsc_rpc_url
    manager = s.fourmeme_token_manager.lower()

    head = int(
        httpx.post(
            url,
            json={"jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": []},
            timeout=10,
        ).json()["result"],
        16,
    )
    code = httpx.post(
        url,
        json={
            "jsonrpc": "2.0", "id": 1, "method": "eth_getCode",
            "params": [addr, "latest"],
        },
        timeout=10,
    ).json().get("result", "")

    print(f"head        : {head:,}")
    print(f"bytecode len: {max(0, len(code) - 2) // 2} bytes")
    print(f"scan span   : {args.windows * 10_000:,} blocks (~{args.windows / 6:.1f} days)")

    total = 0
    hits: list[dict] = []
    for i in range(args.windows):
        frm = max(head - (i + 1) * 10_000, 0)
        to = head - i * 10_000 - 1
        body = {
            "jsonrpc": "2.0", "id": 1, "method": "eth_getLogs",
            "params": [{
                "fromBlock": hex(frm),
                "toBlock": hex(to),
                "address": manager,
                "topics": [_TOPIC_TOKEN_CREATE],
            }],
        }
        r = httpx.post(url, json=body, timeout=40).json()
        if "result" not in r:
            err = r.get("error") or {}
            print(f"  window {frm:,}..{to:,}: ERROR {err.get('code')} {err.get('message', '')[:80]}")
            continue
        logs = r["result"]
        total += len(logs)
        window_hits = [l for l in logs if needle in l.get("data", "").lower()]
        hits.extend(window_hits)
        print(
            f"  window {frm:,}..{to:,}: {len(logs):>3} TokenCreate, "
            f"{len(window_hits)} hits"
        )
    print("---")
    print(f"total TokenCreate scanned: {total:,}")
    print(f"hits mentioning {addr}: {len(hits)}")
    for h in hits[:5]:
        blk = int(h["blockNumber"], 16)
        print(f"  block={blk:,}  tx={h['transactionHash']}")


if __name__ == "__main__":
    main()
