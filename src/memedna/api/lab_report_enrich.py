"""Deeper, stats-heavy enrichment for the Lab Report facts block.

This module is intentionally separate from ``lab_report.py`` so the
HTTP handler stays slim while the analytical heavy-lifting lives here.

Everything is **read-only** and **best-effort**: if a helper cannot
compute a field it just returns an empty structure; nothing raises.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

import httpx
from loguru import logger
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (
    DnaFamily,
    FamilyMutation,
    FamilyTimepoint,
    Token,
    TokenTrade,
)

def fetch_wallet_chain_snapshot(addr: str) -> dict[str, Any]:
    """Live BNB Chain hints for wallets with no MemeLab deploy index (RPC + optional BscScan)."""
    from web3 import Web3

    from ..bsc_web3 import connect_first_bsc_web3
    from ..config import get_settings

    raw = addr.lower().strip()
    out: dict[str, Any] = {"address": raw}
    s = get_settings()
    try:
        w3 = connect_first_bsc_web3(timeout=12.0)
        if not w3.is_connected():
            out["rpc_reachable"] = False
            return out
        cs = Web3.to_checksum_address(raw)
        out["rpc_reachable"] = True
        out["nonce"] = int(w3.eth.get_transaction_count(cs))
        bal_wei = int(w3.eth.get_balance(cs))
        out["balance_wei"] = bal_wei
        out["balance_bnb"] = round(float(Web3.from_wei(bal_wei, "ether")), 8)
        code = w3.eth.get_code(cs)
        out["is_smart_contract"] = len(code) > 2
    except Exception as exc:  # noqa: BLE001
        logger.warning("fetch_wallet_chain_snapshot RPC failed: {}", exc)
        out["rpc_reachable"] = False
        out["rpc_error"] = str(exc)[:240]
        return out

    api_key = (s.bscscan_api_key or "").strip()
    if not api_key:
        out["explorer_note"] = "Set BSCSCAN_API_KEY for first/last on-chain activity timestamps."
        return out

    def _tx_params(sort: str) -> dict[str, str | int]:
        return {
            "module": "account",
            "action": "txlist",
            "address": raw,
            "startblock": 0,
            "endblock": 99_999_999,
            "page": 1,
            "offset": 1,
            "sort": sort,
            "apikey": api_key,
        }

    try:
        r = httpx.get("https://api.bscscan.com/api", params=_tx_params("asc"), timeout=10.0)
        r.raise_for_status()
        data = r.json()
        res = data.get("result")
        if isinstance(res, list) and res:
            ts0 = int(res[0].get("timeStamp") or 0)
            if ts0:
                out["first_tx_at_utc"] = datetime.fromtimestamp(
                    ts0, tz=timezone.utc
                ).isoformat()
                out["first_tx_age_days"] = max(
                    0,
                    int((datetime.now(timezone.utc).timestamp() - ts0) / 86400),
                )
        elif isinstance(res, list) and not res:
            out["explorer_outgoing_txs"] = 0
        r2 = httpx.get("https://api.bscscan.com/api", params=_tx_params("desc"), timeout=10.0)
        r2.raise_for_status()
        data2 = r2.json()
        res2 = data2.get("result")
        if isinstance(res2, list) and res2:
            ts1 = int(res2[0].get("timeStamp") or 0)
            if ts1:
                out["last_tx_at_utc"] = datetime.fromtimestamp(
                    ts1, tz=timezone.utc
                ).isoformat()
    except Exception as exc:  # noqa: BLE001
        logger.debug("BscScan txlist helper failed: {}", exc)
        out["explorer_error"] = str(exc)[:200]

    return out


_STOPWORDS = {
    "the", "and", "for", "with", "that", "this", "your", "from",
    "into", "not", "but", "are", "was", "were", "has", "have",
    "will", "you", "its", "our", "their", "they", "them", "coin",
    "token", "memecoin", "meme", "bnb", "bsc", "four", "fourmeme",
    "official", "inu", "dog", "cat", "pepe",  # too generic inside meme sets
}


# --------------------------------------------------------------------- utils


def _utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _tokenize(text: str) -> list[str]:
    words = re.findall(r"[A-Za-z][A-Za-z0-9]{2,}", (text or "").lower())
    return [w for w in words if w not in _STOPWORDS and len(w) >= 3]


# ------------------------------------------------------- wallet: behaviour


def build_wallet_behavior(tokens: list[Token]) -> dict[str, Any]:
    """24h-of-day and day-of-week histograms + daily deploy series + streaks."""
    if not tokens:
        return {}

    hour_hist = [0] * 24
    dow_hist = [0] * 7
    day_counter: Counter[str] = Counter()
    dates: list[datetime] = []

    for t in tokens:
        ts = _utc(t.created_at)
        hour_hist[ts.hour] += 1
        dow_hist[ts.weekday()] += 1
        day_counter[ts.date().isoformat()] += 1
        dates.append(ts)

    first = min(dates)
    last = max(dates)
    span_days = max(1, (last.date() - first.date()).days + 1)

    # Last-30-days series (always 30 buckets, zero-filled).
    today = datetime.now(tz=timezone.utc).date()
    daily: list[dict[str, Any]] = []
    for i in range(29, -1, -1):
        d = today - timedelta(days=i)
        daily.append({"date": d.isoformat(), "count": int(day_counter.get(d.isoformat(), 0))})

    # Longest active streak (consecutive days with ≥1 deploy).
    sorted_days = sorted(day_counter.keys())
    longest = cur = 0
    prev: datetime | None = None
    for dstr in sorted_days:
        d = datetime.strptime(dstr, "%Y-%m-%d").date()
        if prev is None or (d - prev).days != 1:
            cur = 1
        else:
            cur += 1
        longest = max(longest, cur)
        prev = d

    return {
        "hour_histogram": hour_hist,
        "dow_histogram": dow_hist,
        "daily_last_30": daily,
        "days_active": len(day_counter),
        "span_days": span_days,
        "longest_streak_days": longest,
        "first_deploy_at": first.isoformat(),
        "last_deploy_at": last.isoformat(),
        "avg_deploys_per_active_day": round(len(tokens) / max(1, len(day_counter)), 2),
    }


# ------------------------------------------------------- wallet: quality


def build_wallet_quality(session: Session, tokens: list[Token]) -> dict[str, Any]:
    """Aggregate trading & lifecycle quality metrics across the wallet's tokens."""
    if not tokens:
        return {}

    n = len(tokens)
    migrated = sum(1 for t in tokens if t.migrated)
    with_trade = 0
    vol = 0.0
    liq = 0.0
    holders = 0
    mcap = 0.0
    trades = 0

    addrs = [t.token_address for t in tokens]
    for batch_start in range(0, len(addrs), 200):
        chunk = addrs[batch_start : batch_start + 200]
        rows = session.execute(
            select(TokenTrade).where(TokenTrade.token_address.in_(chunk))
        ).scalars()
        for tr in rows:
            with_trade += 1
            vol += float(tr.volume_24h_usd or 0.0)
            liq += float(tr.liquidity_usd or 0.0)
            holders += int(tr.holders or 0)
            mcap += float(tr.market_cap_usd or 0.0)
            trades += int(tr.trades_24h or 0)

    return {
        "migration_rate": round(migrated / n, 3) if n else 0.0,
        "active_trade_rate": round(with_trade / n, 3) if n else 0.0,
        "avg_holders": round(holders / with_trade, 1) if with_trade else 0.0,
        "avg_volume_24h_usd": round(vol / with_trade, 2) if with_trade else 0.0,
        "avg_liquidity_usd": round(liq / with_trade, 2) if with_trade else 0.0,
        "sum_market_cap_usd": round(mcap, 2),
        "sum_trades_24h": int(trades),
    }


