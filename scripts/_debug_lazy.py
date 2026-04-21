"""Directly exercise the lazy-ingest path for a given token address."""
from __future__ import annotations

import argparse
import asyncio
import sys

from memedna.db import get_session
from memedna.ingestion.lazy import lazy_ingest_token
from memedna.ingestion.onchain import OnchainFourMemeClient


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    ap = argparse.ArgumentParser()
    ap.add_argument("address")
    args = ap.parse_args()
    addr = args.address.lower()

    rpc = OnchainFourMemeClient()
    print("--- fetch_erc20_metadata ---")
    md = rpc.fetch_erc20_metadata(addr)
    print(f"  {md}")

    print("--- enrich_with_bonding ---")
    bn = rpc.enrich_with_bonding(addr)
    print(f"  bonding_progress={bn.get('bonding_progress')}")
    print(f"  migrated        ={bn.get('migrated')}")
    raw = bn.get("raw_metadata") or {}
    print(f"  raw_metadata keys: {list(raw.keys())}")
    print(f"  launchTime:        {raw.get('launchTime')}")

    print("\n--- lazy_ingest_token ---")
    db = next(get_session())
    ok = asyncio.run(lazy_ingest_token(db, addr))
    print(f"  ingested: {ok}")

    from sqlalchemy import select
    from memedna.models import Token
    t = db.execute(select(Token).where(Token.token_address == addr)).scalar_one_or_none()
    if t:
        print(
            f"  DB row   : symbol={t.symbol!r} name={t.name!r} "
            f"created_at={t.created_at} source={t.source}"
        )
    else:
        print("  DB row   : still missing")


if __name__ == "__main__":
    main()
