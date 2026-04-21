"""POST /lab-report — one-page Lab Report (facts + template + optional LLM polish)."""

from __future__ import annotations

import asyncio
from collections import Counter
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..ai.clustering import _archetype_of
from ..ai.lab_report import _template_narrative, compose_lab_report_narrative
from ..ai.research import WebResearcher
from ..db import session_scope
from ..ingestion.lazy import lazy_ingest_token_detailed_sync
from ..ingestion.onchain import OnchainFourMemeClient
from ..models import DnaFamily, FamilyMutation, Token, TokenTrade
from ..pipeline.trade_refresh import maybe_refresh_stale_trade_sync
from .lab_report_enrich import (
    build_family_activity,
    build_name_signals,
    build_token_strain_and_peers,
    build_wallet_behavior,
    build_wallet_quality,
    compute_risk_opportunity_flags,
    extended_social_queries,
    fetch_wallet_chain_snapshot,
    summarize_social,
)

router = APIRouter(tags=["lab-report"])


class LabReportRequest(BaseModel):
    mode: str = Field(..., description="'wallet' or 'token'")
    address: str = Field(..., min_length=42, max_length=42)


class LabReportResponse(BaseModel):
    mode: str
    address: str
    generated_at: str
    facts: dict
    narrative: dict
    llm_enhanced: bool


def _norm_addr(a: str) -> str:
    x = a.lower().strip()
    if not (x.startswith("0x") and len(x) == 42):
        raise HTTPException(status_code=400, detail="invalid address")
    return x


def _wallet_rows(session: Session, addr: str) -> list[tuple[Token, DnaFamily | None]]:
    q = (
        select(Token, DnaFamily)
        .outerjoin(
            FamilyMutation, FamilyMutation.token_address == Token.token_address
        )
        .outerjoin(DnaFamily, DnaFamily.id == FamilyMutation.family_id)
        .where(func.lower(Token.deployer) == addr)
        .order_by(Token.created_at.desc())
        .limit(500)
    )
    seen: dict[str, tuple[Token, DnaFamily | None]] = {}
    for tok, fam in session.execute(q).all():
        if tok.token_address not in seen:
            seen[tok.token_address] = (tok, fam)
    return list(seen.values())


