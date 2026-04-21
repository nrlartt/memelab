"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useId, useMemo } from "react";
import type { LabReportResponse } from "@/lib/types";
import {
  buildMergedBubbleData,
  type BubbleDatum,
} from "@/lib/lab-report-bubble-intel";

type ArchetypeRow = { label: string; value: number };

function pickArchetypes(facts: Record<string, unknown>): ArchetypeRow[] {
  const viz = facts.viz as { archetypes?: ArchetypeRow[] } | undefined;
  if (viz?.archetypes?.length) return viz.archetypes;
  const ac = facts.archetype_counts as Record<string, number> | undefined;
  if (!ac) return [];
  return Object.entries(ac)
    .map(([label, value]) => ({ label, value: Number(value) || 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 14);
}

function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

export function LabReportTradingSnapshot({ facts }: { facts: Record<string, unknown> }) {
  const rt = facts.report_type as string | undefined;
  if (rt === "token") {
    const tr = facts.trading as Record<string, number> | undefined;
    const hasNums =
      tr &&
      Object.keys(tr).length > 0 &&
      (Number(tr.volume_24h_usd ?? 0) > 0 ||
        Number(tr.liquidity_usd ?? 0) > 0 ||
        Number(tr.holders ?? 0) > 0 ||
        Number(tr.market_cap_usd ?? 0) > 0);
    if (!hasNums) {
      return (
        <div className="mt-6 rounded-2xl border border-dashed border-white/15 bg-black/20 p-4 print:border-neutral-300 print:bg-white">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-400)] print:text-neutral-700">
            Trading snapshot
          </p>
          <p className="mt-2 text-sm text-[var(--color-ink-300)] print:text-neutral-700">
            Token is indexed, but there is no DexScreener / trade row yet (volume, liquidity, holders
            are zero or not fetched). Charts below still use on-chain timing and family data.
          </p>
        </div>
      );
    }
    const cells = [
      { k: "24h volume", v: formatUsd(tr!.volume_24h_usd ?? 0) },
      { k: "Liquidity", v: formatUsd(tr!.liquidity_usd ?? 0) },
      { k: "Holders", v: String(tr!.holders ?? 0) },
      { k: "Mkt cap (idx)", v: formatUsd(tr!.market_cap_usd ?? 0) },
    ];
    return (
      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        {cells.map((c) => (
          <div
            key={c.k}
            className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 print:border-neutral-300 print:bg-white"
          >
            <p className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-ink-500)] print:text-neutral-600">
              {c.k}
            </p>
            <p className="mt-1 font-mono text-lg text-white print:text-black">{c.v}</p>
          </div>
        ))}
      </div>
    );
  }
  const st = facts.stats as Record<string, unknown> | undefined;
  if (!st) return null;
  const vol = Number(st.total_volume_24h_usd ?? 0);
  const liq = Number(st.total_liquidity_usd ?? 0);
  const mh = Number(st.max_holders_on_any_token ?? 0);
  if (!vol && !liq && !mh) return null;
  const cells = [
    { k: "Σ 24h volume", v: formatUsd(vol) },
    { k: "Σ liquidity", v: formatUsd(liq) },
    { k: "Max holders (one token)", v: String(mh) },
  ];
  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-3">
      {cells.map((c) => (
        <div
          key={c.k}
          className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 print:border-neutral-300 print:bg-white"
        >
          <p className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-ink-500)] print:text-neutral-600">
            {c.k}
          </p>
          <p className="mt-1 font-mono text-lg text-white print:text-black">{c.v}</p>
        </div>
      ))}
    </div>
  );
}

export function LabReportArchetypeBars({ facts }: { facts: Record<string, unknown> }) {
  const rows = pickArchetypes(facts);
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="mt-6 space-y-2">
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-400)] print:text-neutral-700">
        Archetype distribution
      </h4>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3 text-xs">
            <span className="w-28 shrink-0 truncate font-mono text-[var(--color-ink-300)] print:text-neutral-800">
              {r.label}
            </span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10 print:bg-neutral-200">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[var(--color-helix-a)] to-[var(--color-helix-c)] print:bg-neutral-800"
                style={{ width: `${(r.value / max) * 100}%` }}
              />
            </div>
            <span className="w-8 text-right font-mono text-[var(--color-ink-200)] print:text-neutral-900">
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

type TlRow = { date: string; symbol: string; name: string };

