/**
 * Lab Report bubble map: prioritize non-obvious / forensic signals from facts
 * (chain snapshot, deploy rhythm, quality edge, strain DNA, peer roles, family
 * momentum, social tone) before generic index vocabulary.
 *
 * Not a Bubblemaps-style holder-topology graph — those require dedicated
 * transfer-graph infrastructure. See https://v2.bubblemaps.io for that class of map.
 */

import type { LabReportResponse } from "@/lib/types";

export type BubbleLayer = "intel" | "index";

export type BubbleKind =
  /** Live RPC / explorer wallet snapshot */
  | "forensic"
  /** Hour-of-day / DOW / streak / burst deploy cadence */
  | "rhythm"
  /** Migration, trade penetration, vol/liquidity tension, etc. */
  | "edge"
  /** Origin / dominant / fastest strain in DNA family */
  | "strain"
  /** Same-family peers tagged by strain role (not just ticker volume) */
  | "mesh"
  /** 7d vs prior-7d family mutation momentum */
  | "pulse"
  /** Aggregated web/social sentiment from research pipeline */
  | "signal"
  /** Legacy / index vocabulary */
  | "arch"
  | "family"
  | "peer"
  | "term"
  | "insight";

export type BubbleDatum = {
  id: string;
  kind: BubbleKind;
  label: string;
  weight: number;
  detail?: string;
  layer: BubbleLayer;
};

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function argMax(arr: number[]): number {
  if (!arr.length) return 0;
  let m = 0;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i]! > arr[m]!) m = i;
  }
  return m;
}

function truncLabel(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= n) return t;
  return `${t.slice(0, n - 1)}…`;
}

function push(
  out: BubbleDatum[],
  id: string,
  kind: BubbleKind,
  label: string,
  weight: number,
  detail?: string,
) {
  out.push({
    id,
    kind,
    label: truncLabel(label, 52),
    weight: Math.min(1, Math.max(0.08, weight)),
    detail,
    layer: "intel",
  });
}

