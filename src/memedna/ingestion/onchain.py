"""On-chain Four.Meme ingestion via BSC RPC (authoritative fallback).

Reads `TokenCreate` events from the Four.Meme TokenManager2 contract, fetches ERC-20
metadata (name, symbol) directly, and probes bonding-curve progress via the manager's
`_tokenInfos(address)` view. Everything goes through stock `web3.py` so no external
indexer is required.

Even with a free public RPC we cap the scanned block range per call to avoid
`eth_getLogs` limits and walk the chain incrementally.
"""

from __future__ import annotations

import asyncio
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any

from loguru import logger
from web3 import Web3
from web3.exceptions import ContractLogicError

from ..bsc_web3 import bsc_rpc_url_chain, rpc_error_suggests_failover
from ..config import get_settings

# Observed on BSC mainnet Four.Meme TokenManager2 — used to filter eth_getLogs.
# See event definition above (all parameters non-indexed => single topic row).
TOKEN_CREATE_TOPIC0 = (
    "0x396d5e902b675b032348d3d2e9517ee8f0c4a926603fbc075d3d282ff00cad20"
)

# Shared BNB/USD spot for bonding liquidity math (60s TTL).
_BNB_USD_MONO: float = 0.0
_BNB_USD_VAL: float = 0.0


def _bnb_usd_spot() -> float | None:
    """Return BNB price in USD from Binance public API (cached ~60s)."""
    global _BNB_USD_MONO, _BNB_USD_VAL
    now = time.monotonic()
    if now - _BNB_USD_MONO < 60.0 and _BNB_USD_VAL > 0:
        return _BNB_USD_VAL
    try:
        import httpx

        r = httpx.get(
            "https://api.binance.com/api/v3/ticker/price",
            params={"symbol": "BNBUSDT"},
            timeout=6.0,
        )
        r.raise_for_status()
        v = float(r.json()["price"])
        _BNB_USD_VAL, _BNB_USD_MONO = v, now
        return v
    except Exception as exc:  # noqa: BLE001
        logger.debug("BNB/USD spot failed: {}", exc)
        return None


TOKEN_MANAGER_ABI: list[dict[str, Any]] = [
    {
        "anonymous": False,
        "name": "TokenCreate",
        "type": "event",
        # NOTE: on the deployed Four.Meme TokenManager2 *no* parameters are
        # indexed - every TokenCreate log carries a single topic (the event
        # signature hash). Observed signature hash:
        # keccak256("TokenCreate(address,address,uint256,string,string,uint256,uint256,uint256)")
        # = 0x396d5e902b675b032348d3d2e9517ee8f0c4a926603fbc075d3d282ff00cad20
        "inputs": [
            {"indexed": False, "name": "creator",    "type": "address"},
            {"indexed": False, "name": "token",      "type": "address"},
            {"indexed": False, "name": "requestId",  "type": "uint256"},
            {"indexed": False, "name": "name",       "type": "string"},
            {"indexed": False, "name": "symbol",     "type": "string"},
            {"indexed": False, "name": "totalSupply", "type": "uint256"},
            {"indexed": False, "name": "launchTime", "type": "uint256"},
            {"indexed": False, "name": "launchFee",  "type": "uint256"},
        ],
    },
    {
        "name": "_tokenInfos",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "token", "type": "address"}],
        "outputs": [
            {"name": "base", "type": "address"},
            {"name": "quote", "type": "address"},
            {"name": "template", "type": "uint256"},
            {"name": "totalSupply", "type": "uint256"},
            {"name": "maxOffers", "type": "uint256"},
            {"name": "maxRaising", "type": "uint256"},
            {"name": "launchTime", "type": "uint256"},
            {"name": "offers", "type": "uint256"},
            {"name": "funds", "type": "uint256"},
            {"name": "liquidityFee", "type": "uint256"},
            {"name": "lastPrice", "type": "uint256"},
            {"name": "K", "type": "uint256"},
            # On current BSC TokenManager2 the legacy ``T`` slot was dropped —
            # tuple is 416 bytes (13 words after the two addresses).
            {"name": "status", "type": "uint256"},
        ],
    },
]

