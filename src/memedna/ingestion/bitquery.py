"""Bitquery GraphQL client for Four.Meme tokens on BNB Chain.

Bitquery EAP (Early Access Program) indexes Four.Meme token creations and trades. We
use two queries:

1. `newTokensQuery`  – returns TokenCreate calls on the Four.Meme TokenManager2.
2. `tokenTradesQuery` – aggregated DEX trades for a token (for market cap / volume).

The endpoint + API-key header are read from the Settings object; if no key is
configured the client simply returns empty lists and the pipeline falls back to the
on-chain RPC path.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from loguru import logger
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from ..config import get_settings


NEW_TOKENS_QUERY = """
query NewFourMemeTokens($since: DateTime!, $manager: String!, $limit: Int!) {
  EVM(dataset: combined, network: bsc) {
    Calls(
      where: {
        Call: { To: { is: $manager }, Signature: { Name: { is: "createToken" } } },
        Block: { Time: { since: $since } }
      }
      limit: { count: $limit }
      orderBy: { ascending: Block_Time }
    ) {
      Block { Time Number }
      Transaction { Hash From }
      Call {
        Signature { Name }
        Input
      }
      Arguments { Name Value { ... on EVM_ABI_String_Value_Arg { string }
                               ... on EVM_ABI_Address_Value_Arg { address }
                               ... on EVM_ABI_Integer_Value_Arg { integer } } }
    }
  }
}
"""


# Same shape as NEW_TOKENS_QUERY but accepts both a `since` *and* `till` window.
# Used by the historical backfill CLI so we can walk Four.Meme's full lifetime
# in weekly chunks. Requires the Bitquery EAP "combined" dataset which is what
# our paid key subscribes to.
NEW_TOKENS_RANGE_QUERY = """
query NewFourMemeTokensRange(
  $since: DateTime!, $till: DateTime!, $manager: String!, $limit: Int!
) {
  EVM(dataset: combined, network: bsc) {
    Calls(
      where: {
        Call: { To: { is: $manager }, Signature: { Name: { is: "createToken" } } },
        Block: { Time: { since: $since, till: $till } }
      }
      limit: { count: $limit }
      orderBy: { ascending: Block_Time }
    ) {
      Block { Time Number }
      Transaction { Hash From }
      Call { Signature { Name } Input }
      Arguments { Name Value { ... on EVM_ABI_String_Value_Arg { string }
                               ... on EVM_ABI_Address_Value_Arg { address }
                               ... on EVM_ABI_Integer_Value_Arg { integer } } }
    }
  }
}
"""

TOKEN_TRADES_QUERY = """
query TokenTrades($token: String!, $since: DateTime!) {
  EVM(dataset: combined, network: bsc) {
    DEXTradeByTokens(
      where: {
        Trade: { Currency: { SmartContract: { is: $token } } },
        Block:  { Time: { since: $since } }
      }
    ) {
      volumeUsd: sum(of: Trade_Side_AmountInUSD)
      trades: count
      holders: count(distinct: Trade_Buyer)
      priceLast: Trade_Price(maximum: Block_Time)
    }
  }
}
"""


class BitqueryClient:
    def __init__(self) -> None:
        s = get_settings()
        self.endpoint = s.bitquery_endpoint
        self.api_key = s.bitquery_api_key
        self.enabled = bool(self.api_key)

    def _headers(self) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
            "X-API-KEY": self.api_key,
        }

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        retry=retry_if_exception_type((httpx.HTTPError,)),
        reraise=True,
    )
    async def _post(self, query: str, variables: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                self.endpoint,
                json={"query": query, "variables": variables},
                headers=self._headers(),
            )
            resp.raise_for_status()
            body = resp.json()
        if body.get("errors"):
            raise RuntimeError(f"Bitquery error: {body['errors']}")
        return body.get("data", {})

    @staticmethod
    def _calls_to_tokens(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
        tokens: list[dict[str, Any]] = []
        for call in raw:
            args = {a["Name"]: a.get("Value", {}) for a in call.get("Arguments", [])}
            token_address = _first_defined(args.get("token"), args.get("tokenAddress"))
            if not token_address:
                continue
            tokens.append(
                {
                    "token_address": token_address.lower(),
                    "symbol": _first_defined(args.get("symbol"), default=""),
                    "name": _first_defined(args.get("name"), default=""),
                    "description": _first_defined(args.get("description"), default=""),
                    "deployer": (call.get("Transaction") or {}).get("From", "").lower() or None,
                    "created_at": (call.get("Block") or {}).get("Time"),
                    "launch_tx_hash": (call.get("Transaction") or {}).get("Hash"),
                    "source": "bitquery",
                }
            )
        return tokens

    async def list_new_tokens(self, since_hours: int = 24, limit: int = 500) -> list[dict[str, Any]]:
        if not self.enabled:
            logger.info("Bitquery disabled (no API key); skipping GraphQL ingest")
            return []
        since = (datetime.now(tz=timezone.utc) - timedelta(hours=since_hours)).isoformat()
        s = get_settings()
        data = await self._post(
            NEW_TOKENS_QUERY,
            {"since": since, "manager": s.fourmeme_token_manager, "limit": limit},
        )
        tokens = self._calls_to_tokens(data.get("EVM", {}).get("Calls", []))
        logger.info("Bitquery returned {} token creations", len(tokens))
        return tokens

    async def list_new_tokens_between(
        self,
        since: datetime,
        till: datetime,
        limit: int = 5_000,
    ) -> list[dict[str, Any]]:
        """Historical backfill variant: explicit [since, till] window.

        Used by ``scripts/backfill_fourmeme.py`` to walk Four.Meme's full
        lifetime week-by-week. Free public BSC RPCs prune logs beyond ~18h
        so Bitquery is the only viable source for >1 day of history.
        """
        if not self.enabled:
            logger.info("Bitquery disabled (no API key); skipping GraphQL ingest")
            return []
        s = get_settings()
        data = await self._post(
            NEW_TOKENS_RANGE_QUERY,
            {
                "since": since.astimezone(timezone.utc).isoformat(),
                "till": till.astimezone(timezone.utc).isoformat(),
                "manager": s.fourmeme_token_manager,
                "limit": limit,
            },
        )
        tokens = self._calls_to_tokens(data.get("EVM", {}).get("Calls", []))
        return tokens

    async def token_trade_stats(self, token_address: str, since_hours: int = 24) -> dict[str, Any]:
        if not self.enabled:
            return {}
        since = (datetime.now(tz=timezone.utc) - timedelta(hours=since_hours)).isoformat()
        data = await self._post(
            TOKEN_TRADES_QUERY, {"token": token_address, "since": since}
        )
        rows = data.get("EVM", {}).get("DEXTradeByTokens", [])
        if not rows:
            return {}
        r = rows[0]
        return {
            "volume_24h_usd": float(r.get("volumeUsd") or 0),
            "trades_24h": int(r.get("trades") or 0),
            "holders": int(r.get("holders") or 0),
            "price_usd": float(r.get("priceLast") or 0),
        }


def _first_defined(*values: Any, default: Any = None) -> Any:
    for v in values:
        if v is None:
            continue
        if isinstance(v, dict):
            for key in ("string", "address", "integer"):
                if key in v and v[key] is not None:
                    return v[key]
            continue
        return v
    return default