function extractIntel(facts: Record<string, unknown>): BubbleDatum[] {
  const out: BubbleDatum[] = [];
  const rt = facts.report_type as string | undefined;

  const ch = facts.chain_snapshot as Record<string, unknown> | undefined;
  if (ch && ch.rpc_reachable === true) {
    if (typeof ch.nonce === "number" && ch.nonce >= 0) {
      push(
        out,
        "cs:nonce",
        "forensic",
        `EOA tx depth · nonce ${ch.nonce}`,
        0.55 + Math.min(0.35, ch.nonce / 400),
        "BSC pending nonce — rough upper bound on user txs initiated from this address.",
      );
    }
    if (typeof ch.balance_bnb === "number") {
      const bal = ch.balance_bnb as number;
      push(
        out,
        "cs:bal",
        "forensic",
        bal < 0.002 ? "Dust native balance · almost no BNB" : `Native float · ${bal} BNB`,
        bal < 0.002 ? 0.45 : 0.55,
        "Wallet BNB balance from live RPC (not exchange custody).",
      );
    }
    if (typeof ch.first_tx_age_days === "number") {
      const d = ch.first_tx_age_days as number;
      push(
        out,
        "cs:age",
        "forensic",
        `On-chain age · ${d}d since first seen tx`,
        0.4 + Math.min(0.45, d / 730),
        "First outgoing/visible tx age from explorer index when BSCSCAN_API_KEY is set.",
      );
    }
    if (ch.is_smart_contract === true) {
      push(
        out,
        "cs:code",
        "forensic",
        "Contract bytecode · not a plain EOA",
        0.72,
        "Address holds contract bytecode (proxy, multisig, or other).",
      );
    }
  }

  const b = facts.behavior as
    | {
        hour_histogram?: number[];
        dow_histogram?: number[];
        longest_streak_days?: number;
        avg_deploys_per_active_day?: number;
        days_active?: number;
        span_days?: number;
      }
    | undefined;

  if (b?.hour_histogram?.length === 24) {
    const hi = argMax(b.hour_histogram);
    const hv = b.hour_histogram[hi] ?? 0;
    if (hv > 0) {
      push(
        out,
        "bh:hour",
        "rhythm",
        `Deploy hour peak · ${hi}:00 UTC`,
        0.35 + Math.min(0.5, hv / Math.max(1, ...b.hour_histogram)),
        "When this wallet tends to ship tokens (UTC) — timezone tell for bot vs human cadence.",
      );
    }
  }
  if (b?.dow_histogram?.length === 7) {
    const di = argMax(b.dow_histogram);
    const dv = b.dow_histogram[di] ?? 0;
    if (dv > 0) {
      push(
        out,
        "bh:dow",
        "rhythm",
        `Weekday skew · ${DOW[di]}`,
        0.35 + Math.min(0.45, dv / Math.max(1, ...b.dow_histogram)),
        "MemeLab-inferred weekday concentration of deploys.",
      );
    }
  }
  if (typeof b?.longest_streak_days === "number" && (b.longest_streak_days ?? 0) >= 2) {
    push(
      out,
      "bh:streak",
      "rhythm",
      `Deploy streak · ${b.longest_streak_days} consecutive active days`,
      0.5 + Math.min(0.35, (b.longest_streak_days ?? 0) / 14),
      "Longest run of calendar days with ≥1 deploy — spray pattern signal.",
    );
  }
  if (typeof b?.avg_deploys_per_active_day === "number" && b.avg_deploys_per_active_day >= 1.25) {
    push(
      out,
      "bh:burst",
      "rhythm",
      `Burst cadence · ${b.avg_deploys_per_active_day.toFixed(1)} deploys/active day`,
      Math.min(1, b.avg_deploys_per_active_day / 6),
      "How hard the wallet batches launches on days it actually deploys.",
    );
  }
  if (typeof b?.days_active === "number" && typeof b?.span_days === "number" && b.span_days > 5) {
    const density = b.days_active! / b.span_days;
    if (density < 0.12) {
      push(
        out,
        "bh:sparse",
        "rhythm",
        `Sparse activity · active ${b.days_active}d over ${b.span_days}d span`,
        0.45,
        "Rare deploy windows vs long calendar span — sniper vs tourist.",
      );
    }
  }

  const q = facts.quality as
    | {
        migration_rate?: number;
        active_trade_rate?: number;
        sum_trades_24h?: number;
        avg_holders?: number;
      }
    | undefined;

  if (q && rt === "wallet") {
    if (typeof q.migration_rate === "number" && q.migration_rate > 0) {
      push(
        out,
        "q:migrate",
        "edge",
        `Graduation · ${(q.migration_rate * 100).toFixed(0)}% migrated`,
        0.4 + q.migration_rate * 0.55,
        "Share of launches that left Four.Meme curve — quality bar vs spam.",
      );
    }
    if (typeof q.active_trade_rate === "number") {
      const ar = q.active_trade_rate;
      push(
        out,
        "q:trade",
        "edge",
        ar < 0.35
          ? `Thin tape · only ${(ar * 100).toFixed(0)}% have indexed trades`
          : `Market reach · ${(ar * 100).toFixed(0)}% have DexScreener tape`,
        0.35 + (1 - ar) * 0.4,
        "Indexed trade coverage across wallet launches.",
      );
    }
    if (typeof q.sum_trades_24h === "number" && q.sum_trades_24h > 0) {
      push(
        out,
        "q:agg24",
        "edge",
        `Aggregate 24h swaps · ${q.sum_trades_24h.toLocaleString("en-US")} (indexed)`,
        0.5,
        "Sum of trades_24h across tokens — attention proxy.",
      );
    }
    if (typeof q.avg_holders === "number" && q.avg_holders > 0) {
      push(
        out,
        "q:holders",
        "edge",
        `Avg holders · ~${Math.round(q.avg_holders)} (tokens with trade row)`,
        Math.min(1, q.avg_holders / 5000),
        "Mean holder count where we have a row — rough crowd depth.",
      );
    }
  }

  const tr = facts.trading as
    | {
        volume_24h_usd?: number;
        liquidity_usd?: number;
        holders?: number;
        market_cap_usd?: number;
      }
    | undefined;

  if (tr && rt === "token") {
    const vol = Number(tr.volume_24h_usd ?? 0);
    const liq = Number(tr.liquidity_usd ?? 0);
    const h = Number(tr.holders ?? 0);
    const mcap = Number(tr.market_cap_usd ?? 0);
    if (liq > 50 && vol / liq > 6) {
      push(
        out,
        "tr:turn",
        "edge",
        `Vol/liquidity tension · ${(vol / liq).toFixed(1)}× turnover vs depth`,
        Math.min(1, 0.35 + (vol / liq) / 40),
        "High 24h volume relative to pool depth — attention may outsize the book.",
      );
    }
    if (h > 0 && mcap > 0 && mcap / h < 300) {
      push(
        out,
        "tr:thin",
        "edge",
        `Thin distribution · ~$${Math.round(mcap / h)} mcap/holder`,
        0.55,
        "Rough concentration proxy (not Bubblemaps holder graph).",
      );
    }
  }

  const te = facts.token_extras as
    | {
        strain_roles?: {
          is_origin?: boolean;
          is_dominant?: boolean;
          is_fastest?: boolean;
          note?: string;
        };
        peers?: Array<{
          symbol?: string;
          volume_24h_usd?: number;
          holders?: number;
          is_origin?: boolean;
          is_dominant?: boolean;
          is_fastest?: boolean;
        }>;
      }
    | undefined;

  const sr = te?.strain_roles;
  if (sr?.is_origin) {
    push(out, "sr:origin", "strain", "Strain role · origin (earliest family mutation)", 0.85, sr.note?.slice(0, 180));
  }
  if (sr?.is_dominant) {
    push(out, "sr:dom", "strain", "Strain role · dominant footprint in family", 0.82, sr.note?.slice(0, 180));
  }
  if (sr?.is_fastest) {
    push(out, "sr:fast", "strain", "Strain role · velocity leader in family", 0.8, sr.note?.slice(0, 180));
  }

  const peers = te?.peers || [];
  const maxPv = Math.max(1, ...peers.map((p) => Number(p.volume_24h_usd ?? 0)));
  for (let i = 0; i < Math.min(5, peers.length); i++) {
    const p = peers[i]!;
    const sym = String(p.symbol || "?").trim();
    const roles = [
      p.is_origin ? "origin" : "",
      p.is_dominant ? "dominant" : "",
      p.is_fastest ? "fast" : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const roleSuffix = roles ? ` · ${roles}` : "";
    push(
      out,
      `mesh:${sym}:${i}`,
      "mesh",
      `Family peer${roleSuffix} · ${sym}`,
      Math.max(0.2, Number(p.volume_24h_usd ?? 0) / maxPv),
      "Sibling token in same DNA family with MemeLab strain tags.",
    );
  }

  const fa = facts.family_activity as Array<{ mutations?: number }> | undefined;
  if (fa && fa.length >= 14) {
    const r7 = fa.slice(-7).reduce((s, x) => s + Number(x.mutations ?? 0), 0);
    const p7 = fa.slice(-14, -7).reduce((s, x) => s + Number(x.mutations ?? 0), 0);
    if (p7 > 0 && r7 / p7 >= 1.35) {
      push(
        out,
        "fa:surge",
        "pulse",
        `Family momentum · +${Math.round((r7 / p7 - 1) * 100)}% mutations vs prior 7d`,
        0.62,
        "From MemeLab family time series — not raw DEX trades.",
      );
    } else if (p7 > 0 && r7 < p7 * 0.65) {
      push(
        out,
        "fa:cool",
        "pulse",
        "Family cooldown · mutations down vs prior week",
        0.48,
        "Mutation pulse fading in the indexed family window.",
      );
    }
  }

  const soc = facts.social_signals as
    | {
        summary?: {
          sentiment?: { positive?: number; negative?: number; neutral?: number };
          providers?: string[];
        };
      }
    | undefined;
  const sum = soc?.summary;
  const sent = sum?.sentiment;
  if (sent) {
    const pos = Number(sent.positive ?? 0);
    const neg = Number(sent.negative ?? 0);
    const neu = Number(sent.neutral ?? 0);
    const t = pos + neg + neu;
    if (t >= 2) {
      const tone =
        pos >= neg && pos >= neu ? "bullish skew" : neg > pos ? "skeptical skew" : "mixed / neutral";
      push(
        out,
        "soc:tone",
        "signal",
        `Web research tone · ${tone} (${t} classified refs)`,
        0.4 + Math.min(0.4, t / 24),
        "Keyword classifier on crawled titles/snippets — not on-chain transfers.",
      );
    }
    const provs = sum?.providers;
    if (provs?.length) {
      push(
        out,
        "soc:prov",
        "signal",
        `Research providers · ${[...new Set(provs)].slice(0, 3).join(", ")}`,
        0.38,
        "Which web-search backends contributed hits for this report.",
      );
    }
  }

  return out;
}

function buildIndexFallback(facts: Record<string, unknown>): BubbleDatum[] {
  const out: BubbleDatum[] = [];
  const rt = facts.report_type as string | undefined;

  const viz = facts.viz as { archetypes?: { label: string; value: number }[] } | undefined;
  const ac = facts.archetype_counts as Record<string, number> | undefined;
  let arch: { label: string; value: number }[] = [];
  if (viz?.archetypes?.length) arch = viz.archetypes.slice(0, 4);
  else if (ac) {
    arch = Object.entries(ac)
      .map(([label, value]) => ({ label, value: Number(value) || 0 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 4);
  }
  const maxA = Math.max(1, ...arch.map((a) => a.value));
  for (const a of arch) {
    out.push({
      id: `ix:a:${a.label}`,
      kind: "arch",
      label: truncLabel(a.label, 20),
      weight: maxA > 0 ? a.value / maxA : 0.5,
      layer: "index",
    });
  }

  type Fam = { title?: string; your_tokens?: number; family_mutations_count?: number };
  const fams = ((facts.top_families as Fam[]) || []).slice(0, 3);
  const famWeights = fams.map((f) =>
    rt === "token"
      ? Math.max(1, Number(f.family_mutations_count ?? 0))
      : Math.max(1, Number(f.your_tokens ?? 0)),
  );
  const maxF = Math.max(1, ...famWeights);
  fams.forEach((f, i) => {
    out.push({
      id: `ix:f:${f.title ?? i}`,
      kind: "family",
      label: truncLabel(String(f.title || "DNA family"), 22),
      weight: famWeights[i]! / maxF,
      detail: "Indexed family titles (everyone sees these).",
      layer: "index",
    });
  });

  const terms = (facts.name_signals as { term: string; weight: number }[]) || [];
  const maxT = Math.max(1, ...terms.map((t) => t.weight));
  for (const t of terms.slice(0, 4)) {
    out.push({
      id: `ix:n:${t.term}`,
      kind: "term",
      label: truncLabel(t.term, 16),
      weight: t.weight / maxT,
      detail: "Token name vocabulary weighting.",
      layer: "index",
    });
  }

  return out;
}

/** Combine intel-first nodes with a thin index fallback; cap total size. */
export function buildMergedBubbleData(report: LabReportResponse, maxNodes = 20): BubbleDatum[] {
  const intel = extractIntel(report.facts as Record<string, unknown>);
  const seen = new Set(intel.map((x) => x.id));
  const index = buildIndexFallback(report.facts as Record<string, unknown>).filter((x) => !seen.has(x.id));

  const merged = [...intel, ...index];
  if (merged.length < 3) {
    const kis = report.narrative.key_insights || [];
    const maxI = kis.length;
    for (let i = 0; i < Math.min(5, kis.length) && merged.length < maxNodes; i++) {
      const id = `fb:ki:${i}`;
      if (seen.has(id)) continue;
      merged.push({
        id,
        kind: "insight",
        label: truncLabel(kis[i]!, 48),
        weight: (maxI - i) / Math.max(1, maxI),
        layer: "intel",
        detail: "AI narrative bullet — same composer run as the written report.",
      });
      seen.add(id);
    }
  }

  return merged.slice(0, maxNodes);
}
