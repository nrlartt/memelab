"""One-shot Lab Report narrative: template facts + optional LLM polish (no chat)."""

from __future__ import annotations

import orjson
from loguru import logger

from .llm import get_llm

_SYSTEM = """You are MemeLab's senior report analyst. You receive a rich structured JSON \
payload about either a deployer wallet or a single token (Four.Meme on BNB Chain), plus \
optional ``social_signals`` (web/X search snippets; may be incomplete or noisy) and \
deterministic ``risk_flags`` / ``opportunity_flags``. Write clear, neutral, analyst-grade copy \
for a multi-section DNA lab report.

Hard rules:
- Do not give financial advice or price predictions.
- If ``empty_index`` is true, the wallet has **no** Four.Meme deploys in MemeLab — still write a full report using ``chain_snapshot`` (nonce, balance, first_tx_age_days, etc.) and explain what that implies (dormant deployer, new wallet, or simply off-index).
- Do not invent families, counts, dates, URLs, or handles; only use fields in the JSON.
- If ``social_signals.items`` is empty or weak, say the external narrative is unverified.
- Prefer concrete numbers: pull them from ``stats``, ``quality``, ``behavior``, ``trading``, \
``top_families``, ``token_extras``, ``family_activity``, ``social_signals.summary``.
- Output STRICT JSON with exactly these string keys: \
headline, summary (3-5 sentences), archetype_section, families_section, timeline_section, \
research_section (multi-paragraph: lifecycle quality + family narrative + peers if token), \
behavior_section (wallet only: cadence, streaks, time-of-day patterns; for tokens leave \
short: one sentence about its launch context), social_section (what the web/X evidence \
says and how reliable it is), share_blurb (max 280 chars).
- Plus array keys: key_insights (3-6 short bullets, each ≤ 140 chars), \
risk_flags (0-5 bullets), opportunity_flags (0-5 bullets). Bullets must be plain strings.
- Tone: analytical but accessible; the DNA / lab metaphor is allowed sparingly.
"""


async def compose_lab_report_narrative(facts: dict) -> tuple[dict, bool]:
    """Return (narrative dict, used_llm). Falls back to templates on any failure."""
    fallback = _template_narrative(facts)
    llm = get_llm()
    if not llm.enabled:
        return fallback, False
    user = orjson.dumps(facts, option=orjson.OPT_INDENT_2).decode()
    try:
        data = await llm.chat_json(_SYSTEM, user, temperature=0.3, max_output_tokens=2200)

        def _s(key: str) -> str:
            return str(data.get(key) or fallback.get(key) or "").strip()

        def _list(key: str, cap: int = 6, char_cap: int = 200) -> list[str]:
            raw = data.get(key)
            if not isinstance(raw, list):
                raw = fallback.get(key) or []
            out: list[str] = []
            for item in raw:
                s = str(item or "").strip()
                if s:
                    out.append(s[:char_cap])
                if len(out) >= cap:
                    break
            return out

        out = {
            "headline": _s("headline"),
            "summary": _s("summary"),
            "archetype_section": _s("archetype_section"),
            "families_section": _s("families_section"),
            "timeline_section": _s("timeline_section"),
            "research_section": _s("research_section"),
            "behavior_section": _s("behavior_section"),
            "social_section": _s("social_section"),
            "share_blurb": _s("share_blurb")[:280],
            "key_insights": _list("key_insights", cap=6, char_cap=180),
            "risk_flags": _list("risk_flags", cap=5, char_cap=180),
            "opportunity_flags": _list("opportunity_flags", cap=5, char_cap=180),
        }
        return out, True
    except Exception as exc:  # noqa: BLE001
        logger.warning("lab_report LLM narrative failed ({}), using template", exc.__class__.__name__)
        return fallback, False