def _build_wallet_facts(session: Session, addr: str) -> dict:
    rows = _wallet_rows(session, addr)
    if not rows:
        chain = fetch_wallet_chain_snapshot(addr)
        facts: dict = {
            "report_type": "wallet",
            "address": addr,
            "empty_index": True,
            "empty_index_reason": (
                "No Four.Meme token deployments from this wallet are indexed in MemeLab yet."
            ),
            "stats": {
                "tokens_deployed": 0,
                "families_touched": 0,
                "total_volume_24h_usd": 0.0,
                "total_liquidity_usd": 0.0,
                "max_holders_on_any_token": 0,
            },
            "archetype_counts": {},
            "viz": {"archetypes": []},
            "top_families": [],
            "timeline": [],
            "behavior": {},
            "quality": {},
            "name_signals": {},
            "chain_snapshot": chain,
        }
        facts.update(compute_risk_opportunity_flags(facts))
        return facts

    arch_counter: Counter[str] = Counter()
    timeline: list[dict[str, str]] = []
    family_to_tokens: dict[str, list[Token]] = {}

    for tok, fam in rows:
        text = f"{tok.symbol or ''} {tok.name or ''}"
        a = _archetype_of(text)
        key = a if a else "unlabeled"
        arch_counter[key] += 1
        ts = tok.created_at
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        timeline.append(
            {
                "date": ts.date().isoformat(),
                "symbol": tok.symbol or "?",
                "name": (tok.name or "")[:80],
            }
        )
        if fam and fam.id:
            family_to_tokens.setdefault(fam.id, []).append(tok)

    fam_ids = list(family_to_tokens.keys())
    fam_meta: dict[str, DnaFamily] = {}
    if fam_ids:
        for f in session.execute(select(DnaFamily).where(DnaFamily.id.in_(fam_ids))).scalars():
            fam_meta[f.id] = f

    top_families: list[dict[str, object]] = []
    for fid, toks in sorted(
        family_to_tokens.items(), key=lambda x: -len(x[1])
    ):
        meta = fam_meta.get(fid)
        esum = ""
        evo = 0.0
        tvol = 0.0
        if meta:
            esum = (meta.event_summary or "")[:600]
            evo = float(meta.evolution_score or 0.0)
            tvol = float(meta.total_volume_usd or 0.0)
        top_families.append(
            {
                "id": fid,
                "title": meta.event_title if meta else fid,
                "event_summary": esum,
                "your_tokens": len(toks),
                "family_mutations_count": int(meta.mutations_count) if meta else 0,
                "confidence": float(meta.confidence_score) if meta else 0.0,
                "evolution_score": evo,
                "total_volume_usd": tvol,
            }
        )

    vol = 0.0
    liq = 0.0
    holders_max = 0
    for tok, _f in rows:
        tr = session.get(TokenTrade, tok.token_address)
        if tr:
            vol += float(tr.volume_24h_usd or 0.0)
            liq += float(tr.liquidity_usd or 0.0)
            holders_max = max(holders_max, int(tr.holders or 0))
    stats = {
        "tokens_deployed": len(rows),
        "families_touched": len(fam_ids),
        "total_volume_24h_usd": round(vol, 2),
        "total_liquidity_usd": round(liq, 2),
        "max_holders_on_any_token": holders_max,
    }

    arch_list = [
        {"label": k, "value": v}
        for k, v in sorted(arch_counter.items(), key=lambda x: -x[1])[:14]
    ]

    tokens_only = [t for t, _ in rows]
    behavior = build_wallet_behavior(tokens_only)
    quality = build_wallet_quality(session, tokens_only)
    name_signals = build_name_signals(tokens_only)

    facts: dict = {
        "report_type": "wallet",
        "address": addr,
        "stats": stats,
        "archetype_counts": dict(arch_counter.most_common(24)),
        "viz": {"archetypes": arch_list},
        "top_families": top_families[:12],
        "timeline": timeline,
        "behavior": behavior,
        "quality": quality,
        "name_signals": name_signals,
    }
    flags = compute_risk_opportunity_flags(facts)
    facts.update(flags)
    return facts


