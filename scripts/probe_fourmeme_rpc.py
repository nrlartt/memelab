"""Probe Four.Meme TokenManager via raw JSON-RPC (Alchemy rejects extra
param keys that web3.py sends, so we go bare).

Prints:
  * head block
  * distribution of event topics emitted by the manager
  * which candidate TokenCreate signature matches
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter

import httpx
from eth_utils import keccak

from memedna.config import get_settings


_CANDIDATE_SIGS = [
    "TokenCreate(address,address,uint256,string,string,uint256,uint256,uint256)",
    "TokenCreate(address,address,uint256,string,string,uint256,uint256,uint256,uint256)",
    "TokenCreate(address,address,uint256,string,string,uint256,uint256)",
    "TokenCreate(address,uint256,string,string,uint256,uint256,uint256,uint256)",
    "TokenCreated(address,address,string,string,uint256,uint256)",
    "TokenLaunch(address,address,string,string,uint256)",
    "NewToken(address,address,string,string,uint256)",
    "TokenCreate(address,address,uint256,string,string,uint8,uint256,uint256,uint256)",
    "TokenCreate(address,address,uint256,string,string,uint256,uint256,uint256,uint256,uint256)",
    "TokenCreatePublic(address,address,uint256,string,string,uint256,uint256,uint256)",
    "TokenPurchase(address,address,uint256,uint256)",
    "TokenSale(address,address,uint256,uint256)",
    "LiquidityAdded(address,uint256,uint256)",
    "TradeStop(address)",
    "TradeEnd(address)",
    "TokenCreate(address,address,uint256,string,string,uint256,uint256,uint256,string)",
]


def _rpc(url: str, method: str, params: list) -> dict:
    r = httpx.post(
        url,
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    ap = argparse.ArgumentParser()
    ap.add_argument("--blocks", type=int, default=20)
    args = ap.parse_args()

    s = get_settings()
    url = s.bsc_rpc_url
    manager = s.fourmeme_token_manager.lower()

    head_hex = _rpc(url, "eth_blockNumber", [])["result"]
    head = int(head_hex, 16)
    start = max(head - args.blocks, 0)
    from_hex, to_hex = hex(start), hex(head)

    print(f"RPC:       {url.split('/v2/')[0]}/v2/<key>")
    print(f"Head:      {head:,}")
    print(f"Range:     {start:,} -> {head:,} ({args.blocks} blocks)")
    print(f"Manager:   {manager}")

    sig_by_topic = {"0x" + keccak(text=sig).hex(): sig for sig in _CANDIDATE_SIGS}

    # Alchemy BSC rejects large windows with 400 for this busy contract, so we
    # walk the range in tiny (window_size) pieces.
    window = 5
    logs: list[dict] = []
    s_ = start
    while s_ <= head:
        e_ = min(s_ + window - 1, head)
        try:
            r = _rpc(
                url,
                "eth_getLogs",
                [{"fromBlock": hex(s_), "toBlock": hex(e_), "address": manager}],
            )
            if "result" in r:
                logs.extend(r["result"])
        except httpx.HTTPStatusError:
            pass
        s_ = e_ + 1
    print(f"\nTotal logs from manager: {len(logs)}")

    if not logs:
        print("⚠  No logs at all. Either block window is too small or the")
        print("   contract is idle / address is wrong.")
        return

    counter: Counter[str] = Counter()
    for lg in logs:
        if lg.get("topics"):
            counter[lg["topics"][0]] += 1

    print("\nTopic distribution:")
    for t, n in counter.most_common(20):
        label = sig_by_topic.get(t, "(unknown)")
        print(f"  {t} × {n}    {label}")

    print("\nSample payload per top topic:")
    for t, _n in counter.most_common(5):
        sample = next(l for l in logs if l["topics"] and l["topics"][0] == t)
        data = sample["data"]
        data_bytes = (len(data) - 2) // 2 if data.startswith("0x") else len(data) // 2
        print(
            f"  topic {t} ({sig_by_topic.get(t, 'unknown')})\n"
            f"    topics[1:] ={sample['topics'][1:]}\n"
            f"    data bytes ={data_bytes}\n"
            f"    tx         ={sample['transactionHash']}"
        )


if __name__ == "__main__":
    main()