export function LabReportTimelineRail({ facts }: { facts: Record<string, unknown> }) {
  const tl = (facts.timeline as TlRow[]) || [];
  if (!tl.length) return null;
  const show = tl.slice(0, 18);
  return (
    <div className="mt-6">
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-400)] print:text-neutral-700">
        Launch rail
      </h4>
      <div className="relative mt-4 border-l border-white/20 pl-4 print:border-neutral-400">
        {show.map((t, i) => (
          <div key={`${t.date}-${t.symbol}-${i}`} className="relative pb-6 last:pb-0">
            <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--color-helix-a)] bg-[var(--color-ink-950)] print:border-neutral-700 print:bg-white" />
            <p className="font-mono text-[11px] text-[var(--color-helix-a)] print:text-neutral-900">
              {t.date?.slice(0, 10)}
            </p>
            <p className="text-sm text-[var(--color-ink-200)] print:text-neutral-900">
              <span className="font-medium text-white print:text-black">{t.symbol}</span>{" "}
              <span className="text-[var(--color-ink-400)] print:text-neutral-600">
                {(t.name || "").slice(0, 56)}
              </span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

type FamRow = {
  title?: string;
  confidence?: number;
  evolution_score?: number;
};

export function LabReportFamilyMetrics({ facts }: { facts: Record<string, unknown> }) {
  const fams = (facts.top_families as FamRow[]) || [];
  if (!fams.length) return null;
  const slice = fams.slice(0, 6);
  const evoVals = slice.map((f) =>
    typeof f.evolution_score === "number" ? Number(f.evolution_score) : 0,
  );
  const maxEvo = Math.max(1, ...evoVals);
  return (
    <div className="mt-6 space-y-3">
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-400)] print:text-neutral-700">
        Family confidence & evolution
      </h4>
      {slice.map((f, i) => {
        const conf = typeof f.confidence === "number" ? Number(f.confidence) : 0;
        const evo = typeof f.evolution_score === "number" ? Number(f.evolution_score) : 0;
        const cPct = Math.min(100, Math.max(0, conf * 100));
        const ePct = Math.min(100, Math.max(0, (evo / maxEvo) * 100));
        return (
          <div key={`${f.title ?? i}`} className="rounded-xl border border-white/10 bg-black/20 p-3 print:border-neutral-300 print:bg-white">
            <p className="text-xs font-medium text-white print:text-black">{(f.title || "").slice(0, 80)}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <p className="text-[10px] text-[var(--color-ink-500)] print:text-neutral-600">
                  Confidence {(conf * 100).toFixed(0)}%
                </p>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10 print:bg-neutral-200">
                  <div
                    className="h-full rounded-full bg-[var(--color-helix-b)] print:bg-neutral-800"
                    style={{ width: `${cPct}%` }}
                  />
                </div>
              </div>
              <div>
                <p className="text-[10px] text-[var(--color-ink-500)] print:text-neutral-600">
                  Evolution score {evo.toFixed(1)}
                </p>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10 print:bg-neutral-200">
                  <div
                    className="h-full rounded-full bg-[var(--color-helix-c)] print:bg-neutral-800"
                    style={{ width: `${ePct}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

type SocialItem = {
  title?: string;
  url?: string;
  snippet?: string;
  type?: string;
  provider?: string;
  author_handle?: string;
};

export function LabReportSocialCards({ facts }: { facts: Record<string, unknown> }) {
  const ss = facts.social_signals as { items?: SocialItem[]; queries?: string[] } | undefined;
  const items = ss?.items || [];
  if (!items.length) return null;
  return (
    <div className="mt-6 space-y-3">
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-400)] print:text-neutral-700">
        External references
      </h4>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.slice(0, 10).map((it, i) => (
          <a
            key={`${it.url}-${i}`}
            href={it.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-xl border border-white/10 bg-black/25 p-4 transition-colors hover:border-[var(--color-helix-a)]/40 print:border-neutral-300 print:bg-white"
          >
            <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-500)] print:text-neutral-600">
              {it.type} · {it.provider}
              {it.author_handle ? ` · @${it.author_handle}` : ""}
            </p>
            <p className="mt-1 text-sm font-medium text-white print:text-black">{(it.title || "").slice(0, 120)}</p>
            {it.snippet && (
              <p className="mt-2 line-clamp-2 text-xs text-[var(--color-ink-300)] print:text-neutral-700">
                {it.snippet}
              </p>
            )}
            <p className="mt-2 truncate font-mono text-[10px] text-[var(--color-helix-a)] print:text-neutral-800">
              {it.url}
            </p>
          </a>
        ))}
      </div>
    </div>
  );
}

// ----------------------------- Behaviour heatmap & sparkline

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function LabReportDeployHeatmap({ facts }: { facts: Record<string, unknown> }) {
  const b = facts.behavior as
    | { hour_histogram?: number[]; dow_histogram?: number[] }
    | undefined;
  const hours = b?.hour_histogram || [];
  const dows = b?.dow_histogram || [];
  if (!hours.some((v) => v) && !dows.some((v) => v)) return null;
  const maxH = Math.max(1, ...hours);
  const maxD = Math.max(1, ...dows);
  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2">
      <div className="rounded-2xl border border-white/10 bg-black/20 p-4 print:border-neutral-300 print:bg-white">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-400)] print:text-neutral-700">
          Launch hour-of-day (UTC)
        </p>
        <div className="mt-3 flex items-end gap-[3px] h-20">
          {hours.map((v, i) => (
            <div
              key={i}
              title={`${String(i).padStart(2, "0")}:00 · ${v} deploys`}
              className="flex-1 rounded-sm bg-gradient-to-t from-[var(--color-helix-a)]/30 to-[var(--color-helix-a)] print:from-neutral-300 print:to-neutral-700"
              style={{ height: `${Math.max(4, (v / maxH) * 100)}%`, opacity: v ? 1 : 0.25 }}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between font-mono text-[9px] text-[var(--color-ink-500)] print:text-neutral-600">
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>23</span>
        </div>
      </div>
      <div className="rounded-2xl border border-white/10 bg-black/20 p-4 print:border-neutral-300 print:bg-white">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-400)] print:text-neutral-700">
          Launch day-of-week
        </p>
        <div className="mt-3 space-y-1.5">
          {dows.map((v, i) => (
            <div key={i} className="flex items-center gap-3 text-xs">
              <span className="w-8 font-mono text-[var(--color-ink-400)] print:text-neutral-700">{DOW[i]}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10 print:bg-neutral-200">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[var(--color-helix-b)] to-[var(--color-helix-c)] print:bg-neutral-700"
                  style={{ width: `${(v / maxD) * 100}%` }}
                />
              </div>
              <span className="w-6 text-right font-mono text-[var(--color-ink-200)] print:text-neutral-900">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type DailyRow = { date: string; count: number };

export function LabReportDeploySparkline({ facts }: { facts: Record<string, unknown> }) {
  const b = facts.behavior as { daily_last_30?: DailyRow[] } | undefined;
  const rows = b?.daily_last_30 || [];
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((r) => r.count));
  const w = 600;
  const h = 80;
  const step = w / (rows.length - 1 || 1);
  const pts = rows
    .map((r, i) => `${i * step},${h - (r.count / max) * (h - 6) - 3}`)
    .join(" ");
  const area = `0,${h} ${pts} ${w},${h}`;
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 print:border-neutral-300 print:bg-white">
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-400)] print:text-neutral-700">
          Daily deploys · last 30 days
        </p>
        <span className="font-mono text-[10px] text-[var(--color-ink-400)] print:text-neutral-600">
          Σ {total}
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 h-20 w-full" preserveAspectRatio="none">
        <polygon points={area} fill="url(#sparkArea)" opacity="0.6" />
        <polyline points={pts} fill="none" stroke="var(--color-helix-a)" strokeWidth="1.6" />
        <defs>
          <linearGradient id="sparkArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-helix-a)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--color-helix-a)" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

// ----------------------------- Quality stat strip

export function LabReportQualityStats({ facts }: { facts: Record<string, unknown> }) {
  const q = facts.quality as Record<string, number> | undefined;
  if (!q || !Object.keys(q).length) return null;
  const cells = [
    { k: "Migration rate", v: `${((q.migration_rate ?? 0) * 100).toFixed(0)}%` },
    { k: "Active trade rate", v: `${((q.active_trade_rate ?? 0) * 100).toFixed(0)}%` },
    { k: "Avg holders", v: String(Math.round(q.avg_holders ?? 0)) },
    { k: "Avg 24h vol", v: formatUsd(q.avg_volume_24h_usd ?? 0) },
    { k: "Avg liquidity", v: formatUsd(q.avg_liquidity_usd ?? 0) },
    { k: "Σ market cap", v: formatUsd(q.sum_market_cap_usd ?? 0) },
  ];
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {cells.map((c) => (
        <div
          key={c.k}
          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 print:border-neutral-300 print:bg-white"
        >
          <p className="text-[9px] uppercase tracking-[0.15em] text-[var(--color-ink-500)] print:text-neutral-600">
            {c.k}
          </p>
          <p className="mt-0.5 font-mono text-sm text-white print:text-black">{c.v}</p>
        </div>
      ))}
    </div>
  );
}

// ----------------------------- Family activity mini chart

type FamActivityRow = { date: string; mutations: number; volume_usd: number };

export function LabReportFamilyActivity({ facts }: { facts: Record<string, unknown> }) {
  const rows = (facts.family_activity as FamActivityRow[]) || [];
  if (!rows.length || !rows.some((r) => r.mutations || r.volume_usd)) return null;
  const maxM = Math.max(1, ...rows.map((r) => r.mutations));
  const maxV = Math.max(1, ...rows.map((r) => r.volume_usd));
  const w = 600;
  const h = 90;
  const step = w / (rows.length - 1 || 1);
  const volPts = rows
    .map((r, i) => `${i * step},${h - (r.volume_usd / maxV) * (h - 10) - 4}`)
    .join(" ");
  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4 print:border-neutral-300 print:bg-white">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-400)] print:text-neutral-700">
        Family activity · last 30 days (bars = mutations, line = volume)
      </p>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 h-24 w-full" preserveAspectRatio="none">
        {rows.map((r, i) => {
          const bh = (r.mutations / maxM) * (h - 10);
          return (
            <rect
              key={i}
              x={i * step - 2}
              y={h - bh - 2}
              width={Math.max(2, step - 1)}
              height={Math.max(0, bh)}
              fill="var(--color-helix-c)"
              opacity={r.mutations ? 0.75 : 0.15}
            />
          );
        })}
        <polyline points={volPts} fill="none" stroke="var(--color-helix-a)" strokeWidth="1.6" />
      </svg>
      <div className="mt-2 flex justify-between font-mono text-[9px] text-[var(--color-ink-500)] print:text-neutral-600">
        <span>{rows[0]?.date}</span>
        <span>{rows[rows.length - 1]?.date}</span>
      </div>
    </div>
  );
}

// ----------------------------- Social summary (donut + sentiment + engagement)

type Bucket = { label: string; value: number };

function Donut({ rows, size = 96 }: { rows: Bucket[]; size?: number }) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (!total) return null;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 6;
  let acc = 0;
  const palette = [
    "var(--color-helix-a)",
    "var(--color-helix-b)",
    "var(--color-helix-c)",
    "#9ca3af",
    "#f59e0b",
    "#ef4444",
    "#10b981",
  ];
  const segs = rows.map((row, i) => {
    const start = (acc / total) * 2 * Math.PI - Math.PI / 2;
    acc += row.value;
    const end = (acc / total) * 2 * Math.PI - Math.PI / 2;
    const large = end - start > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
    return <path key={i} d={d} fill={palette[i % palette.length]} opacity={0.85} />;
  });
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      {segs}
      <circle cx={cx} cy={cy} r={r * 0.55} fill="var(--color-ink-900)" />
    </svg>
  );
}

export function LabReportSocialSummary({ facts }: { facts: Record<string, unknown> }) {
  const ss = facts.social_signals as
    | {
        summary?: {
          types?: Bucket[];
          providers?: Bucket[];
          sentiment?: { positive: number; neutral: number; negative: number };
          engagement?: { tweets: number; likes: number; retweets: number; views: number };
          top_authors?: { handle: string; count: number }[];
        };
        items?: unknown[];
      }
    | undefined;
  const s = ss?.summary;
  if (!s || !(ss?.items?.length || 0)) return null;
  const types = s.types || [];
  const providers = s.providers || [];
  const sent = s.sentiment || { positive: 0, neutral: 0, negative: 0 };
  const sentTotal = sent.positive + sent.neutral + sent.negative;
  const eng = s.engagement || { tweets: 0, likes: 0, retweets: 0, views: 0 };
  const authors = s.top_authors || [];
  const palette = [
    "var(--color-helix-a)",
    "var(--color-helix-b)",
    "var(--color-helix-c)",
    "#9ca3af",
    "#f59e0b",
  ];

  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-3">
      <div className="rounded-2xl border border-white/10 bg-black/20 p-4 print:border-neutral-300 print:bg-white">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-400)] print:text-neutral-700">
          Source types
        </p>
        <div className="mt-3 flex items-center gap-4">
          <Donut rows={types} />
          <ul className="space-y-1 text-xs">
            {types.slice(0, 5).map((t, i) => (
              <li key={t.label} className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-sm"
                  style={{ background: palette[i % palette.length] }}
                />
                <span className="text-[var(--color-ink-200)] print:text-neutral-800">
                  {t.label} · {t.value}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/20 p-4 print:border-neutral-300 print:bg-white">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-400)] print:text-neutral-700">
          Sentiment (keyword heuristic)
        </p>
        {sentTotal ? (
          <div className="mt-3 space-y-2">
            {(
              [
                { k: "positive", v: sent.positive, cls: "bg-[var(--color-good)]" },
                { k: "neutral", v: sent.neutral, cls: "bg-white/30" },
                { k: "negative", v: sent.negative, cls: "bg-[var(--color-bad)]" },
              ] as const
            ).map((row) => (
              <div key={row.k} className="flex items-center gap-3 text-xs">
                <span className="w-16 text-[var(--color-ink-300)] print:text-neutral-700">{row.k}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10 print:bg-neutral-200">
                  <div
                    className={`h-full rounded-full ${row.cls} print:bg-neutral-700`}
                    style={{ width: `${(row.v / sentTotal) * 100}%` }}
                  />
                </div>
                <span className="w-6 text-right font-mono text-[var(--color-ink-200)] print:text-neutral-900">
                  {row.v}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-[var(--color-ink-400)] print:text-neutral-700">
            Not enough snippets to classify.
          </p>
        )}
        <p className="mt-3 text-[10px] italic text-[var(--color-ink-500)] print:text-neutral-600">
          Heuristic from bull/bear keywords, not a full NLP model.
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/20 p-4 print:border-neutral-300 print:bg-white">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-400)] print:text-neutral-700">
          X engagement · top voices
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="text-[var(--color-ink-300)] print:text-neutral-700">
            Tweets <span className="ml-1 font-mono text-white print:text-black">{eng.tweets}</span>
          </div>
          <div className="text-[var(--color-ink-300)] print:text-neutral-700">
            Likes <span className="ml-1 font-mono text-white print:text-black">{eng.likes}</span>
          </div>
          <div className="text-[var(--color-ink-300)] print:text-neutral-700">
            Retweets <span className="ml-1 font-mono text-white print:text-black">{eng.retweets}</span>
          </div>
          <div className="text-[var(--color-ink-300)] print:text-neutral-700">
            Views <span className="ml-1 font-mono text-white print:text-black">{eng.views}</span>
          </div>
        </div>
        {authors.length ? (
          <ul className="mt-3 space-y-1 text-xs">
            {authors.slice(0, 4).map((a) => (
              <li key={a.handle} className="flex items-center justify-between">
                <span className="truncate text-[var(--color-helix-a)] print:text-neutral-800">@{a.handle}</span>
                <span className="font-mono text-[var(--color-ink-300)] print:text-neutral-700">×{a.count}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {providers.length ? (
          <p className="mt-3 truncate font-mono text-[10px] text-[var(--color-ink-500)] print:text-neutral-600">
            providers: {providers.map((p) => `${p.label}:${p.value}`).join(" · ")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ----------------------------- Peer token table

type Peer = {
  address: string;
  symbol: string;
  name: string;
  created_at: string;
  volume_24h_usd: number;
  holders: number;
  liquidity_usd: number;
  is_origin: boolean;
  is_dominant: boolean;
  is_fastest: boolean;
};

export function LabReportPeerTokens({ facts }: { facts: Record<string, unknown> }) {
  const te = facts.token_extras as { peers?: Peer[] } | undefined;
  const peers = te?.peers || [];
  if (!peers.length) return null;
  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4 print:border-neutral-300 print:bg-white">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-400)] print:text-neutral-700">
        Peer tokens in the same DNA family
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-ink-500)] print:text-neutral-600">
              <th className="py-1 text-left font-medium">Symbol</th>
              <th className="py-1 text-left font-medium">Name</th>
              <th className="py-1 text-right font-medium">24h vol</th>
              <th className="py-1 text-right font-medium">Liq.</th>
              <th className="py-1 text-right font-medium">Holders</th>
              <th className="py-1 text-left font-medium">Role</th>
            </tr>
          </thead>
          <tbody>
            {peers.map((p) => {
              const roles: string[] = [];
              if (p.is_origin) roles.push("origin");
              if (p.is_dominant) roles.push("dominant");
              if (p.is_fastest) roles.push("fastest");
              return (
                <tr key={p.address} className="border-t border-white/5 print:border-neutral-200">
                  <td className="py-1.5 font-mono text-white print:text-black">{p.symbol}</td>
                  <td className="py-1.5 text-[var(--color-ink-300)] print:text-neutral-700">
                    {(p.name || "").slice(0, 32)}
                  </td>
                  <td className="py-1.5 text-right font-mono text-[var(--color-ink-200)] print:text-neutral-900">
                    {formatUsd(p.volume_24h_usd)}
                  </td>
                  <td className="py-1.5 text-right font-mono text-[var(--color-ink-200)] print:text-neutral-900">
                    {formatUsd(p.liquidity_usd)}
                  </td>
                  <td className="py-1.5 text-right font-mono text-[var(--color-ink-200)] print:text-neutral-900">
                    {p.holders}
                  </td>
                  <td className="py-1.5 text-[var(--color-helix-a)] print:text-neutral-800">
                    {roles.join(" · ") || "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ----------------------------- Name signals (weighted pills)

export function LabReportNameSignals({ facts }: { facts: Record<string, unknown> }) {
  const sig = (facts.name_signals as { term: string; weight: number }[]) || [];
  if (!sig.length) return null;
  const max = Math.max(1, ...sig.map((s) => s.weight));
  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4 print:border-neutral-300 print:bg-white">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-400)] print:text-neutral-700">
        Name / symbol vocabulary
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {sig.slice(0, 20).map((s) => {
          const scale = 0.8 + (s.weight / max) * 0.9;
          return (
            <span
              key={s.term}
              className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 font-mono text-white print:border-neutral-300 print:bg-white print:text-black"
              style={{ fontSize: `${scale * 0.75}rem` }}
              title={`weight ${s.weight}`}
            >
              {s.term}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ----------------------------- Insight / risk / opportunity chips

export function LabReportInsightBoard({
  insights,
  risks,
  opportunities,
}: {
  insights?: string[];
  risks?: string[];
  opportunities?: string[];
}) {
  const has = (insights?.length || 0) + (risks?.length || 0) + (opportunities?.length || 0);
  if (!has) return null;
  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-3">
      {insights?.length ? (
        <div className="rounded-2xl border border-[var(--color-helix-a)]/30 bg-[var(--color-helix-a)]/5 p-4 print:border-neutral-300 print:bg-white">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-helix-a)] print:text-neutral-700">
            Key insights
          </p>
          <ul className="mt-2 space-y-1.5 text-xs text-[var(--color-ink-200)] print:text-neutral-800">
            {insights.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-[var(--color-helix-a)]">▸</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {risks?.length ? (
        <div className="rounded-2xl border border-[var(--color-bad)]/30 bg-[var(--color-bad)]/5 p-4 print:border-neutral-300 print:bg-white">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-bad)] print:text-neutral-700">
            Risk flags
          </p>
          <ul className="mt-2 space-y-1.5 text-xs text-[var(--color-ink-200)] print:text-neutral-800">
            {risks.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-[var(--color-bad)]">!</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {opportunities?.length ? (
        <div className="rounded-2xl border border-[var(--color-good)]/30 bg-[var(--color-good)]/5 p-4 print:border-neutral-300 print:bg-white">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-good)] print:text-neutral-700">
            Opportunity flags
          </p>
          <ul className="mt-2 space-y-1.5 text-xs text-[var(--color-ink-200)] print:text-neutral-800">
            {opportunities.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-[var(--color-good)]">+</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ----------------------------- Extra visualisations
//
// These build on data already present in `facts` without any backend
// change: archetype_counts, top_families, timeline, trading, behavior,
// family_activity. They render as SVG so Print / PDF export stays crisp.

// ----------------------------- AI relation bubble map (force-ish layout, no extra deps)

function seedFromAddr(addr: string): number {
  let h = 2166136261;
  for (let i = 0; i < addr.length; i++) {
    h ^= addr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

type PlacedBubble = BubbleDatum & { x: number; y: number; r: number };

function layoutBubbles(
  nodes: BubbleDatum[],
  W: number,
  H: number,
  seed: number,
): PlacedBubble[] {
  if (nodes.length === 0) return [];

  let state = seed;
  const rnd = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };

  const radii = nodes.map((n) => {
    const w = Math.min(1, Math.max(0.05, n.weight));
    const base = 10 + 32 * Math.sqrt(w);
    const intelBoost = n.layer === "intel" ? 1.14 : 0.92;
    return base * intelBoost;
  });
  const n = nodes.length;
  const cx = W / 2;
  const cy = H / 2;
  const ring = Math.min(W, H) * 0.22 + rnd() * 18;

  const pos = nodes.map((_, i) => {
    const t = rnd() * Math.PI * 2 + i * 1.7;
    const j = i + rnd() * 0.4;
    return {
      x: cx + Math.cos(t + j * 0.15) * (ring + (i % 3) * 12),
      y: cy + Math.sin(t + j * 0.15) * (ring + (i % 3) * 12),
    };
  });

  for (let iter = 0; iter < 62; iter++) {
    for (let i = 0; i < n; i++) {
      let fx = 0;
      let fy = 0;
      fx += (cx - pos[i]!.x) * 0.04;
      fy += (cy - pos[i]!.y) * 0.04;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dx = pos[i]!.x - pos[j]!.x;
        const dy = pos[i]!.y - pos[j]!.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const need = radii[i]! + radii[j]! + 6;
        if (dist < need) {
          const push = (need - dist) * 0.65;
          fx += (dx / dist) * push;
          fy += (dy / dist) * push;
        }
      }
      pos[i]!.x += fx;
      pos[i]!.y += fy;
      const margin = radii[i]! + 10;
      pos[i]!.x = Math.max(margin, Math.min(W - margin, pos[i]!.x));
      pos[i]!.y = Math.max(margin, Math.min(H - margin, pos[i]!.y));
    }
  }

  return nodes.map((node, i) => ({
    ...node,
    x: pos[i]!.x,
    y: pos[i]!.y,
    r: radii[i]!,
  }));
}

function bubbleFill(kind: BubbleDatum["kind"], uid: string): string {
  switch (kind) {
    case "forensic":
      return `url(#bmForensic-${uid})`;
    case "rhythm":
      return `url(#bmRhythm-${uid})`;
    case "edge":
      return `url(#bmEdge-${uid})`;
    case "strain":
      return `url(#bmStrain-${uid})`;
    case "mesh":
      return `url(#bmMesh-${uid})`;
    case "pulse":
      return `url(#bmPulse-${uid})`;
    case "signal":
      return `url(#bmSignal-${uid})`;
    case "arch":
      return `url(#bmArch-${uid})`;
    case "family":
      return `url(#bmFam-${uid})`;
    case "peer":
      return `url(#bmPeer-${uid})`;
    case "term":
      return `url(#bmTerm-${uid})`;
    case "insight":
      return `url(#bmInsight-${uid})`;
    default:
      return "var(--color-helix-a)";
  }
}

/** Packed bubble view of archetypes, DNA families, peers, and (when sparse) AI insight chips — mirrors facts backing the narrative. */
export function LabReportAIBubbleMap({ report }: { report: LabReportResponse }) {
  const reduceMotion = useReducedMotion();
  const rawId = useId();
  const uid = rawId.replace(/:/g, "");
  const data = useMemo(() => buildMergedBubbleData(report), [report]);
  const W = 560;
  const H = 340;
  const seed = useMemo(
    () => seedFromAddr(`${report.address}-${report.generated_at}`),
    [report.address, report.generated_at],
  );
  const placed = useMemo(() => layoutBubbles(data, W, H, seed), [data, seed]);

  if (data.length < 1) return null;

  const displayLabel = (b: PlacedBubble) =>
    b.label.length > 28 && b.r < 38
      ? `${b.label.slice(0, 14)}…`
      : b.label.length > 22
        ? `${b.label.slice(0, 18)}…`
        : b.label;

  return (
    <div
      className={`group/bubblemap relative mt-6 overflow-hidden rounded-2xl border bg-gradient-to-br from-black/40 via-black/25 to-[var(--color-helix-a)]/[0.06] p-4 print:border-neutral-300 print:bg-white ${
        report.llm_enhanced
          ? "border-[var(--color-helix-a)]/40 shadow-[0_0_48px_-12px_rgba(94,247,209,0.45)]"
          : "border-white/10"
      }`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.45] print:hidden"
        style={{
          backgroundImage: `
            radial-gradient(ellipse 70% 50% at 50% 40%, rgba(94,247,209,0.14), transparent 55%),
            radial-gradient(circle 320px at 80% 20%, rgba(167,139,250,0.1), transparent 60%),
            radial-gradient(circle 240px at 15% 85%, rgba(251,191,36,0.06), transparent 55%)
          `,
        }}
      />

      <div className="relative flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-helix-a)] print:text-neutral-800">
            Intelligence bubble map
          </p>
          <p className="mt-1 max-w-2xl text-[11px] leading-snug text-[var(--color-ink-500)] print:text-neutral-600">
            Forensic MemeLab signals first: live wallet snapshot, deploy rhythm, market-edge ratios,
            strain DNA, family peer roles, family momentum, then compressed index labels. This is{" "}
            <em>not</em> a holder transfer graph like{" "}
            <a
              href="https://v2.bubblemaps.io/map?chain=bsc"
              target="_blank"
              rel="noreferrer"
              className="text-[var(--color-helix-a)] underline decoration-white/20 underline-offset-2 hover:text-white print:text-neutral-800"
            >
              Bubblemaps
            </a>{" "}
            — different on-chain layer (distribution vs MemeLab corpus).
          </p>
        </div>
        {report.llm_enhanced ? (
          <span className="rounded-full border border-[var(--color-helix-a)]/40 bg-[var(--color-helix-a)]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-helix-a)] print:border-neutral-400 print:bg-neutral-100 print:text-neutral-800">
            LLM narrative
          </span>
        ) : (
          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-wide text-[var(--color-ink-500)] print:border-neutral-300 print:text-neutral-600">
            Template + facts
          </span>
        )}
      </div>

      <motion.svg
        viewBox={`0 0 ${W} ${H}`}
        className="relative mt-4 w-full overflow-visible"
        role="img"
        aria-label="Bubble map of report relations"
        initial={{ opacity: 0.85 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
      >
        <defs>
          <radialGradient id={`bmAmbient-${uid}`} cx="50%" cy="50%" r="65%">
            <stop offset="0%" stopColor="rgb(94,247,209)" stopOpacity="0.35" />
            <stop offset="45%" stopColor="rgb(99,102,241)" stopOpacity="0.12" />
            <stop offset="100%" stopColor="rgb(0,0,0)" stopOpacity="0" />
          </radialGradient>
          <filter id={`bmDrop-${uid}`} x="-55%" y="-55%" width="210%" height="210%">
            <feDropShadow dx="0" dy="5" stdDeviation="6" floodOpacity="0.48" floodColor="#020617" />
          </filter>
          <radialGradient id={`bmArch-${uid}`} cx="32%" cy="28%">
            <stop offset="0%" stopColor="rgb(200,255,245)" stopOpacity="1" />
            <stop offset="55%" stopColor="rgb(94,247,209)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="rgb(22,163,74)" stopOpacity="0.55" />
          </radialGradient>
          <radialGradient id={`bmFam-${uid}`} cx="32%" cy="28%">
            <stop offset="0%" stopColor="rgb(237,233,254)" stopOpacity="1" />
            <stop offset="50%" stopColor="rgb(167,139,250)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="rgb(79,70,229)" stopOpacity="0.62" />
          </radialGradient>
          <radialGradient id={`bmPeer-${uid}`} cx="32%" cy="28%">
            <stop offset="0%" stopColor="rgb(254,243,199)" stopOpacity="1" />
            <stop offset="50%" stopColor="rgb(251,191,36)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="rgb(234,88,12)" stopOpacity="0.65" />
          </radialGradient>
          <radialGradient id={`bmTerm-${uid}`} cx="32%" cy="28%">
            <stop offset="0%" stopColor="rgb(241,245,249)" stopOpacity="0.95" />
            <stop offset="55%" stopColor="rgb(148,163,184)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="rgb(51,65,85)" stopOpacity="0.55" />
          </radialGradient>
          <radialGradient id={`bmInsight-${uid}`} cx="38%" cy="30%">
            <stop offset="0%" stopColor="rgb(167,243,208)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="rgb(16,185,129)" stopOpacity="0.42" />
          </radialGradient>
          <radialGradient id={`bmForensic-${uid}`} cx="30%" cy="26%">
            <stop offset="0%" stopColor="rgb(56,189,248)" stopOpacity="1" />
            <stop offset="55%" stopColor="rgb(14,165,233)" stopOpacity="0.85" />
            <stop offset="100%" stopColor="rgb(30,58,138)" stopOpacity="0.65" />
          </radialGradient>
          <radialGradient id={`bmRhythm-${uid}`} cx="34%" cy="28%">
            <stop offset="0%" stopColor="rgb(125,211,252)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="rgb(8,145,178)" stopOpacity="0.55" />
          </radialGradient>
          <radialGradient id={`bmEdge-${uid}`} cx="32%" cy="30%">
            <stop offset="0%" stopColor="rgb(251,113,133)" stopOpacity="0.95" />
            <stop offset="55%" stopColor="rgb(244,63,94)" stopOpacity="0.88" />
            <stop offset="100%" stopColor="rgb(157,23,77)" stopOpacity="0.6" />
          </radialGradient>
          <radialGradient id={`bmStrain-${uid}`} cx="32%" cy="28%">
            <stop offset="0%" stopColor="rgb(216,180,254)" stopOpacity="1" />
            <stop offset="50%" stopColor="rgb(168,85,247)" stopOpacity="0.92" />
            <stop offset="100%" stopColor="rgb(88,28,135)" stopOpacity="0.65" />
          </radialGradient>
          <radialGradient id={`bmMesh-${uid}`} cx="35%" cy="28%">
            <stop offset="0%" stopColor="rgb(253,224,71)" stopOpacity="1" />
            <stop offset="100%" stopColor="rgb(217,119,6)" stopOpacity="0.75" />
          </radialGradient>
          <radialGradient id={`bmPulse-${uid}`} cx="38%" cy="32%">
            <stop offset="0%" stopColor="rgb(244,114,182)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="rgb(190,24,93)" stopOpacity="0.62" />
          </radialGradient>
          <radialGradient id={`bmSignal-${uid}`} cx="36%" cy="30%">
            <stop offset="0%" stopColor="rgb(165,243,252)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="rgb(59,130,246)" stopOpacity="0.62" />
          </radialGradient>
        </defs>

        <motion.g transform={`translate(${W / 2}, ${H / 2})`}>
          <motion.circle
            r={148}
            fill={`url(#bmAmbient-${uid})`}
            animate={
              reduceMotion
                ? {}
                : {
                    scale: [1, 1.12, 1],
                    opacity: [0.28, 0.48, 0.28],
                  }
            }
            transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
          />
        </motion.g>

        {placed.map((b, i) => (
          <g key={b.id} transform={`translate(${b.x}, ${b.y})`}>
            <title>{b.detail ? `${b.label} — ${b.detail}` : b.label}</title>
            {!reduceMotion ? (
              <motion.circle
                r={b.r + 5}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                className="text-[var(--color-helix-a)]/35"
                animate={{
                  opacity: [0.15, 0.42, 0.15],
                  scale: [0.92, 1.14, 0.92],
                }}
                transition={{
                  duration: 2.6 + (i % 5) * 0.15,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: i * 0.08,
                }}
              />
            ) : null}
            <motion.g
              initial={{ opacity: 0, scale: 0.35 }}
              animate={{
                opacity: 1,
                scale: 1,
                y: reduceMotion ? 0 : [0, -3.2, 0],
              }}
              transition={{
                opacity: { duration: 0.35 },
                scale: {
                  type: "spring",
                  stiffness: 420,
                  damping: 26,
                  delay: i * 0.042,
                },
                y: reduceMotion
                  ? undefined
                  : {
                      duration: 3.2 + (i % 6) * 0.22,
                      repeat: Infinity,
                      ease: "easeInOut",
                      delay: i * 0.11,
                    },
              }}
            >
              <motion.g
                className="cursor-default"
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.94 }}
                transition={{ type: "spring", stiffness: 460, damping: 22 }}
              >
                <circle
                  cx={0}
                  cy={0}
                  r={b.r}
                  fill={bubbleFill(b.kind, uid)}
                  stroke="rgba(255,255,255,0.2)"
                  strokeWidth={1.4}
                  filter={`url(#bmDrop-${uid})`}
                  className="print:stroke-neutral-400 print:filter-none"
                />
                <ellipse
                  cx={-b.r * 0.3}
                  cy={-b.r * 0.32}
                  rx={b.r * 0.38}
                  ry={b.r * 0.26}
                  fill="white"
                  opacity={0.16}
                  className="pointer-events-none print:opacity-[0.06]"
                />
                <text
                  x={0}
                  y={1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="white"
                  fontSize={Math.min(11.5, 5.8 + b.r * 0.23)}
                  fontWeight={500}
                  fontFamily='ui-sans-serif, system-ui, "Segoe UI", sans-serif'
                  className="pointer-events-none select-none print:fill-neutral-900"
                  style={{
                    textShadow: "0 1px 3px rgba(0,0,0,0.55)",
                  }}
                >
                  {displayLabel(b)}
                </text>
              </motion.g>
            </motion.g>
          </g>
        ))}
      </motion.svg>

      <div className="relative mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-[9px] leading-tight text-[var(--color-ink-500)] print:text-neutral-600">
        <span className="text-[var(--color-ink-400)]">Intel:</span>
        <span>
          <span className="inline-block h-2 w-2 rounded-full bg-sky-400 align-middle" /> Forensic
        </span>
        <span>
          <span className="inline-block h-2 w-2 rounded-full bg-cyan-400 align-middle" /> Rhythm
        </span>
        <span>
          <span className="inline-block h-2 w-2 rounded-full bg-rose-500 align-middle" /> Edge
        </span>
        <span>
          <span className="inline-block h-2 w-2 rounded-full bg-violet-500 align-middle" /> Strain
        </span>
        <span>
          <span className="inline-block h-2 w-2 rounded-full bg-amber-400 align-middle" /> Mesh
        </span>
        <span>
          <span className="inline-block h-2 w-2 rounded-full bg-pink-500 align-middle" /> Pulse
        </span>
        <span>
          <span className="inline-block h-2 w-2 rounded-full bg-blue-400 align-middle" /> Signal
        </span>
        <span className="text-[var(--color-ink-400)]">· Index:</span>
        <span>
          <span className="inline-block h-2 w-2 rounded-full bg-[var(--color-helix-a)] align-middle" /> Label
        </span>
        <span>
          <span className="inline-block h-2 w-2 rounded-full bg-[var(--color-helix-b)] align-middle" /> Family
        </span>
        <span>
          <span className="inline-block h-2 w-2 rounded-full bg-slate-400 align-middle" /> Term
        </span>
        <span>
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400/80 align-middle" /> Narrative
        </span>
      </div>
    </div>
  );
}

/** Radar/spider chart of archetype mix (wallet or token). */
export function LabReportArchetypeRadar({ facts }: { facts: Record<string, unknown> }) {
  const rows = pickArchetypes(facts).slice(0, 8);
  if (!rows.length) return null;
  /* Few distinct archetypes: polygon radar is misleading; use compact spotlight. */
  if (rows.length < 3) {
    return (
      <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4 print:border-neutral-300 print:bg-white">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-400)] print:text-neutral-700">
          Archetype mix
        </p>
        <p className="mt-1 text-[11px] text-[var(--color-ink-500)] print:text-neutral-600">
          Only {rows.length} archetype bucket(s). Radar needs more variety; here is the split.
        </p>
        <div className="mt-4 space-y-2">
          {(() => {
            const vmax = Math.max(1, ...rows.map((x) => x.value));
            return rows.map((r) => (
              <div key={r.label} className="flex items-center gap-3 text-xs">
                <span className="w-28 shrink-0 truncate font-mono text-[var(--color-ink-300)] print:text-neutral-800">
                  {r.label}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10 print:bg-neutral-200">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[var(--color-helix-b)] to-[var(--color-helix-c)] print:bg-neutral-800"
                    style={{ width: `${(r.value / vmax) * 100}%` }}
                  />
                </div>
                <span className="w-8 text-right font-mono text-[var(--color-ink-200)] print:text-neutral-900">
                  {r.value}
                </span>
              </div>
            ));
          })()}
        </div>
      </div>
    );
  }
  const size = 260;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 28;
  const max = Math.max(1, ...rows.map((x) => x.value));
  const angleFor = (i: number) => (i / rows.length) * 2 * Math.PI - Math.PI / 2;
  const pts = rows.map((row, i) => {
    const a = angleFor(i);
    const rr = (row.value / max) * r;
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
  });
  const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ") + " Z";
  const rings = [0.33, 0.66, 1];
  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4 print:border-neutral-300 print:bg-white">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-400)] print:text-neutral-700">
        Archetype radar
      </p>
      <svg viewBox={`0 0 ${size} ${size}`} className="mt-3 mx-auto w-full max-w-[320px]">
        {rings.map((k) => (
          <circle
            key={k}
            cx={cx}
            cy={cy}
            r={r * k}
            fill="none"
            stroke="currentColor"
            opacity="0.08"
            className="text-white print:text-neutral-400"
          />
        ))}
        {rows.map((_row, i) => {
          const a = angleFor(i);
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={cx + Math.cos(a) * r}
              y2={cy + Math.sin(a) * r}
              stroke="currentColor"
              opacity="0.08"
              className="text-white print:text-neutral-400"
            />
          );
        })}
        <path d={pathD} fill="var(--color-helix-a)" fillOpacity="0.28" stroke="var(--color-helix-a)" strokeWidth="1.4" />
        {pts.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={2.5} fill="var(--color-helix-c)" />
        ))}
        {rows.map((row, i) => {
          const a = angleFor(i);
          const lx = cx + Math.cos(a) * (r + 14);
          const ly = cy + Math.sin(a) * (r + 14);
          const anchor =
            Math.cos(a) > 0.2 ? "start" : Math.cos(a) < -0.2 ? "end" : "middle";
          return (
            <text
              key={`l-${i}`}
              x={lx}
              y={ly}
              fontSize="8"
              fontFamily="ui-monospace, Menlo, monospace"
              textAnchor={anchor}
              dominantBaseline="middle"
              fill="currentColor"
              className="fill-[var(--color-ink-300)] print:fill-neutral-700"
            >
              {row.label.slice(0, 14)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

/** Square treemap of top DNA families by token count. */
export function LabReportFamilySizeTree({ facts }: { facts: Record<string, unknown> }) {
  type FamilyBlock = {
    title?: string;
    your_tokens?: number;
    family_mutations_count?: number;
    confidence?: number;
  };
  const fams = (facts.top_families as FamilyBlock[]) || [];
  const rt = facts.report_type as string | undefined;
  const rows = fams
    .map((f) => ({
      label: (f.title || "").slice(0, 26) || "…",
      value: rt === "token"
        ? Math.max(1, Number(f.family_mutations_count || 0))
        : Math.max(1, Number(f.your_tokens || 0)),
      confidence: Number(f.confidence || 0),
    }))
    .filter((r) => r.value > 0)
    .slice(0, 8);
  if (rows.length < 1) return null;
  const total = rows.reduce((s, r) => s + r.value, 0);
  const w = 520;
  const h = 160;
  let x = 0;
  const blocks = rows.map((r) => {
    const bw = (r.value / total) * w;
    const out = { ...r, x, w: bw };
    x += bw;
    return out;
  });
  const palette = [
    "var(--color-helix-a)",
    "var(--color-helix-b)",
    "var(--color-helix-c)",
    "#f59e0b",
    "#10b981",
    "#9ca3af",
    "#ef4444",
    "#6366f1",
  ];
  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4 print:border-neutral-300 print:bg-white">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-400)] print:text-neutral-700">
        Family size · {rt === "token" ? "mutations per family" : "your tokens per family"}
      </p>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 w-full">
        {blocks.map((b, i) => (
          <g key={i}>
            <rect
              x={b.x}
              y={0}
              width={b.w}
              height={h}
              fill={palette[i % palette.length]}
              opacity={0.3 + Math.min(0.6, b.confidence * 0.8)}
            />
            <rect
              x={b.x}
              y={0}
              width={b.w}
              height={h}
              fill="none"
              stroke="var(--color-ink-900)"
              strokeWidth="2"
            />
            {b.w > 40 ? (
              <>
                <text
                  x={b.x + 6}
                  y={16}
                  fontSize="10"
                  fontFamily="ui-monospace, Menlo, monospace"
                  fill="white"
                  className="print:fill-white"
                >
                  {b.label}
                </text>
                <text
                  x={b.x + 6}
                  y={30}
                  fontSize="9"
                  fontFamily="ui-monospace, Menlo, monospace"
                  fill="white"
                  opacity="0.85"
                  className="print:fill-white"
                >
                  {b.value} · {Math.round(b.confidence * 100)}%
                </text>
              </>
            ) : null}
          </g>
        ))}
      </svg>
    </div>
  );
}

/** Monthly bar chart derived from the `timeline` array (date strings). */
export function LabReportTimelineBars({ facts }: { facts: Record<string, unknown> }) {
  type Row = { date: string };
  const tl = (facts.timeline as Row[]) || [];
  if (!tl.length) return null;
  const buckets = new Map<string, number>();
  for (const t of tl) {
    const key = (t.date || "").slice(0, 7);
    if (!key) continue;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const rows = Array.from(buckets.entries())
    .map(([k, v]) => ({ k, v }))
    .sort((a, b) => a.k.localeCompare(b.k));
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((r) => r.v));
  const w = 600;
  const h = 110;
  const barW = Math.max(6, (w - 20) / rows.length - 4);
  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4 print:border-neutral-300 print:bg-white">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-400)] print:text-neutral-700">
        Launches per month
      </p>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 w-full">
        {rows.map((row, i) => {
          const bh = (row.v / max) * (h - 28);
          const x = 10 + i * ((w - 20) / rows.length);
          return (
            <g key={row.k}>
              <rect
                x={x}
                y={h - bh - 16}
                width={barW}
                height={bh}
                rx={2}
                fill="url(#timelineBarGrad)"
              />
              <text
                x={x + barW / 2}
                y={h - bh - 20}
                fontSize="9"
                textAnchor="middle"
                fontFamily="ui-monospace, Menlo, monospace"
                className="fill-[var(--color-ink-200)] print:fill-neutral-900"
              >
                {row.v}
              </text>
              <text
                x={x + barW / 2}
                y={h - 4}
                fontSize="8"
                textAnchor="middle"
                fontFamily="ui-monospace, Menlo, monospace"
                className="fill-[var(--color-ink-500)] print:fill-neutral-600"
              >
                {row.k.slice(2)}
              </text>
            </g>
          );
        })}
        <defs>
          <linearGradient id="timelineBarGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-helix-a)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--color-helix-c)" stopOpacity="0.55" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

/** Donut showing the share between 24h volume, liquidity and market cap. */
export function LabReportTradingDonut({ facts }: { facts: Record<string, unknown> }) {
  const rt = facts.report_type as string | undefined;
  let vol = 0;
  let liq = 0;
  let mcap = 0;
  let holders = 0;
  if (rt === "token") {
    const tr = facts.trading as Record<string, number> | undefined;
    if (tr) {
      vol = Number(tr.volume_24h_usd ?? 0);
      liq = Number(tr.liquidity_usd ?? 0);
      mcap = Number(tr.market_cap_usd ?? 0);
      holders = Number(tr.holders ?? 0);
    }
  } else {
    const q = facts.quality as Record<string, number> | undefined;
    const st = facts.stats as Record<string, number> | undefined;
    if (q) {
      vol = Number(st?.total_volume_24h_usd ?? q.avg_volume_24h_usd ?? 0);
      liq = Number(st?.total_liquidity_usd ?? q.avg_liquidity_usd ?? 0);
      mcap = Number(q.sum_market_cap_usd ?? 0);
      holders = Number(st?.max_holders_on_any_token ?? 0);
    }
  }
  const rows: Bucket[] = [
    { label: "24h vol", value: vol },
    { label: "Liquidity", value: liq },
    { label: "Mkt cap", value: mcap },
  ].filter((r) => r.value > 0);
  if (rows.length < 1) return null;
  const palette = [
    "var(--color-helix-a)",
    "var(--color-helix-b)",
    "var(--color-helix-c)",
  ];
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4 print:border-neutral-300 print:bg-white">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-400)] print:text-neutral-700">
        Trading mix
      </p>
      <div className="mt-3 flex items-center gap-5">
        <Donut rows={rows} size={120} />
        <ul className="space-y-1.5 text-xs">
          {rows.map((r, i) => (
            <li key={r.label} className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{ background: palette[i % palette.length] }}
              />
              <span className="text-[var(--color-ink-300)] print:text-neutral-700 w-20">
                {r.label}
              </span>
              <span className="font-mono text-white print:text-black">{formatUsd(r.value)}</span>
              <span className="font-mono text-[10px] text-[var(--color-ink-500)] print:text-neutral-600">
                {((r.value / total) * 100).toFixed(0)}%
              </span>
            </li>
          ))}
          {holders ? (
            <li className="mt-2 flex items-center gap-2 border-t border-white/10 pt-1.5 text-[var(--color-ink-300)] print:border-neutral-300 print:text-neutral-700">
              <span className="w-20">Holders</span>
              <span className="font-mono text-white print:text-black">
                {holders.toLocaleString("en-US")}
              </span>
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}

/** Always-visible counts so the viz section is never an empty void. */
export function LabReportIndexedSummary({ facts }: { facts: Record<string, unknown> }) {
  const rt = facts.report_type as string | undefined;
  const st = facts.stats as Record<string, number> | undefined;
  const nArch = pickArchetypes(facts).length;
  const nFam = (facts.top_families as unknown[] | undefined)?.length ?? 0;
  const nTl = (facts.timeline as unknown[] | undefined)?.length ?? 0;
  const cells: { k: string; v: string }[] = [
    { k: "Mode", v: rt === "token" ? "Token" : "Wallet" },
    { k: "Archetype buckets", v: String(nArch) },
    { k: "Families in view", v: String(nFam) },
    { k: "Timeline rows", v: String(nTl) },
  ];
  if (st?.tokens_deployed != null) {
    cells.push({ k: "Tokens in scope", v: String(Number(st.tokens_deployed)) });
  }
  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-[var(--color-helix-a)]/5 p-4 print:border-neutral-300 print:bg-white">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-helix-a)] print:text-neutral-800">
        Indexed data snapshot
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {cells.map((c) => (
          <div key={c.k}>
            <p className="text-[9px] uppercase tracking-[0.15em] text-[var(--color-ink-500)] print:text-neutral-600">
              {c.k}
            </p>
            <p className="mt-0.5 font-mono text-sm text-white print:text-black">{c.v}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Small KPI strip at the very top of the report (works in both modes). */
export function LabReportKPIStrip({ facts }: { facts: Record<string, unknown> }) {
  const rt = facts.report_type as string | undefined;
  const st = facts.stats as Record<string, number> | undefined;
  const tr = facts.trading as Record<string, number> | undefined;
  const ss = facts.social_signals as { items?: unknown[] } | undefined;
  const b = facts.behavior as
    | { streak_days?: number; days_active?: number; total_deploys_30d?: number }
    | undefined;
  const fams = (facts.top_families as unknown[]) || [];
  const items: { k: string; v: string }[] = [];
  if (rt === "token") {
    if (tr) {
      items.push({ k: "24h vol", v: formatUsd(Number(tr.volume_24h_usd ?? 0)) });
      items.push({ k: "Liquidity", v: formatUsd(Number(tr.liquidity_usd ?? 0)) });
      items.push({ k: "Holders", v: String(Number(tr.holders ?? 0)) });
    }
    items.push({ k: "Family peers", v: String(fams.length) });
  } else {
    if (st) {
      items.push({ k: "Tokens", v: String(Number(st.tokens_deployed ?? 0)) });
      items.push({ k: "Families", v: String(Number(st.families_touched ?? 0)) });
      items.push({ k: "Σ 24h vol", v: formatUsd(Number(st.total_volume_24h_usd ?? 0)) });
    }
    if (b?.streak_days) items.push({ k: "Streak", v: `${b.streak_days}d` });
    if (b?.days_active) items.push({ k: "Active days", v: `${b.days_active}` });
  }
  if (ss?.items?.length) items.push({ k: "Social refs", v: String(ss.items.length) });
  if (!items.length) return null;
  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {items.slice(0, 6).map((c) => (
        <div
          key={c.k}
          className="rounded-xl border border-white/10 bg-gradient-to-br from-[var(--color-helix-a)]/10 to-transparent px-3 py-2 print:border-neutral-300 print:bg-white"
        >
          <p className="text-[9px] uppercase tracking-[0.15em] text-[var(--color-ink-500)] print:text-neutral-600">
            {c.k}
          </p>
          <p className="mt-0.5 font-mono text-sm text-white print:text-black">{c.v}</p>
        </div>
      ))}
    </div>
  );
}

export function LabReportVisualBlock({ report }: { report: LabReportResponse }) {
  const { facts } = report;
  return (
    <>
      <LabReportIndexedSummary facts={facts} />
      <LabReportKPIStrip facts={facts} />
      <LabReportTradingSnapshot facts={facts} />
      <LabReportTradingDonut facts={facts} />
      <LabReportQualityStats facts={facts} />
      <LabReportInsightBoard
        insights={report.narrative.key_insights}
        risks={report.narrative.risk_flags}
        opportunities={report.narrative.opportunity_flags}
      />
      <LabReportAIBubbleMap report={report} />
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <LabReportArchetypeBars facts={facts} />
        <LabReportArchetypeRadar facts={facts} />
      </div>
      <LabReportFamilySizeTree facts={facts} />
      <LabReportDeployHeatmap facts={facts} />
      <LabReportDeploySparkline facts={facts} />
      <LabReportTimelineBars facts={facts} />
      <LabReportFamilyActivity facts={facts} />
      <LabReportFamilyMetrics facts={facts} />
      <LabReportPeerTokens facts={facts} />
      <LabReportNameSignals facts={facts} />
    </>
  );
}