def _build_token_facts(session: Session, addr: str) -> dict:
    tok = session.get(Token, addr)
    if not tok:
        # User may leave "Token" mode selected while pasting an EOA (deployer wallet).
        # Serve a wallet Lab Report instead of 404 "no_contract".
        rpc = OnchainFourMemeClient()
        if not rpc.has_contract_code(addr):
            return _build_wallet_facts(session, addr)
        try:
            # Holders matter for risk/narrative. We re-enabled this after
            # fixing the real stall: GoPlus used to sleep up to 90s on
            # cooldown — :func:`memedna.ingestion.bscscan._fetch_goplus` now
            # skips the fetch when cooldown > 8s instead of blocking.
            result = lazy_ingest_token_detailed_sync(session, addr)
        except Exception as exc:  # noqa: BLE001
            logger.warning("lazy ingest failed for {}: {}", addr, exc)
            raise HTTPException(
                status_code=502,
                detail=(
                    "Live ingestion failed (RPC/DexScreener error). "
                    "Try again in a minute; the scheduler will also pick "
                    "this token up on its next tick."
                ),
            ) from exc
        if result:
            # Lazy-ingest ran in a worker thread; its commits become visible
            # only after we expire the cached state in this session.
            session.expire_all()
            tok = session.get(Token, addr)
        if not tok:
            reason = result.reason or "no_signal"
            messages = {
                "bad_address": (
                    "Invalid address. Expected a 42-character 0x… hex string."
                ),
                "no_contract": (
                    "No contract deployed at this address on BNB Chain. "
                    "Double-check the address (it might be a wallet or a "
                    "typo). DexScreener pair addresses are NOT token "
                    "addresses — use the base token from the pair page."
                ),
                "no_signal": (
                    "Address has bytecode but we couldn't read ERC-20 "
                    "metadata and DexScreener has no market data for it "
                    "yet. If the token just launched, wait ~30s for "
                    "DexScreener to pick it up and try again."
                ),
            }
            raise HTTPException(
                status_code=404,
                detail=messages.get(reason, "Token not indexed"),
            )

    text = f"{tok.symbol or ''} {tok.name or ''}"
    a = _archetype_of(text)
    arch_counter = {a: 1} if a else {"unlabeled": 1}

    link = session.execute(
        select(FamilyMutation, DnaFamily)
        .join(DnaFamily, DnaFamily.id == FamilyMutation.family_id)
        .where(FamilyMutation.token_address == addr)
        .limit(1)
    ).first()

    top_families: list[dict[str, object]] = []
    families_touched = 0
    fam_obj: DnaFamily | None = None
    fam_mut: FamilyMutation | None = None
    if link is not None:
        fam_mut, fam = link
        fam_obj = fam
        families_touched = 1
        top_families.append(
            {
                "id": fam.id,
                "title": fam.event_title,
                "event_summary": (fam.event_summary or "")[:600],
                "your_tokens": 1,
                "family_mutations_count": int(fam.mutations_count),
                "confidence": float(fam.confidence_score),
                "evolution_score": float(fam.evolution_score or 0.0),
                "total_volume_usd": float(fam.total_volume_usd or 0.0),
            }
        )

    ts = tok.created_at
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    timeline = [
        {
            "date": ts.date().isoformat(),
            "symbol": tok.symbol or "?",
            "name": (tok.name or "")[:80],
        }
    ]

    family_window: str | None = None
    if link is not None:
        fam = link[1]
        family_window = (
            f"DNA family «{fam.event_title[:80]}» spans "
            f"{fam.mutations_count} mutations (confidence {fam.confidence_score:.0%})."
        )

    arch_list = [{"label": k, "value": v} for k, v in arch_counter.items()]

    tr = session.get(TokenTrade, addr)
    # Live DexScreener refresh when the cached row is older than
    # ``trade_freshness_seconds``. Hard-capped inside
    # ``refresh_single_token_trade_sync`` (~4s) so a slow API cannot blow the
    # whole fact-build budget (the 503 issue was primarily GoPlus 90s sleep +
    # cross-thread session misuse — both addressed elsewhere).
    tr = maybe_refresh_stale_trade_sync(session, addr, tr)
    trading: dict[str, float | int] = {}
    if tr:
        trading = {
            "volume_24h_usd": float(tr.volume_24h_usd or 0.0),
            "liquidity_usd": float(tr.liquidity_usd or 0.0),
            "holders": int(tr.holders or 0),
            "price_usd": float(tr.price_usd or 0.0),
            "market_cap_usd": float(tr.market_cap_usd or 0.0),
        }

    token_extras = build_token_strain_and_peers(session, tok, fam_obj, fam_mut)
    family_activity = build_family_activity(session, fam_obj)
    name_signals = build_name_signals(
        [tok],
        extra_text=[tok.description or ""],
    )
    # Same helpers as wallet reports so heatmaps / quality / sparkline render
    # for single-token mode (previously missing → all viz returned null).
    behavior = build_wallet_behavior([tok])
    quality = build_wallet_quality(session, [tok])

    out: dict = {
        "report_type": "token",
        "address": addr,
        "token_symbol": tok.symbol or "",
        "token_name": tok.name or "",
        "token_description": (tok.description or "")[:400],
        # Brand media (DexScreener-sourced) — lets the frontend show a
        # real token avatar on the report cover/header instead of the
        # generic initial-letter tile.
        "token_image_url": tok.image_url,
        "token_header_url": tok.header_url,
        "token_website_url": tok.website_url,
        "token_twitter_url": tok.twitter_url,
        "token_telegram_url": tok.telegram_url,
        "stats": {
            "tokens_deployed": 1,
            "families_touched": families_touched,
        },
        "trading": trading,
        "archetype_counts": arch_counter,
        "viz": {"archetypes": arch_list},
        "top_families": top_families,
        "timeline": timeline,
        "token_extras": token_extras,
        "family_activity": family_activity,
        "name_signals": name_signals,
        "behavior": behavior,
        "quality": quality,
    }
    if family_window:
        out["family_window"] = family_window
    flags = compute_risk_opportunity_flags(out)
    out.update(flags)
    return out


