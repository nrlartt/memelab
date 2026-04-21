"""Probe Four.Meme TokenManager logs + current event signature."""

from __future__ import annotations

from collections import Counter

from eth_utils import keccak
from web3 import Web3

from memedna.config import get_settings


def main() -> None:
    s = get_settings()
    w3 = Web3(Web3.HTTPProvider(s.bsc_rpc_url, request_kwargs={"timeout": 30}))
    latest = w3.eth.block_number
    start = latest - 800
    print(f"chain_id={w3.eth.chain_id}  latest={latest}  scanning {start}..{latest}")

    logs = w3.eth.get_logs(
        {
            "fromBlock": start,
            "toBlock": latest,
            "address": Web3.to_checksum_address(s.fourmeme_token_manager),
        }
    )
    print(f"total logs from TokenManager in last 800 blocks: {len(logs)}")
    topic_counter: Counter[str] = Counter()
    topic_len_counter: Counter[int] = Counter()
    samples: dict[str, dict] = {}
    for log in logs:
        tl = len(log["topics"])
        topic_len_counter[tl] += 1
        if tl == 0:
            continue
        t0 = log["topics"][0].hex()
        topic_counter[t0] += 1
        if t0 not in samples:
            samples[t0] = {
                "topics": [t.hex() for t in log["topics"]],
                "data_len_bytes": len(log["data"]),
                "block": log["blockNumber"],
                "tx": log["transactionHash"].hex(),
            }
    print(f"topic count distribution: {dict(topic_len_counter)}")
    print(f"distinct topic0 values: {len(topic_counter)}")
    print()
    candidates = [
        "TokenCreate(address,address,uint256,string,string,uint256,uint256,uint256)",
        "TokenCreate(address,address,uint256,string,string,uint256,uint256)",
        "TokenCreated(address,address,uint256,string,string,uint256,uint256,uint256)",
        "TokenCreate(address,address,uint256,string,string)",
        "TokenPurchase(address,address,uint256,uint256,uint256,uint256,uint256,uint256)",
        "TokenSale(address,address,uint256,uint256,uint256,uint256,uint256,uint256)",
        "LaunchedToken(address,address,string,string)",
    ]
    known = {("0x" + keccak(text=sig).hex()): sig for sig in candidates}
    print("signature map:")
    for h, sig in known.items():
        print(f"  {h}  {sig}")
    print()
    print("top topic0 observed (count -> topic0 [matched signature or UNKNOWN]):")
    for t0, cnt in topic_counter.most_common(10):
        sig = known.get(t0, "UNKNOWN")
        print(f"  {cnt:5d}  {t0}  {sig}")
        s_ = samples[t0]
        print(f"         topics={s_['topics']}  data_bytes={s_['data_len_bytes']}  block={s_['block']}")


if __name__ == "__main__":
    main()