# ------------------------------------------------------- wallet: vocabulary


def build_name_signals(
    tokens: list[Token], extra_text: Iterable[str] = ()
) -> list[dict[str, int]]:
    """Weighted keyword cloud from symbols/names/descriptions."""
    ctr: Counter[str] = Counter()
    for t in tokens:
        for w in _tokenize(t.symbol or ""):
            ctr[w] += 2
        for w in _tokenize(t.name or ""):
            ctr[w] += 1
        for w in _tokenize(t.description or ""):
            ctr[w] += 1
    for blob in extra_text:
        for w in _tokenize(blob or ""):
            ctr[w] += 1
    return [{"term": k, "weight": int(v)} for k, v in ctr.most_common(20)]


# ------------------------------------------------------- token: peers & strain


def build_token_strain_and_peers(
    session: Session, token: Token, fam: DnaFamily | None, fam_mut: FamilyMutation | None
) -> dict[str, Any]:
    """Strain roles for this token plus the top peer tokens inside the same family."""
    out: dict[str, Any] = {
        "strain_roles": {
            "is_origin": bool(fam_mut.is_origin_strain) if fam_mut else False,
            "is_dominant": bool(fam_mut.is_dominant_strain) if fam_mut else False,
            "is_fastest": bool(fam_mut.is_fastest_mutation) if fam_mut else False,
            "note": (fam_mut.why_this_mutation_belongs or "")[:300] if fam_mut else "",
        },
        "peers": [],
    }
    if fam is None:
        return out

    rows = session.execute(
        select(Token, TokenTrade, FamilyMutation)
        .join(FamilyMutation, FamilyMutation.token_address == Token.token_address)
        .outerjoin(TokenTrade, TokenTrade.token_address == Token.token_address)
        .where(FamilyMutation.family_id == fam.id)
        .where(Token.token_address != token.token_address)
        .limit(40)
    ).all()

    peers: list[dict[str, Any]] = []
    for tk, tr, mut in rows:
        peers.append(
            {
                "address": tk.token_address,
                "symbol": tk.symbol or "",
                "name": (tk.name or "")[:60],
                "created_at": _utc(tk.created_at).isoformat(),
                "volume_24h_usd": float(tr.volume_24h_usd or 0.0) if tr else 0.0,
                "holders": int(tr.holders or 0) if tr else 0,
                "liquidity_usd": float(tr.liquidity_usd or 0.0) if tr else 0.0,
                "is_origin": bool(mut.is_origin_strain),
                "is_dominant": bool(mut.is_dominant_strain),
                "is_fastest": bool(mut.is_fastest_mutation),
            }
        )

    peers.sort(key=lambda p: (-p["volume_24h_usd"], -p["holders"]))
    out["peers"] = peers[:8]
    return out