def _research_section_template(facts: dict) -> str:
    lines: list[str] = []
    rt = facts.get("report_type")
    if rt == "token":
        tr = facts.get("trading") or {}
        if tr and any(tr.get(k) for k in ("volume_24h_usd", "liquidity_usd", "holders")):
            lines.append(
                "On-chain snapshot (indexed): "
                f"24h volume ${float(tr.get('volume_24h_usd') or 0):,.0f}, "
                f"liquidity ${float(tr.get('liquidity_usd') or 0):,.0f}, "
                f"holders {int(tr.get('holders') or 0):,}. "
                f"Market cap (indexed) ${float(tr.get('market_cap_usd') or 0):,.0f}."
            )
        fams = facts.get("top_families") or []
        if fams and fams[0].get("event_summary"):
            es = str(fams[0]["event_summary"])[:520]
            lines.append(
                f"DNA family narrative (MemeLab): {es}"
            )
        for f in fams[:2]:
            evo = f.get("evolution_score")
            tv = f.get("total_volume_usd")
            if evo is not None or tv is not None:
                lines.append(
                    f"Family «{str(f.get('title', ''))[:70]}»: "
                    f"evolution score {float(evo or 0):.2f}, "
                    f"cumulative volume (family) ${float(tv or 0):,.0f}."
                )
    else:
        st = facts.get("stats") or {}
        if facts.get("empty_index"):
            ch = facts.get("chain_snapshot") or {}
            bits: list[str] = []
            if ch.get("balance_bnb") is not None:
                bits.append(f"BNB balance (RPC) ~{float(ch['balance_bnb']):.6f} BNB.")
            if ch.get("nonce") is not None:
                bits.append(f"Outgoing transaction count (nonce) {int(ch['nonce']):,}.")
            if ch.get("is_smart_contract"):
                bits.append("Address holds contract bytecode (smart wallet or contract) — not a plain EOA.")
            if ch.get("first_tx_at_utc"):
                age = ch.get("first_tx_age_days")
                age_s = f" (~{int(age)} days on-chain)" if age is not None else ""
                bits.append(f"First seen on-chain activity: {ch['first_tx_at_utc'][:19]}{age_s}.")
            elif ch.get("explorer_outgoing_txs") == 0:
                bits.append("Explorer returned no normal outgoing txs — wallet may be unused or only receiving.")
            if bits:
                lines.append(" ".join(bits))
            else:
                lines.append(
                    "No MemeLab-indexed Four.Meme launches; limited chain snapshot in facts — see ``chain_snapshot``."
                )
        elif st.get("total_volume_24h_usd"):
            lines.append(
                "Wallet aggregate (indexed tokens): "
                f"combined 24h volume ~${float(st['total_volume_24h_usd']):,.0f}; "
                f"total liquidity ~${float(st.get('total_liquidity_usd') or 0):,.0f}; "
                f"max holders on any one token {int(st.get('max_holders_on_any_token') or 0):,}."
            )
        fams = facts.get("top_families") or []
        for f in fams[:3]:
            es = f.get("event_summary")
            if es:
                lines.append(
                    f"Family «{str(f.get('title', ''))[:70]}»: "
                    f"{str(es)[:300]}{'…' if len(str(es)) > 300 else ''}"
                )
    if not lines:
        return (
            "Extended MemeLab narratives (family event_summary) or live trading snapshots "
            "were not available for this scope."
        )
    return "\n\n".join(lines)


def _social_section_template(facts: dict) -> str:
    ss = facts.get("social_signals") or {}
    items = ss.get("items") or []
    if not items:
        return (
            "No third-party web or social hits were returned automatically for this query set. "
            "Treat on-chain labels as primary; verify any narrative manually."
        )
    lines: list[str] = []
    for it in items[:10]:
        title = str(it.get("title") or "Untitled")[:90]
        snip = str(it.get("snippet") or "")[:220]
        prov = str(it.get("provider") or "?")
        typ = str(it.get("type") or "link")
        lines.append(f"• [{typ} · {prov}] {title}\n  {snip}")
    qu = ss.get("queries") or []
    hdr = f"Queries: {'; '.join(str(q)[:80] for q in qu[:3])}. " if qu else ""
    chain = ss.get("provider_chain") or ""
    tail = f"\n(Search provider chain: {chain})" if chain else ""
    return hdr + "External mentions (deduped by URL):\n" + "\n".join(lines) + tail