# Overall wall-clock ceiling for the social-research stage. Must be larger
# than ``WebResearcher._query_budget_s`` (a single query) but much smaller
# than the user's tolerance for the Lab Report (which otherwise sat at
# minute+ when Tavily/SerpAPI were throttled). Treat this as the deadline
# after which we serve the report with whatever social signals we managed
# to collect — possibly zero.
_SOCIAL_SIGNALS_BUDGET_S = 12.0


async def _attach_social_signals(facts: dict) -> dict:
    """Merge WebResearcher hits into ``facts`` for the LLM and UI.

    Fails soft: if every upstream provider is rate-limited/dead, we still
    return the report with an empty ``items`` list so the page renders.
    """
    researcher = WebResearcher()
    queries = extended_social_queries(facts)

    async def _one(q: str) -> list[dict[str, Any]]:
        try:
            raw = await researcher.search(q, max_results=6)
        except Exception:  # noqa: BLE001
            return []
        norm: list[dict[str, Any]] = []
        for r in raw:
            url = str(r.get("url") or "").strip()
            if not url:
                continue
            norm.append(
                {
                    "title": str(r.get("title") or "")[:200],
                    "url": url,
                    "snippet": str(r.get("snippet") or "")[:450],
                    "type": str(r.get("type") or "article"),
                    "provider": str(r.get("provider") or ""),
                    "author_handle": r.get("author_handle"),
                    "author_name": r.get("author_name"),
                    "followers": int(r.get("followers") or 0),
                    "likes": int(r.get("likes") or 0),
                    "retweets": int(r.get("retweets") or 0),
                    "views": int(r.get("views") or 0),
                    "published_at": r.get("published_at"),
                    "query": q,
                }
            )
        return norm

    chunks: list[list[dict[str, Any]]] = []
    if queries:
        gather = asyncio.gather(*[_one(q) for q in queries], return_exceptions=True)
        try:
            raw_chunks = await asyncio.wait_for(gather, timeout=_SOCIAL_SIGNALS_BUDGET_S)
            for c in raw_chunks:
                if isinstance(c, Exception):
                    continue
                chunks.append(c)
        except asyncio.TimeoutError:
            logger.info(
                "lab-report: social-signals budget exhausted after {}s; "
                "serving with partial results", _SOCIAL_SIGNALS_BUDGET_S,
            )
            # gather is auto-cancelled by wait_for; any inner tasks will
            # observe CancelledError and terminate.

    seen_urls: set[str] = set()
    items: list[dict[str, object]] = []
    for part in chunks:
        for row in part:
            u = str(row.get("url") or "")
            if u in seen_urls:
                continue
            seen_urls.add(u)
            items.append(row)
            if len(items) >= 24:
                break
        if len(items) >= 24:
            break

    facts["social_signals"] = {
        "queries": queries,
        "items": items,
        "provider_chain": researcher.provider,
        "summary": summarize_social(items),
    }
    return facts


def _build_wallet_facts_threadsafe(addr: str) -> dict:
    """Run wallet fact-building **inside** ``session_scope()`` in the worker
    thread that ``run_in_threadpool`` uses.

    Never pass FastAPI's ``Depends(get_session)`` session into
    ``run_in_threadpool`` — SQLAlchemy ``Session`` is not thread-safe.
    Sharing it across threads causes intermittent deadlocks and requests
    that never complete (Lab Report spinner forever).
    """
    with session_scope() as session:
        return _build_wallet_facts(session, addr)