# ------------------------------------------------------- token: family activity


def build_family_activity(session: Session, fam: DnaFamily | None) -> list[dict[str, Any]]:
    """Zero-filled 30-day mutation/volume series from FamilyTimepoint buckets."""
    if fam is None:
        return []
    rows = session.execute(
        select(FamilyTimepoint)
        .where(FamilyTimepoint.family_id == fam.id)
        .order_by(FamilyTimepoint.bucket.asc())
    ).scalars().all()
    if not rows:
        return []

    by_day: dict[str, dict[str, float]] = {}
    for r in rows:
        d = _utc(r.bucket).date().isoformat()
        cell = by_day.setdefault(d, {"mutations": 0, "volume_usd": 0.0})
        cell["mutations"] += int(r.mutations or 0)
        cell["volume_usd"] += float(r.volume_usd or 0.0)

    today = datetime.now(tz=timezone.utc).date()
    out: list[dict[str, Any]] = []
    for i in range(29, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        cell = by_day.get(d) or {"mutations": 0, "volume_usd": 0.0}
        out.append(
            {
                "date": d,
                "mutations": int(cell["mutations"]),
                "volume_usd": round(float(cell["volume_usd"]), 2),
            }
        )
    return out


# ------------------------------------------------------- social summary


_POS_WORDS = {
    "bull", "bullish", "moon", "gem", "pump", "ath", "ath-bound", "rally",
    "wagmi", "send", "green", "win", "winning", "strong", "fire",
    "based", "alpha", "conviction",
}
_NEG_WORDS = {
    "rug", "rugged", "scam", "dump", "dumping", "bear", "bearish", "fud",
    "honeypot", "exit", "dead", "dying", "redflag", "shit", "fake",
    "manipulated", "crash", "ngmi", "bagholder",
}


def _classify_sentiment(text: str) -> str:
    t = (text or "").lower()
    pos = sum(1 for w in _POS_WORDS if w in t)
    neg = sum(1 for w in _NEG_WORDS if w in t)
    if pos > neg and pos >= 1:
        return "positive"
    if neg > pos and neg >= 1:
        return "negative"
    return "neutral"


def summarize_social(items: list[dict[str, Any]]) -> dict[str, Any]:
    if not items:
        return {
            "types": [],
            "providers": [],
            "sentiment": {"positive": 0, "neutral": 0, "negative": 0},
            "engagement": {"tweets": 0, "likes": 0, "retweets": 0, "views": 0},
            "top_authors": [],
        }
    tc: Counter[str] = Counter()
    pc: Counter[str] = Counter()
    sc: Counter[str] = Counter({"positive": 0, "neutral": 0, "negative": 0})
    authors: Counter[str] = Counter()
    likes = rts = views = 0
    tweets = 0

    for it in items:
        tc[str(it.get("type") or "article")] += 1
        pc[str(it.get("provider") or "?")] += 1
        blob = f"{it.get('title') or ''} {it.get('snippet') or ''}"
        sc[_classify_sentiment(blob)] += 1
        if str(it.get("type")) == "tweet":
            tweets += 1
            handle = str(it.get("author_handle") or "").strip()
            if handle:
                authors[handle] += 1
            likes += int(it.get("likes") or 0)
            rts += int(it.get("retweets") or 0)
            views += int(it.get("views") or 0)

    return {
        "types": [{"label": k, "value": v} for k, v in tc.most_common()],
        "providers": [{"label": k, "value": v} for k, v in pc.most_common()],
        "sentiment": {"positive": sc["positive"], "neutral": sc["neutral"], "negative": sc["negative"]},
        "engagement": {"tweets": tweets, "likes": likes, "retweets": rts, "views": views},
        "top_authors": [
            {"handle": h, "count": c} for h, c in authors.most_common(5)
        ],
    }


def extended_social_queries(facts: dict[str, Any]) -> list[str]:
    """Richer query set (5-7) than the base one-liner version."""
    qs: list[str] = []
    rt = facts.get("report_type")
    if rt == "token":
        name = (facts.get("token_name") or "").strip()
        sym = (facts.get("token_symbol") or "").strip()
        if name or sym:
            qs.append(f"{name} {sym} BNB Chain Four.Meme meme token")
            qs.append(f"${sym} meme token review")
            qs.append(f"{name} {sym} rug scam risk")
        top = facts.get("top_families") or []
        if top:
            t0 = str(top[0].get("title") or "").strip()
            if t0:
                qs.append(f"{t0} crypto meme narrative")
        desc = (facts.get("token_description") or "").strip()
        if len(desc) >= 20:
            qs.append(f"{name} {sym} {desc[:80]}")
    else:
        addr = str(facts.get("address") or "")
        if addr:
            qs.append(f"{addr} BNB Chain deployer")
        qs.append("BNB Chain Four.Meme meme token deployer")
        n = int((facts.get("stats") or {}).get("tokens_deployed") or 0)
        if n > 3:
            qs.append(f"Four.Meme serial deployer {n} launches")
        top = facts.get("top_families") or []
        for f in top[:2]:
            t = str(f.get("title") or "").strip()
            if t:
                qs.append(f"{t} Four.Meme meme")
        names = facts.get("name_signals") or []
        if names:
            kw = " ".join(str(n.get("term") or "") for n in names[:3])
            if kw.strip():
                qs.append(f"{kw} meme coin BNB Chain")

    seen: set[str] = set()
    out: list[str] = []
    for q in qs:
        q = (q or "").strip()
        if q and q not in seen:
            seen.add(q)
            out.append(q)
    return out[:6]


# ------------------------------------------------------- risk & opportunity


def compute_risk_opportunity_flags(facts: dict[str, Any]) -> dict[str, list[str]]:
    """Deterministic, rule-based flags derived purely from facts. LLM may expand."""
    risks: list[str] = []
    opps: list[str] = []
    rt = facts.get("report_type")

    if rt == "wallet":
        q = facts.get("quality") or {}
        b = facts.get("behavior") or {}
        st = facts.get("stats") or {}
        n = int(st.get("tokens_deployed") or 0)
        if facts.get("empty_index"):
            risks.append(
                "MemeLab has no indexed Four.Meme deploys for this wallet — deploy cadence and "
                "family ties cannot be scored from our corpus."
            )
            ch = facts.get("chain_snapshot") or {}
            if ch.get("first_tx_age_days") is not None:
                d = int(ch["first_tx_age_days"])
                if d < 14:
                    opps.append(
                        f"On-chain activity is young (~{d} days since first seen tx) — monitor for a first Four.Meme footprint."
                    )
                elif d > 365:
                    opps.append(
                        f"Wallet has on-chain history (~{d} days since first seen tx) but no MemeLab Four.Meme index — may be inactive on this venue."
                    )
        if q.get("migration_rate") is not None and n >= 3 and float(q["migration_rate"]) < 0.1:
            risks.append(
                f"Low migration rate ({float(q['migration_rate']):.0%}) across {n} launches — most tokens did not graduate."
            )
        if q.get("active_trade_rate") is not None and n >= 3 and float(q["active_trade_rate"]) < 0.3:
            risks.append(
                f"Only {float(q['active_trade_rate']):.0%} of launches have indexed trading — many appear inactive."
            )
        if b.get("avg_deploys_per_active_day", 0) and float(b["avg_deploys_per_active_day"]) >= 3:
            risks.append(
                f"High burst rate (~{float(b['avg_deploys_per_active_day']):.1f} tokens per active day) — classic spray-and-pray pattern."
            )
        if q.get("sum_market_cap_usd", 0) and float(q["sum_market_cap_usd"]) >= 1_000_000:
            opps.append(
                f"Cumulative indexed market cap ~${float(q['sum_market_cap_usd']):,.0f} across launches."
            )
        if b.get("longest_streak_days", 0) and int(b["longest_streak_days"]) >= 5:
            opps.append(
                f"{int(b['longest_streak_days'])}-day active streak — sustained activity rather than one-off."
            )
        if int(st.get("families_touched") or 0) >= 3:
            opps.append(
                f"Wallet spans {int(st['families_touched'])} DNA families — cross-narrative exposure."
            )
    else:
        tr = facts.get("trading") or {}
        if tr:
            if float(tr.get("liquidity_usd") or 0) < 5_000:
                risks.append(
                    f"Thin liquidity (${float(tr.get('liquidity_usd') or 0):,.0f}) — exit impact risk."
                )
            if int(tr.get("holders") or 0) < 50:
                risks.append(f"Low holder count ({int(tr.get('holders') or 0)}).")
            if float(tr.get("volume_24h_usd") or 0) >= 100_000:
                opps.append(
                    f"Active 24h volume ${float(tr['volume_24h_usd']):,.0f}."
                )
        fams = facts.get("top_families") or []
        if fams:
            f0 = fams[0]
            conf = float(f0.get("confidence") or 0)
            if conf >= 0.8:
                opps.append(
                    f"High-confidence family match ({conf:.0%}) to «{str(f0.get('title', ''))[:60]}»."
                )
            evo = float(f0.get("evolution_score") or 0)
            if evo >= 40:
                opps.append(f"Family evolution score {evo:.0f} — narrative still compounding.")
        sr = (facts.get("token_extras") or {}).get("strain_roles") or {}
        if sr.get("is_origin"):
            opps.append("Tagged as origin strain — earliest mutation in its family.")
        if sr.get("is_dominant"):
            opps.append("Tagged as dominant strain — largest market footprint in family.")
        if sr.get("is_fastest"):
            opps.append("Tagged as fastest mutation — highest post-launch velocity in family.")

    return {"risk_flags": risks[:6], "opportunity_flags": opps[:6]}