def _template_narrative(facts: dict) -> dict:
    rt = facts.get("report_type", "wallet")
    addr = facts.get("address", "")[:10] + "…"
    if rt == "wallet":
        stats = facts.get("stats") or {}
        n_tok = int(stats.get("tokens_deployed") or 0)
        n_fam = int(stats.get("families_touched") or 0)
        ch = facts.get("chain_snapshot") or {}
        if facts.get("empty_index") or n_tok == 0:
            headline = f"Meme DNA lab report · wallet {addr} (no indexed Four.Meme deploys)"
            age = ch.get("first_tx_age_days")
            bal = ch.get("balance_bnb")
            nonce = ch.get("nonce")
            age_bit = (
                f" First on-chain activity seen ~{int(age)} days ago."
                if isinstance(age, (int, float))
                else ""
            )
            bal_bit = f" BNB balance ~{float(bal):.6f}." if isinstance(bal, (int, float)) else ""
            nonce_bit = (
                f" Nonce (outgoing txs index) {int(nonce)}." if nonce is not None else ""
            )
            summary = (
                "MemeLab does not yet index any Four.Meme token deployments from this wallet. "
                f"The report below uses live BNB Chain snapshot data only: {bal_bit}{nonce_bit}{age_bit} "
                "DNA family arcs, deploy cadence, and archetype mix apply once launches appear in the index."
            ).replace("  ", " ").strip()
        else:
            headline = f"Meme DNA lab report · wallet {addr}"
            summary = (
                f"This wallet has {n_tok} Four.Meme token(s) indexed in MemeLab, "
                f"spanning {n_fam} distinct DNA famil{'y' if n_fam == 1 else 'ies'} when clustered. "
                f"Below: keyword archetype mix, family narratives where available, indexed liquidity/volume "
                f"aggregates, and external web/social snippets (may be incomplete)."
            )
    else:
        sym = facts.get("token_symbol") or "TOKEN"
        headline = f"Meme DNA lab report · {sym}"
        summary = (
            "Single-token view: placement inside its DNA family, archetype signals from name/symbol, "
            "indexed trading snapshot, MemeLab family narrative when present, and external web/social "
            "mentions for context (not verified truth)."
        )
        fw = facts.get("family_window")
        if fw:
            summary = f"{summary} {fw}"

    arch = facts.get("archetype_counts") or {}
    arch_bits = [f"{k}: {v}" for k, v in sorted(arch.items(), key=lambda x: -x[1])[:10]]
    if facts.get("empty_index") or not arch_bits:
        archetype_section = (
            "No deploy names to cluster yet — archetype / keyword mix will populate after Four.Meme "
            "launches from this wallet are indexed."
            if facts.get("empty_index")
            else (
                "Archetype mix (keyword buckets from name/symbol): "
                + (
                    ", ".join(arch_bits)
                    if arch_bits
                    else "No strong archetype keyword hits; tokens read as generic meme launches."
                )
            )
        )
    else:
        archetype_section = (
            "Archetype mix (keyword buckets from name/symbol): " + ", ".join(arch_bits)
        )

    fams = facts.get("top_families") or []
    if fams:
        lines = []
        for f in fams[:8]:
            title = str(f.get("title", ""))[:90]
            yt = f.get("your_tokens", 0)
            mc = f.get("family_mutations_count", "?")
            conf = f.get("confidence")
            conf_s = f"{float(conf):.0%}" if conf is not None else "?"
            es = f.get("event_summary")
            block = (
                f"• {title} — {yt} of your token(s) in this family; "
                f"~{mc} mutations in family; confidence {conf_s}."
            )
            if es:
                block += f"\n  Summary: {str(es)[:280]}{'…' if len(str(es)) > 280 else ''}"
            lines.append(block)
        families_section = "Closest DNA family ties:\n" + "\n".join(lines)
    elif facts.get("empty_index"):
        families_section = (
            "No DNA family ties yet — MemeLab has not recorded any Four.Meme deployments from this address. "
            "If the wallet launches later, family narratives and mutation stats will appear here."
        )
    else:
        families_section = "No DNA family links recorded yet for this scope."

    tl = facts.get("timeline") or []
    if tl:
        lines2 = [
            f"• {t.get('date', '')[:10]} — {t.get('symbol', '')} ({t.get('name', '')[:40]})"
            for t in tl[:16]
        ]
        timeline_section = "Launch timeline (newest first):\n" + "\n".join(lines2)
    elif facts.get("empty_index"):
        timeline_section = (
            "No MemeLab deploy timeline yet. Optional first/last on-chain activity is summarized under research."
        )
    else:
        timeline_section = "No dated launches in this report window."

    research_section = _research_section_template(facts)
    social_section = _social_section_template(facts)
    behavior_section = _behavior_section_template(facts)
    key_insights = _key_insights_template(facts)
    risk_flags = list(facts.get("risk_flags") or [])
    opportunity_flags = list(facts.get("opportunity_flags") or [])

    share = f"{headline} | {summary[:200]}…" if len(summary) > 200 else f"{headline} | {summary}"
    share_blurb = share[:280]

    return {
        "headline": headline,
        "summary": summary,
        "archetype_section": archetype_section,
        "families_section": families_section,
        "timeline_section": timeline_section,
        "research_section": research_section,
        "behavior_section": behavior_section,
        "social_section": social_section,
        "share_blurb": share_blurb,
        "key_insights": key_insights,
        "risk_flags": risk_flags,
        "opportunity_flags": opportunity_flags,
    }


_DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _behavior_section_template(facts: dict) -> str:
    rt = facts.get("report_type")
    if rt == "wallet" and facts.get("empty_index"):
        ch = facts.get("chain_snapshot") or {}
        bits: list[str] = []
        if ch.get("nonce") is not None:
            bits.append(
                f"Outgoing transaction index (nonce) is {int(ch['nonce']):,} — no deploy cadence "
                "available until Four.Meme launches are indexed."
            )
        if ch.get("balance_bnb") is not None:
            bits.append(f"Native balance snapshot ~{float(ch['balance_bnb']):.6f} BNB.")
        if ch.get("is_smart_contract"):
            bits.append("Bytecode present at address — may be a smart wallet or contract; interpret nonce with care.")
        if ch.get("last_tx_at_utc"):
            bits.append(f"Most recent indexed normal tx (explorer): {str(ch['last_tx_at_utc'])[:19]} UTC.")
        return (
            " ".join(bits)
            if bits
            else "No deploy-behaviour pattern: MemeLab shows zero Four.Meme launches from this wallet."
        )
    if rt != "wallet":
        tl = facts.get("timeline") or []
        if tl:
            t0 = tl[0]
            return (
                f"Launched on {str(t0.get('date'))[:10]} as {t0.get('symbol')} — "
                "single-token view; no cadence pattern applies."
            )
        return "Single-token view; no deploy cadence to analyse."

    b = facts.get("behavior") or {}
    if not b:
        return "Not enough timestamps to describe deploy cadence."

    hh = b.get("hour_histogram") or [0] * 24
    dow = b.get("dow_histogram") or [0] * 7
    top_hour = max(range(24), key=lambda i: hh[i]) if any(hh) else None
    top_dow = max(range(7), key=lambda i: dow[i]) if any(dow) else None

    bits: list[str] = []
    bits.append(
        f"Deployed on {int(b.get('days_active') or 0)} distinct days over a "
        f"{int(b.get('span_days') or 0)}-day span "
        f"(avg {float(b.get('avg_deploys_per_active_day') or 0):.1f} per active day; "
        f"longest streak {int(b.get('longest_streak_days') or 0)} days)."
    )
    if top_hour is not None:
        bits.append(
            f"Peak launch hour (UTC): {top_hour:02d}:00 with {int(hh[top_hour])} deploys."
        )
    if top_dow is not None:
        bits.append(f"Most active weekday: {_DOW[top_dow]} ({int(dow[top_dow])} deploys).")

    q = facts.get("quality") or {}
    if q:
        bits.append(
            f"Quality: migration rate {float(q.get('migration_rate') or 0):.0%}, "
            f"{float(q.get('active_trade_rate') or 0):.0%} have indexed trades, "
            f"avg holders ~{float(q.get('avg_holders') or 0):.0f} on traded tokens."
        )
    return " ".join(bits)