ERC20_ABI: list[dict[str, Any]] = [
    {
        "constant": True, "inputs": [], "name": "name",
        "outputs": [{"name": "", "type": "string"}], "type": "function",
    },
    {
        "constant": True, "inputs": [], "name": "symbol",
        "outputs": [{"name": "", "type": "string"}], "type": "function",
    },
    {
        "constant": True, "inputs": [], "name": "decimals",
        "outputs": [{"name": "", "type": "uint8"}], "type": "function",
    },
    {
        "constant": True, "inputs": [], "name": "totalSupply",
        "outputs": [{"name": "", "type": "uint256"}], "type": "function",
    },
]

# Public BSC RPCs vary: publicnode caps eth_getLogs at ~10k, llamarpc ~1k,
# bsc-dataseed ~5k. We adapt at runtime: start optimistically, then halve on
# the first "limit exceeded" error and memoize the last known-good size.
_DEFAULT_MAX_BLOCK_RANGE = 4_000
# Alchemy's BSC free-tier caps eth_getLogs at 10 blocks, so we must be able to
# shrink down that far. Public RPCs (Binance, PublicNode, Ankr) happily accept
# thousands, so `_MIN_BLOCK_RANGE` is only the *floor* we back off to when a
# provider keeps rejecting larger windows.
_MIN_BLOCK_RANGE = 10
# How many chunks to pull in parallel. 4 is a safe default for public RPCs;
# bump higher (8–16) if you're pointing at QuickNode / Alchemy / Ankr-paid.
RPC_CONCURRENCY = 4
# Cap total logs pulled per scan to avoid runaway ingestion on first run.
_HARD_EVENT_CAP = 20_000
# Retained only as a hard floor for safety; the real value comes from
# settings.bsc_rpc_safe_history_blocks and can be disabled entirely via
# settings.bsc_rpc_archive.
_PRUNED_HISTORY_SAFE_BLOCKS = 48_000  # noqa: F841 (back-compat shim)