def _build_token_facts_threadsafe(addr: str) -> dict:
    """Same as :func:`_build_wallet_facts_threadsafe` but for token mode."""
    with session_scope() as session:
        return _build_token_facts(session, addr)


@router.get("/lab-report")
def lab_report_probe() -> dict[str, str]:
    """Health probe so you can verify the route is mounted (GET) before POST."""
    return {
        "service": "MemeLab",
        "endpoint": "/lab-report",
        "methods": "POST JSON body: {\"mode\":\"wallet\"|\"token\",\"address\":\"0x...\"}",
    }


@router.post("/lab-report", response_model=LabReportResponse)
async def post_lab_report(
    body: LabReportRequest,
) -> LabReportResponse:
    addr = _norm_addr(body.address)
    mode = body.mode.lower().strip()
    if mode not in ("wallet", "token"):
        raise HTTPException(status_code=400, detail="mode must be 'wallet' or 'token'")

    # The fact-builders do synchronous DB + RPC + (occasionally) lazy-ingest
    # work. Running them directly in this async handler would block uvicorn's
    # event loop — visible in production as the whole API becoming
    # unresponsive while a single Lab Report request is in flight. Pushing
    # them into Starlette's threadpool keeps the loop free to serve other
    # requests and lets lazy_ingest_token_sync safely `asyncio.run(...)`
    # (that thread has no running loop).
    #
    # IMPORTANT: each threadpool function opens its own ``session_scope()``
    # — do **not** pass ``Depends(get_session)`` here, see module docstring
    # on `_build_*_threadsafe`.
    #
    # Hard ceiling: fact builders touch RPC + DexScreener + (rarely) lazy
    # ingest. A wedged pool or runaway sync call must not hold the HTTP
    # client open for minutes — the UI would show an endless spinner.
    # Generous enough for a cold RPC + lazy-ingest on a new token, but still
    # bounded so a wedged dependency cannot hang forever. (Was 75s; users
    # still hit it when GoPlus+DexScreener stacked — 120s is a safety margin.)
    _FACTS_BUDGET_S = 120.0
    try:
        if mode == "wallet":
            facts = await asyncio.wait_for(
                run_in_threadpool(_build_wallet_facts_threadsafe, addr),
                timeout=_FACTS_BUDGET_S,
            )
        else:
            facts = await asyncio.wait_for(
                run_in_threadpool(_build_token_facts_threadsafe, addr),
                timeout=_FACTS_BUDGET_S,
            )
    except asyncio.TimeoutError:
        logger.warning(
            "lab-report: fact build exceeded {:.0f}s — pool/RPC/DexScreener overload",
            _FACTS_BUDGET_S,
        )
        raise HTTPException(
            status_code=503,
            detail=(
                "Lab Report timed out while loading on-chain data. "
                "The database may be busy (pipeline ingesting many blocks) "
                "or RPC/DexScreener is slow. Retry in 30–60 seconds."
            ),
        ) from None

    # Token request may resolve to wallet facts when the address is an EOA
    # (no contract bytecode). Keep the response ``mode`` aligned with facts.
    rt = facts.get("report_type")
    if rt in ("wallet", "token"):
        mode = rt

    facts = await _attach_social_signals(facts)

    # LLM narrative composer has its own internal fallbacks, but Groq can
    # still stall under throttling. Cap the whole call so a slow LLM can
    # never hold the Lab Report hostage — on timeout we fall through to
    # the deterministic template that ``compose_lab_report_narrative``
    # returns when ``used_llm`` would have been False.
    try:
        narrative, used_llm = await asyncio.wait_for(
            compose_lab_report_narrative(facts), timeout=25.0
        )
    except asyncio.TimeoutError:
        logger.warning(
            "lab-report: narrative composer timed out; serving deterministic "
            "template narrative"
        )
        narrative, used_llm = (_template_narrative(facts), False)

    return LabReportResponse(
        mode=mode,
        address=addr,
        generated_at=datetime.now(tz=timezone.utc).isoformat(),
        facts=facts,
        narrative=narrative,
        llm_enhanced=used_llm,
    )
