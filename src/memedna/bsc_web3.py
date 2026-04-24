"""Shared BSC JSON-RPC URL list and Web3 construction (primary + fallbacks)."""

from __future__ import annotations

from web3 import Web3

from .config import get_settings


def _parse_extra_rpc_urls(raw: str | None) -> list[str]:
    """Split comma / semicolon / newline–separated RPC URLs; preserve order, dedupe."""
    if not raw:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for part in str(raw).replace(";", "\n").replace(",", "\n").splitlines():
        u = part.strip().strip('"').strip("'")
        if u and u not in seen:
            seen.add(u)
            out.append(u)
    return out


def bsc_rpc_url_chain() -> list[str]:
    """Optional QuickNode (first) → BSC_RPC_URL → fallback → extra URLs. Deduplicated.

    BSC_QUICKNODE_URL is always prepended when set so production hosts can force
    QuickNode as index 0 without relying on BSC_RPC_URL alone.
    """
    s = get_settings()
    out: list[str] = []
    for u in (
        (s.bsc_quicknode_url or "").strip(),
        s.bsc_rpc_url,
        s.bsc_rpc_fallback_url or "",
        *_parse_extra_rpc_urls(s.bsc_rpc_extra_urls),
    ):
        t = (u or "").strip()
        if t and t not in out:
            out.append(t)
    if not out:
        out.append("https://bsc-dataseed.bnbchain.org")
    return out


def bsc_rpc_hostnames() -> list[str]:
    """Hostnames of the current RPC chain (for stack-info; no path or key material)."""
    from urllib.parse import urlparse

    hosts: list[str] = []
    for url in bsc_rpc_url_chain():
        try:
            h = urlparse(url).hostname
            if h and h not in hosts:
                hosts.append(h)
        except Exception:
            continue
    return hosts


def make_bsc_web3(url: str, timeout: float) -> Web3:
    return Web3(Web3.HTTPProvider(url, request_kwargs={"timeout": timeout}))


def connect_first_bsc_web3(*, timeout: float) -> Web3:
    """Return the first Web3 that answers ``is_connected()``; else the last build for errors upstream."""
    urls = bsc_rpc_url_chain()
    last: Web3 | None = None
    for u in urls:
        w3 = make_bsc_web3(u, timeout)
        last = w3
        try:
            if w3.is_connected():
                return w3
        except Exception:
            continue
    assert last is not None
    return last


def rpc_error_suggests_failover(exc: BaseException) -> bool:
    """True when trying the next JSON-RPC URL might help.

    Includes transient network errors, rate limits, and *provider-side*
    auth/credit issues (e.g. Alchemy/QuickNode 401/403/429) where another key
    in BSC_RPC_EXTRA_URLS can succeed.
    """
    m = str(exc).lower()
    if "-32701" in m or "history has been pruned" in m:
        return False
    markers = (
        "timeout",
        "timed out",
        "-32002",
        "connection",
        "connect",
        "refused",
        "reset",
        "unreachable",
        "not reachable",
        "bad gateway",
        " 502 ",
        " 503 ",
        "504",
        "no response",
        "max retries",
        "remotedisconnected",
        # rate / quota (paid provider exhausted or throttled)
        "429",
        "rate limit",
        "too many requests",
        "throttl",
        "quota",
        "exceed",
        "credits",  # "compute units" / dashboard wording
        # auth or billing (wrong key, disabled app, plan limits)
        " 401 ",
        " 403 ",
        "unauthorized",
        "forbidden",
        "invalid api key",
        "must be authenticated",
        "insufficient",
    )
    return any(x in m for x in markers)