def _key_insights_template(facts: dict) -> list[str]:
    out: list[str] = []
    rt = facts.get("report_type")
    stats = facts.get("stats") or {}
    if rt == "wallet":
        n = int(stats.get("tokens_deployed") or 0)
        nf = int(stats.get("families_touched") or 0)
        ch = facts.get("chain_snapshot") or {}
        if facts.get("empty_index"):
            out.append("MemeLab index: no Four.Meme deploys yet — narrative is chain-snapshot led.")
        if n:
            out.append(f"{n} indexed token deploys; {nf} distinct DNA famil{'y' if nf == 1 else 'ies'}.")
        if facts.get("empty_index") and ch.get("first_tx_age_days") is not None:
            out.append(
                f"On-chain age signal: first normal tx seen ~{int(ch['first_tx_age_days'])} days ago (BscScan, if configured)."
            )
        b = facts.get("behavior") or {}
        if b.get("longest_streak_days"):
            out.append(
                f"Longest active streak: {int(b['longest_streak_days'])} consecutive days of deploys."
            )
        q = facts.get("quality") or {}
        if q.get("migration_rate") is not None and n >= 2:
            out.append(
                f"Only {float(q['migration_rate']):.0%} of launches migrated (graduated) so far."
            )
        arch = facts.get("archetype_counts") or {}
        if arch:
            top = max(arch.items(), key=lambda x: x[1])
            out.append(f"Dominant archetype bucket: {top[0]} ({top[1]} tokens).")
    else:
        tr = facts.get("trading") or {}
        if tr:
            out.append(
                f"Trading snapshot: 24h volume ${float(tr.get('volume_24h_usd') or 0):,.0f}, "
                f"{int(tr.get('holders') or 0)} holders, liquidity ${float(tr.get('liquidity_usd') or 0):,.0f}."
            )
        fams = facts.get("top_families") or []
        if fams:
            f0 = fams[0]
            out.append(
                f"Closest DNA family: {str(f0.get('title', ''))[:70]} "
                f"(confidence {float(f0.get('confidence') or 0):.0%}, "
                f"{int(f0.get('family_mutations_count') or 0)} mutations)."
            )
        te = facts.get("token_extras") or {}
        roles = te.get("strain_roles") or {}
        role_tags = [k for k in ("is_origin", "is_dominant", "is_fastest") if roles.get(k)]
        if role_tags:
            nice = ", ".join(t.replace("is_", "") for t in role_tags)
            out.append(f"Strain roles within family: {nice}.")
        peers = te.get("peers") or []
        if peers:
            out.append(f"{len(peers)} peer tokens inside the same family (top shown in peers panel).")
    ss = (facts.get("social_signals") or {}).get("summary") or {}
    sent = ss.get("sentiment") or {}
    total = sum(sent.values()) if sent else 0
    if total >= 3:
        out.append(
            f"External coverage: {sent.get('positive', 0)} positive / "
            f"{sent.get('neutral', 0)} neutral / {sent.get('negative', 0)} negative mentions."
        )
    return out[:6]