class OnchainFourMemeClient:
    def __init__(self) -> None:
        s = get_settings()
        self._rpc_lock = threading.Lock()
        self._rpc_urls = bsc_rpc_url_chain()
        self._rebuild_web3_at(0)
        # Settings-driven knobs so a paid archive RPC can open up the whole
        # history window without editing code.
        self._archive = bool(s.bsc_rpc_archive)
        self._safe_history_blocks = int(s.bsc_rpc_safe_history_blocks)
        self._block_range = int(s.bsc_rpc_max_block_range) or _DEFAULT_MAX_BLOCK_RANGE
        self._executor = ThreadPoolExecutor(
            max_workers=RPC_CONCURRENCY, thread_name_prefix="bsc-rpc"
        )
        # Diagnostic: set by `list_new_tokens` when the requested start was
        # clamped because cursor fell behind the RPC retention window.
        self._last_gap_blocks = 0

    def _rebuild_web3_at(self, idx: int) -> None:
        s = get_settings()
        if not self._rpc_urls:
            self._rpc_urls = bsc_rpc_url_chain()
        idx = max(0, min(int(idx), len(self._rpc_urls) - 1))
        url = self._rpc_urls[idx]
        self.w3 = Web3(Web3.HTTPProvider(url, request_kwargs={"timeout": 30}))
        self.manager = self.w3.eth.contract(
            address=Web3.to_checksum_address(s.fourmeme_token_manager),
            abi=TOKEN_MANAGER_ABI,
        )
        self.token_create_event = self.manager.events.TokenCreate
        self._rpc_idx = idx

    def _try_failover_rpc(self, exc: BaseException) -> bool:
        if len(self._rpc_urls) < 2 or not rpc_error_suggests_failover(exc):
            return False
        with self._rpc_lock:
            nxt = self._rpc_idx + 1
            if nxt >= len(self._rpc_urls):
                return False
            logger.info(
                "BSC JSON-RPC: switching to fallback ({} of {})",
                nxt + 1,
                len(self._rpc_urls),
            )
            self._rebuild_web3_at(nxt)
        return True

    def _ensure_any_rpc(self) -> bool:
        for i in range(len(self._rpc_urls)):
            self._rebuild_web3_at(i)
            try:
                if self.w3.is_connected():
                    return True
            except Exception:
                continue
        return False

    def latest_block(self) -> int:
        for _ in range(3):
            try:
                return int(self.w3.eth.block_number)
            except Exception as exc:  # noqa: BLE001
                if not self._try_failover_rpc(exc):
                    raise
        return int(self.w3.eth.block_number)

    def estimate_lookback_blocks(self, hours: int) -> int:
        """Estimate how many blocks ago `hours` hours was.

        Since BEP-336 / Lorentz (2025), BSC produces a block every ~1.5 s
        (down from ~3 s pre-Lorentz). We use 1.2 s as a conservative floor so
        we *over-scan* rather than miss events; `_filter_and_log` trims any
        logs that land outside the real time window.
        """
        return int(hours * 3600 / 1.2)

    def _block_time(self, block_number: int) -> datetime:
        blk = self.w3.eth.get_block(block_number)
        return datetime.fromtimestamp(blk["timestamp"], tz=timezone.utc)

    @staticmethod
    def _scrub_url(msg: str) -> str:
        """Best-effort redaction of RPC URLs (they often embed an API key
        in the path). Keeps the error shape intact for debugging without
        leaking credentials into logs / UI."""
        import re
        return re.sub(r"https?://[^\s'\"]+", "<rpc-url>", msg)

    # ── single-chunk fetch with adaptive backoff ─────────────────────────
    def _fetch_chunk(
        self, start: int, end: int
    ) -> list[dict[str, Any]] | str | None:
        """Fetch a block range.

        Returns:
          * a list of logs on success (may be empty),
          * the sentinel string ``"pruned"`` if the RPC rejected the range
            because the history is no longer available (free public node),
          * ``None`` on any other unrecoverable failure.
        """
        for attempt in range(4):
            try:
                try:
                    return self.token_create_event.get_logs(
                        from_block=start, to_block=end
                    )
                except TypeError:
                    return self.token_create_event.get_logs(
                        fromBlock=start, toBlock=end
                    )
            except Exception as exc:  # noqa: BLE001
                scrubbed = self._scrub_url(str(exc))
                msg = scrubbed.lower()
                # Public BSC RPCs return -32701 "history has been pruned" for
                # blocks older than their retention window. That's expected:
                # signal the caller so we fast-forward the cursor.
                if "-32701" in msg or "history has been pruned" in msg:
                    return "pruned"
                # Size-hint: different providers phrase "range too large"
                # differently. Alchemy free-tier ≤500 blocks often replies
                # with a generic "400 Bad Request" (no body), hence we also
                # treat HTTP 400 as a shrink-and-retry signal.
                size_hit = (
                    "limit" in msg
                    or "exceed" in msg
                    or "too many" in msg
                    or "response size" in msg
                    or "block range" in msg
                    or "up to a" in msg                  # Alchemy phrasing
                    or "bad request" in msg              # generic
                    or " 400 " in f" {msg} "             # HTTP 400
                    or msg.startswith("400 ")
                    or "-32600" in msg                   # JSON-RPC invalid params
                    or "-32602" in msg                   # JSON-RPC invalid params
                    or "query returned more than" in msg
                )
                if size_hit:
                    new_range = max(_MIN_BLOCK_RANGE, self._block_range // 2)
                    if new_range < self._block_range:
                        logger.info(
                            "RPC rejected {} block range ({}…); shrinking to {}",
                            self._block_range, scrubbed[:80], new_range,
                        )
                        self._block_range = new_range
                    return "oversize"
                if "429" in msg or "rate" in msg or "timeout" in msg:
                    if self._try_failover_rpc(exc):
                        continue
                    time.sleep(0.8 * (attempt + 1))
                    continue
                if self._try_failover_rpc(exc):
                    continue
                logger.warning("get_logs failed {}-{}: {}", start, end, scrubbed)
                return None
        return None

    def list_new_tokens(
        self,
        since_hours: int = 24,
        max_events: int = _HARD_EVENT_CAP,
        from_block: int | None = None,
        to_block: int | None = None,
        newest_first: bool | None = None,
    ) -> list[dict[str, Any]]:
        """Walk blocks and pull TokenCreate logs.

        Two modes:
          * ``from_block`` / ``to_block`` - explicit range (used by the
            incremental scheduler to resume from ``ingest_cursors``).
          * Otherwise: ``since_hours`` backward window.

        ``newest_first``: when True, process block chunks from head backwards
        so the ``max_events`` cap never trims the *latest* tokens when a busy
        window overflows the cap. Default: True for time-window mode, False
        for explicit from_block ranges (we want to advance cursor safely).

        Uses a thread-pool to fan out `RPC_CONCURRENCY` chunk fetches in
        parallel and dynamically shrinks the block range if the RPC complains
        about size.
        """
        if not self._ensure_any_rpc():
            logger.warning("BSC RPC not reachable (tried all configured JSON-RPC endpoints)")
            return []
        latest = self.latest_block()
        if from_block is not None:
            start_block = max(int(from_block), 0)
            end_block = int(to_block) if to_block is not None else latest
        else:
            end_block = latest
            lookback = self.estimate_lookback_blocks(since_hours)
            start_block = max(end_block - lookback, 0)

        # Guard against pruned-history: public RPCs only retain a few hundred
        # blocks of logs. If our requested range reaches too far back, clamp
        # to a safe window so we avoid a storm of -32701 errors *and* still
        # pick up the most recent creations. Archive-enabled paid RPCs skip
        # this (set BSC_RPC_ARCHIVE=true).
        gap_blocks = 0
        if not self._archive:
            pruned_floor = max(end_block - self._safe_history_blocks, 0)
            if start_block < pruned_floor:
                gap_blocks = pruned_floor - start_block
                logger.warning(
                    "onchain scan: cursor is {:,} blocks (~{:.1f}h) behind the "
                    "RPC retention window (~{:,} blocks). That gap cannot be "
                    "recovered without a paid archive RPC. Clamping start "
                    "{} → {}. Set BSC_RPC_ARCHIVE=true when pointing at a "
                    "paid archive node.",
                    gap_blocks, gap_blocks * 1.2 / 3600.0,
                    self._safe_history_blocks, start_block, pruned_floor,
                )
                start_block = pruned_floor
        self._last_gap_blocks = gap_blocks  # surfaced to the API / UI

        if end_block < start_block:
            logger.info("onchain scan: no new blocks (cursor @ {})", start_block)
            return []

        logger.info(
            "Scanning Four.Meme TokenCreate blocks {} → {} (~{}h, ~{:,} blocks, "
            "range={}, concurrency={})",
            start_block, end_block, since_hours, end_block - start_block,
            self._block_range, RPC_CONCURRENCY,
        )

        # Build a queue of (start, end) chunks.
        pending: list[tuple[int, int]] = []
        cur = start_block
        while cur <= end_block:
            pending.append((cur, min(cur + self._block_range - 1, end_block)))
            cur += self._block_range
        # Newest-first prevents `max_events` from trimming the freshest tokens
        # when a busy window overflows the cap. Default True unless the caller
        # is advancing a cursor (from_block explicit), in which case oldest
        # first keeps cursor-write semantics correct.
        if newest_first is None:
            newest_first = from_block is None
        if newest_first:
            pending.reverse()

        out: list[dict[str, Any]] = []
        failures = 0
        pruned_chunks = 0
        total_chunks = len(pending)
        processed = 0

        while pending and len(out) < max_events:
            batch = pending[:RPC_CONCURRENCY]
            pending = pending[RPC_CONCURRENCY:]
            futures = [self._executor.submit(self._fetch_chunk, s, e) for s, e in batch]
            for (s, e), fut in zip(batch, futures):
                logs = fut.result()
                if logs == "pruned":
                    # Free RPC dropped this range. Move on - nothing we can do
                    # without a paid archive node. Count it separately so we
                    # don't fall into the retry-storm branch below.
                    pruned_chunks += 1
                    continue
                if logs == "oversize":
                    # The RPC just told us this chunk is too big. Re-split and
                    # re-queue (and the global `_block_range` has already been
                    # halved inside `_fetch_chunk`).
                    chunk_len = e - s + 1
                    if chunk_len > _MIN_BLOCK_RANGE:
                        mid = (s + e) // 2
                        pending.extend([(s, mid), (mid + 1, e)])
                    else:
                        failures += 1
                    continue
                if logs is None:
                    failures += 1
                    chunk_len = e - s + 1
                    if chunk_len > _MIN_BLOCK_RANGE:
                        mid = (s + e) // 2
                        pending.extend([(s, mid), (mid + 1, e)])
                        logger.debug("re-split failed chunk {}-{}", s, e)
                    if failures >= 16:
                        logger.error(
                            "Too many RPC failures ({}); aborting scan", failures
                        )
                        return _filter_and_log(out, since_hours)
                    continue
                for ev in logs:
                    args = ev["args"]
                    try:
                        ts = datetime.fromtimestamp(
                            int(args["launchTime"]), tz=timezone.utc
                        )
                    except Exception:
                        try:
                            ts = self._block_time(ev["blockNumber"])
                        except Exception:
                            ts = datetime.now(tz=timezone.utc)
                    out.append(
                        {
                            "token_address": args["token"].lower(),
                            "symbol": args.get("symbol") or "",
                            "name": args.get("name") or "",
                            "description": "",
                            "deployer": args["creator"].lower(),
                            "created_at": ts,
                            "launch_tx_hash": ev["transactionHash"].hex(),
                            "source": "onchain",
                        }
                    )
                    if len(out) >= max_events:
                        break
                processed += 1

            if processed and processed % max(1, RPC_CONCURRENCY * 4) == 0:
                logger.debug(
                    "onchain scan: {}/{} chunks, {} tokens so far",
                    processed, total_chunks, len(out),
                )

        if pruned_chunks:
            logger.info(
                "onchain scan: {}/{} chunks skipped (history pruned by RPC)",
                pruned_chunks, total_chunks,
            )
        if from_block is not None:
            return _dedupe(out)
        return _filter_and_log(out, since_hours)

    def list_latest_tokens_head(
        self,
        head_blocks: int = 6_000,
        max_events: int = 4_000,
    ) -> list[dict[str, Any]]:
        """Dedicated "catch the very newest" scan path.

        Walks ``[latest - head_blocks, latest]`` *newest-first*, independent
        of the ingest cursor. Use this for the UI-triggered "Refresh ingest"
        button so the latest Four.Meme launches always land — even if the
        scheduler fell behind and created a pruned-history gap.

        ~6 000 blocks at BSC's 1.2 s/block ≈ the last 2 h.
        """
        latest = self.latest_block()
        start = max(latest - int(head_blocks), 0)
        return self.list_new_tokens(
            from_block=start,
            to_block=latest,
            max_events=max_events,
            newest_first=True,
        )

    def enrich_with_bonding(self, token_address: str) -> dict[str, Any]:
        """Best-effort bonding curve probe.

        The production TokenManager2 ABI for `_tokenInfos` is not public and
        varies between Four.Meme upgrades; therefore we treat this call as
        strictly best-effort and swallow *any* decode/RPC failure - ingestion
        and downstream DNA analysis must never be blocked by a missing probe.
        """
        try:
            info = self.manager.functions._tokenInfos(
                Web3.to_checksum_address(token_address)
            ).call()
        except Exception as exc:  # noqa: BLE001
            logger.debug("bonding-info call failed for {}: {}", token_address, exc)
            return {}
        try:
            offers, funds, max_raising, status = info[7], info[8], info[5], info[12]
        except (IndexError, TypeError):
            return {}
        progress = 0.0
        try:
            if max_raising and int(max_raising) > 0:
                progress = min(1.0, float(funds) / float(max_raising))
        except (TypeError, ValueError):
            progress = 0.0
        try:
            return {
                "bonding_progress": progress,
                "migrated": int(status) >= 2,
                "raw_metadata": {
                    "template": str(info[2]),
                    "totalSupply": str(info[3]),
                    "maxRaising": str(info[5]),
                    "launchTime": int(info[6]),
                    "offers": str(info[7]),
                    "funds": str(info[8]),
                    "status": int(info[12]),
                },
            }
        except Exception:  # noqa: BLE001
            return {"bonding_progress": progress}

    def estimate_bonding_liquidity_usd(self, token_address: str) -> float | None:
        """USD value of BNB sitting in the Four.Meme bonding curve (``funds``).

        DexScreener's ``liquidity.usd`` is often **empty** for ``dexId=fourmeme``
        pairs — it is an order-book style curve, not a classic Uniswap V2 pool.
        Four.meme's UI shows this bonding depth; we approximate it as
        ``funds_wei / 1e18 * BNB_USD`` from ``_tokenInfos``.
        """
        try:
            info = self.manager.functions._tokenInfos(
                Web3.to_checksum_address(token_address)
            ).call()
            funds = int(info[8])
        except Exception as exc:  # noqa: BLE001
            logger.debug("estimate_bonding_liquidity_usd: _tokenInfos {}", exc)
            return None
        if funds <= 0:
            return None
        bnb = float(funds) / 1e18
        usd = _bnb_usd_spot()
        if usd is None or usd <= 0:
            return None
        return round(bnb * usd, 2)

    def resolve_token_deployer(self, token_address: str) -> str | None:
        """Find the creator address from a ``TokenCreate`` log for ``token``.

        Lazy-ingest previously left ``deployer`` NULL because we never joined
        the on-chain event. We locate the launch block from ``launchTime`` in
        ``_tokenInfos`` and scan a *small* window for the matching event —
        same source as the main pipeline's list_new_tokens path.
        """
        want = token_address.lower().strip()
        if not (want.startswith("0x") and len(want) == 42):
            return None
        try:
            info = self.manager.functions._tokenInfos(
                Web3.to_checksum_address(token_address)
            ).call()
            launch_ts = int(info[6])
        except Exception as exc:  # noqa: BLE001
            logger.debug("resolve_token_deployer: _tokenInfos {}", exc)
            return None
        if launch_ts < 1_600_000_000:
            return None

        latest = int(self.w3.eth.block_number)
        age_sec = max(0, int(time.time()) - launch_ts)
        settings = get_settings()
        # Convert age to *block* height delta. The previous formula used
        # ``age_sec // 2`` as if it were blocks — that landed deep in pruned
        # history and broke every ``eth_getLogs`` on public RPCs.
        sec_per_block = 2.5
        blocks_since_launch = max(1, int(age_sec / sec_per_block))
        blocks_since_launch = min(blocks_since_launch, latest - 1)
        center = max(1, latest - blocks_since_launch)
        safe = max(1000, int(getattr(settings, "bsc_rpc_safe_history_blocks", 48_000)))
        # Public RPCs prune ``eth_getLogs`` after ~``safe`` blocks. Point ``BSC_RPC_URL``
        # at an archive-capable node and set ``BSC_RPC_ARCHIVE=1`` so we can still
        # resolve ``TokenCreate`` for older launches (Etherscan API V2 does not offer
        # free ``getLogs`` on BNB Chain as of 2025).
        in_rpc_window = bool(self._archive) or center >= max(1, latest - safe)
        if not in_rpc_window:
            logger.debug(
                "resolve_token_deployer: launch before RPC log window "
                "(center={} latest={} safe_blocks={}); set BSC_RPC_ARCHIVE=1 + archive RPC",
                center,
                latest,
                safe,
            )
            return None

        for span in (500, 2500, 12_000):
            lo = max(1, center - span)
            hi = min(latest, center + span)
            found = self._scan_token_create_in_range(lo, hi, want)
            if found:
                return found
        return None

    def _scan_token_create_in_range(
        self, from_block: int, to_block: int, token_want: str
    ) -> str | None:
        """Decode TokenCreate logs in ``[from_block, to_block]`` (chunked)."""
        token_want = token_want.lower()
        b = from_block
        # Stay under typical eth_getLogs block-width caps (500–2000).
        chunk = 1800
        mgr = Web3.to_checksum_address(self.manager.address)
        while b <= to_block:
            eb = min(b + chunk - 1, to_block)
            try:
                raw_logs = self.w3.eth.get_logs(
                    {
                        "fromBlock": b,
                        "toBlock": eb,
                        "address": mgr,
                        "topics": [TOKEN_CREATE_TOPIC0],
                    }
                )
            except Exception as exc:  # noqa: BLE001
                logger.debug("get_logs {}-{}: {}", b, eb, exc)
                return None
            for lg in raw_logs:
                try:
                    ev = self.token_create_event.process_log(lg)
                    args = ev["args"]
                    tok = str(args.get("token", "")).lower()
                    if tok == token_want:
                        return str(args["creator"]).lower()
                except Exception:  # noqa: BLE001
                    continue
            b = eb + 1
        return None

    def __del__(self) -> None:  # pragma: no cover
        try:
            self._executor.shutdown(wait=False, cancel_futures=True)
        except Exception:
            pass

    def has_contract_code(self, address: str) -> bool:
        """Return True iff ``address`` has deployed bytecode on BSC.

        Cheap probe (single ``eth_getCode``) used by lazy-ingest to fail
        fast on EOAs and typos instead of waiting on ERC-20 ABI calls that
        will time out against an empty account.
        """
        try:
            code = self.w3.eth.get_code(Web3.to_checksum_address(address))
        except Exception as exc:  # noqa: BLE001
            logger.debug("eth_getCode failed for {}: {}", address, exc)
            return False
        return bool(code) and len(code) > 0

    def fetch_erc20_metadata(self, token_address: str) -> dict[str, Any]:
        """Fallback to read name/symbol directly from the token contract."""
        try:
            c = self.w3.eth.contract(
                address=Web3.to_checksum_address(token_address), abi=ERC20_ABI
            )
            return {
                "name": c.functions.name().call(),
                "symbol": c.functions.symbol().call(),
            }
        except Exception as exc:  # noqa: BLE001
            logger.debug("erc20 metadata call failed for {}: {}", token_address, exc)
            return {}


def _dedupe(tokens: list[dict[str, Any]]) -> list[dict[str, Any]]:
    dedup: dict[str, dict[str, Any]] = {}
    for t in tokens:
        dedup[t["token_address"]] = t
    out = list(dedup.values())
    logger.info(
        "On-chain scan collected {} TokenCreate logs, {} unique",
        len(tokens), len(out),
    )
    return out


def _filter_and_log(
    tokens: list[dict[str, Any]], since_hours: int
) -> list[dict[str, Any]]:
    since = datetime.now(tz=timezone.utc) - timedelta(hours=since_hours)
    before = len(tokens)
    tokens = [t for t in tokens if t["created_at"] >= since]
    dedup: dict[str, dict[str, Any]] = {}
    for t in tokens:
        dedup[t["token_address"]] = t
    tokens = list(dedup.values())
    logger.info(
        "On-chain scan collected {} TokenCreate logs, {} unique in-window",
        before, len(tokens),
    )
    return tokens
