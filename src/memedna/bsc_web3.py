"""Shared BSC JSON-RPC URL list and Web3 construction (primary + optional fallback)."""

from __future__ import annotations

from web3 import Web3

from .config import get_settings


def bsc_rpc_url_chain() -> list[str]:
    """Primary first (typically public), then optional fallback (e.g. Alchemy), deduplicated."""
    s = get_settings()
    out: list[str] = []
    for u in (s.bsc_rpc_url, s.bsc_rpc_fallback_url or ""):
        t = (u or "").strip()
        if t and t not in out:
            out.append(t)
    if not out:
        out.append("https://bsc-dataseed.bnbchain.org")
    return out


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
    """True when trying the next URL might help (timeout, connect, 5xx, JSON-RPC -32002)."""
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
    )
    return any(x in m for x in markers)
