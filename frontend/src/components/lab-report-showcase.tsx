"use client";

/**
 * Lab Report  - premium AI showcase components.
 *
 * The Lab Report page is the front door for the AI-authored narrative
 * layer of MemeLab. These components exist to make that obvious: instead
 * of an empty form, visitors should land on a console that broadcasts
 * "there is a multi-model reasoning engine working for you here".
 *
 * Everything here is presentational  - no direct fetch calls  - so the
 * page controls data loading (stack, suggestions) and passes it in.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  Brain,
  CheckCircle2,
  Cpu,
  Database,
  Dna,
  Globe2,
  GitBranch,
  Layers3,
  Loader2,
  MessagesSquare,
  Network,
  PenLine,
  Radar,
  Search,
  Sparkles,
  Wand2,
  Zap,
} from "lucide-react";
import type {
  ExplorerToken,
  LabReportResponse,
  OverviewStats,
  ScanningStats,
  StackInfo,
} from "@/lib/types";
import { MemeLabMark } from "./brand/memelab-mark";

/* =====================================================================
 *  Tiny helpers
 * =================================================================== */

function fmtCount(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "–";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return v.toLocaleString("en-US");
}

function fmtUsd(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v === 0) return "$0";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

function shortAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr || "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/* =====================================================================
 *  HERO  - "Intelligence layer" announcement
 * =================================================================== */

export function LabIntelligenceHero({
  stack,
  overview,
  scanning,
}: {
  stack: StackInfo | null;
  overview: OverviewStats | null;
  scanning: ScanningStats | null;
}) {
  const llmOn = !!stack?.chat_llm?.enabled;
  const embOn = !!stack?.embeddings?.enabled;
  const researchOn = !!stack?.research?.enabled;
  const tokens = overview?.tokens_total ?? 0;
  const families = overview?.families_total ?? 0;
  const head = scanning?.chain_head ?? null;

  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-[var(--color-ink-950)]/60 p-6 sm:p-10 lg:p-12">
      {/* aurora backdrop  - mirrors the hero style used on the home page */}
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-70">
        <div className="aurora-blob aurora-a" />
        <div className="aurora-blob aurora-b" />
        <div className="aurora-blob aurora-c" />
      </div>
      <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-[var(--color-helix-b)]/15 blur-[120px]" />
      {/* Oversized brand watermark  - decorative only. Sits behind content
          at low opacity and anchors the page as "this is MemeLab". */}
      <div
        className="pointer-events-none absolute -right-10 -top-10 hidden opacity-[0.07] mix-blend-screen md:block lg:-right-4 lg:-top-6"
        aria-hidden
      >
        <MemeLabMark variant="glyph" size={320} />
      </div>

      <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-helix-a)]/30 bg-[var(--color-helix-a)]/[0.06] px-3 py-1 text-[10px] font-medium uppercase tracking-[0.24em] text-[var(--color-helix-a)]">
            <Sparkles className="h-3.5 w-3.5" />
            MemeLab AI · Intelligence layer
          </div>
          <h1 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-[3.4rem]">
            <span className="gradient-text">AI-composed</span> intelligence
            <br />
            for any wallet or token.
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-relaxed text-[var(--color-ink-300)] sm:text-base">
            AI-assisted reasoning over on-chain DNA, family lineage, and (when
            enabled) social context, composed into a readable brief. Facts first:
            language models polish structure and tone, not invent prices.
          </p>

          {/* Capability strip (no raw model IDs  - configured server-side). */}
          <div className="mt-6 flex flex-wrap items-center gap-2 text-[11px]">
            <ModelChip
              icon={<Brain className="h-3 w-3" />}
              label="Narrative AI"
              value={llmOn ? "On" : "Templates only"}
              status={llmOn ? "on" : "off"}
            />
            <ModelChip
              icon={<Layers3 className="h-3 w-3" />}
              label="Similarity"
              value={embOn ? "Embeddings on" : "Lightweight fallback"}
              status={embOn ? "on" : "off"}
            />
            <ModelChip
              icon={<Globe2 className="h-3 w-3" />}
              label="Web research"
              value={researchOn ? "Enabled" : "Off"}
              status={researchOn ? "on" : "off"}
            />
            <ModelChip
              icon={<Database className="h-3 w-3" />}
              label="Chain"
              value={head ? `BNB · head ${fmtCount(head)}` : "BNB Chain"}
              status="on"
            />
          </div>
        </div>

        {/* Universe stat column */}
        <div className="grid w-full gap-3 sm:max-w-sm sm:grid-cols-3 lg:w-auto">
          <UniverseStat
            label="Indexed tokens"
            value={fmtCount(tokens)}
            glow="a"
          />
          <UniverseStat
            label="DNA families"
            value={fmtCount(families)}
            glow="b"
          />
          <UniverseStat
            label="24h volume"
            value={fmtUsd(overview?.volume_24h_usd)}
            glow="c"
          />
        </div>
      </div>
    </section>
  );
}

function ModelChip({
  icon,
  label,
  value,
  status,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  status: "on" | "off" | "warn";
}) {
  const dot =
    status === "on"
      ? "bg-[var(--color-good)] shadow-[0_0_10px_rgba(34,211,161,0.6)]"
      : status === "warn"
      ? "bg-[var(--color-warn)] shadow-[0_0_10px_rgba(245,158,11,0.5)]"
      : "bg-[var(--color-ink-500)]";
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[var(--color-ink-200)]"
      title={`${label}: ${value}`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
      <span className="inline-flex items-center gap-1 text-[var(--color-ink-400)]">
        {icon}
        {label}
      </span>
      <span className="max-w-[16ch] truncate font-mono text-white">{value}</span>
    </span>
  );
}

function UniverseStat({
  label,
  value,
  glow,
}: {
  label: string;
  value: string;
  glow: "a" | "b" | "c";
}) {
  const accent =
    glow === "a"
      ? "from-[var(--color-helix-a)]/25"
      : glow === "b"
      ? "from-[var(--color-helix-b)]/25"
      : "from-[var(--color-helix-c)]/25";
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-gradient-to-br ${accent} to-transparent px-4 py-3`}
    >
      <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--color-ink-400)]">
        {label}
      </p>
      <p className="mt-1 font-mono text-xl text-white">{value}</p>
    </div>
  );
}

/* =====================================================================
 *  AI STACK PANEL  - what's actually running under the hood
 * =================================================================== */

export function LabAIStackPanel({ stack }: { stack: StackInfo | null }) {
  const rows = useMemo(() => {
    const llm = stack?.chat_llm;
    const emb = stack?.embeddings;
    const ds = stack?.data_sources;
    const r = stack?.research;
    const p = stack?.pipeline;
    return [
      {
        icon: <Brain className="h-4 w-4" />,
        label: "Narrative layer",
        value: llm?.enabled
          ? "OpenAI-compatible API · reasoning & phrasing"
          : "Deterministic templates (no chat API)",
        status: llm?.enabled ? "on" : "off",
        accent: "a" as const,
      },
      {
        icon: <Layers3 className="h-4 w-4" />,
        label: "Semantic fingerprints",
        value: emb?.enabled
          ? "Embedding similarity for clustering & search"
          : "Local hash fallback (coarser clusters)",
        status: emb?.enabled ? "on" : "off",
        accent: "b" as const,
      },
      {
        icon: <Globe2 className="h-4 w-4" />,
        label: "Web / social research",
        value: r?.enabled ? "Optional provider chain (when configured)" : "Disabled",
        status: r?.enabled ? "on" : "off",
        accent: "c" as const,
      },
      {
        icon: <Database className="h-4 w-4" />,
        label: "On-chain indexer",
        value: `Four.Meme · BNB Chain ${stack?.blockchain?.chain_id ?? 56}${
          ds?.bitquery ? " + Bitquery" : ""
        }${ds?.dexscreener ? " + DexScreener" : ""}`,
        status: ds?.four_meme_onchain ? "on" : "off",
        accent: "a" as const,
      },
      {
        icon: <Activity className="h-4 w-4" />,
        label: "Pipeline",
        value: p
          ? `Every ${p.interval_minutes}m · lookback ${p.lookback_hours}h · conf≥${p.min_confidence}`
          : "n/a",
        status: "on",
        accent: "b" as const,
      },
    ];
  }, [stack]);

  return (
    <div className="glass relative overflow-hidden rounded-2xl p-5">
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-[var(--color-helix-a)]/10 blur-3xl" />
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--color-helix-a)]/15 text-[var(--color-helix-a)]">
          <Cpu className="h-4 w-4" />
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--color-ink-400)]">
            AI stack
          </p>
          <p className="text-sm font-semibold text-white">Under the hood</p>
        </div>
      </div>
      <ul className="mt-4 space-y-2.5">
        {rows.map((r, i) => {
          const dot =
            r.status === "on"
              ? "bg-[var(--color-good)] shadow-[0_0_8px_rgba(34,211,161,0.7)]"
              : "bg-[var(--color-ink-500)]";
          const tint =
            r.accent === "a"
              ? "text-[var(--color-helix-a)]"
              : r.accent === "b"
              ? "text-[var(--color-helix-b)]"
              : "text-[var(--color-helix-c)]";
          return (
            <li
              key={i}
              className="flex items-start gap-3 rounded-xl border border-white/5 bg-black/20 px-3 py-2.5"
            >
              <span className={`mt-0.5 ${tint}`}>{r.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-[var(--color-ink-400)]">
                  {r.label}
                  <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                </p>
                <p className="mt-0.5 truncate font-mono text-[13px] text-white">
                  {r.value}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* =====================================================================
 *  REASONING PIPELINE  - the 5-step mental model
 * =================================================================== */

const REASONING_STEPS: {
  icon: React.ReactNode;
  title: string;
  body: string;
  accent: "a" | "b" | "c" | "d";
}[] = [
  {
    icon: <Dna className="h-4 w-4" />,
    title: "Ingest on-chain DNA",
    body: "Live scan of Four.Meme launches, bonding curves, trades, migrations.",
    accent: "a",
  },
  {
    icon: <Radar className="h-4 w-4" />,
    title: "Classify archetypes",
    body: "Heuristic + embedding-based labels for every token mutation.",
    accent: "b",
  },
  {
    icon: <Network className="h-4 w-4" />,
    title: "Cluster into DNA families",
    body: "pgvector HNSW over token semantics; lineage graph reconstructed.",
    accent: "c",
  },
  {
    icon: <MessagesSquare className="h-4 w-4" />,
    title: "Retrieve social signals",
    body: "Multi-provider web research for sentiment, narratives, red flags.",
    accent: "d",
  },
  {
    icon: <PenLine className="h-4 w-4" />,
    title: "Compose analyst narrative",
    body: "Reasoning LLM stitches facts + flags into a readable brief.",
    accent: "a",
  },
];

export function LabReasoningPipeline() {
  return (
    <div className="glass relative overflow-hidden rounded-2xl p-5">
      <div className="pointer-events-none absolute -left-16 bottom-0 h-40 w-40 rounded-full bg-[var(--color-helix-b)]/10 blur-3xl" />
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--color-helix-b)]/15 text-[var(--color-helix-b)]">
          <GitBranch className="h-4 w-4" />
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--color-ink-400)]">
            Reasoning pipeline
          </p>
          <p className="text-sm font-semibold text-white">
            How a report gets built
          </p>
        </div>
      </div>
      <ol className="mt-4 space-y-3">
        {REASONING_STEPS.map((s, i) => {
          const tint =
            s.accent === "a"
              ? "text-[var(--color-helix-a)] border-[var(--color-helix-a)]/30 bg-[var(--color-helix-a)]/5"
              : s.accent === "b"
              ? "text-[var(--color-helix-b)] border-[var(--color-helix-b)]/30 bg-[var(--color-helix-b)]/5"
              : s.accent === "c"
              ? "text-[var(--color-helix-c)] border-[var(--color-helix-c)]/30 bg-[var(--color-helix-c)]/5"
              : "text-[var(--color-helix-d)] border-[var(--color-helix-d)]/30 bg-[var(--color-helix-d)]/5";
          return (
            <li key={i} className="flex gap-3">
              <span
                className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${tint}`}
              >
                {s.icon}
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[13px] font-medium text-white">
                  <span className="font-mono text-[10px] text-[var(--color-ink-400)]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {s.title}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-ink-300)]">
                  {s.body}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* =====================================================================
 *  SUGGESTIONS  - one-click examples pulled from the live universe
 * =================================================================== */

export function LabAnalyzeSuggestions({
  tokens,
  onPick,
  loading,
}: {
  tokens: ExplorerToken[];
  onPick: (t: { mode: "wallet" | "token"; address: string; label: string }) => void;
  loading?: boolean;
}) {
  const items = tokens.slice(0, 6);
  return (
    <div className="glass relative overflow-hidden rounded-2xl p-5">
      <div className="pointer-events-none absolute -right-10 bottom-0 h-40 w-40 rounded-full bg-[var(--color-helix-c)]/10 blur-3xl" />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--color-helix-c)]/15 text-[var(--color-helix-c)]">
            <Wand2 className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--color-ink-400)]">
              Try an example
            </p>
            <p className="text-sm font-semibold text-white">
              Live picks from the universe
            </p>
          </div>
        </div>
        <span className="rounded-full border border-white/10 bg-black/30 px-2 py-0.5 font-mono text-[10px] text-[var(--color-ink-400)]">
          click to analyze
        </span>
      </div>
      {loading && !items.length ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-[68px] animate-pulse rounded-xl border border-white/5 bg-white/[0.03]"
            />
          ))}
        </div>
      ) : items.length ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {items.map((t) => (
            <button
              key={t.token_address}
              type="button"
              onClick={() =>
                onPick({
                  mode: "token",
                  address: t.token_address,
                  label: t.symbol || t.name || shortAddr(t.token_address),
                })
              }
              className="group flex w-full items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-left transition-colors hover:border-[var(--color-helix-a)]/40 hover:bg-[var(--color-helix-a)]/[0.04]"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--color-helix-a)]/25 to-[var(--color-helix-c)]/25 font-mono text-xs text-white">
                {(t.symbol || "?").slice(0, 3).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-white">
                  {t.name || t.symbol || "Unnamed"}
                </p>
                <p className="truncate font-mono text-[11px] text-[var(--color-ink-400)]">
                  {shortAddr(t.token_address)} · vol {fmtUsd(t.volume_24h_usd)} · liq{" "}
                  {fmtUsd(t.liquidity_usd)}
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-white/10 px-2 py-0.5 font-mono text-[10px] text-[var(--color-ink-300)] transition-colors group-hover:border-[var(--color-helix-a)]/40 group-hover:text-[var(--color-helix-a)]">
                Analyze
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-xs text-[var(--color-ink-400)]">
          No live picks yet. Wait for the next ingest tick, or paste your own
          address above.
        </p>
      )}
    </div>
  );
}

/* =====================================================================
 *  GENERATION PROGRESS  - stepped animation during /lab-report
 * =================================================================== */

const PROGRESS_STEPS: { icon: React.ReactNode; label: string }[] = [
  { icon: <Dna className="h-3.5 w-3.5" />, label: "Reading on-chain DNA" },
  { icon: <Radar className="h-3.5 w-3.5" />, label: "Classifying archetypes" },
  { icon: <Network className="h-3.5 w-3.5" />, label: "Mapping DNA families" },
  { icon: <Globe2 className="h-3.5 w-3.5" />, label: "Querying social signals" },
  { icon: <PenLine className="h-3.5 w-3.5" />, label: "Composing AI narrative" },
];

export function LabGenerationProgress({
  label,
}: {
  label: string;
}) {
  // Purely cosmetic step progression. Real report time is 3-12 s; we
  // auto-advance so the user feels multiple subsystems working.
  const [step, setStep] = useState(0);
  useEffect(() => {
    setStep(0);
    const id = setInterval(() => {
      setStep((s) => Math.min(s + 1, PROGRESS_STEPS.length - 1));
    }, 1800);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="border-gradient relative overflow-hidden rounded-2xl bg-[var(--color-ink-900)]/80 p-6">
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-60">
        <div className="aurora-blob aurora-a" />
        <div className="aurora-blob aurora-b" />
      </div>
      <div className="flex items-center gap-3">
        <div className="relative">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-helix-a)]/20 text-[var(--color-helix-a)]">
            <Bot className="h-5 w-5" />
          </div>
          <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-helix-a)] opacity-70" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--color-helix-a)]" />
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--color-ink-400)]">
            AI analysis running
          </p>
          <p className="truncate text-sm font-semibold text-white">{label}</p>
        </div>
      </div>

      <ol className="mt-5 space-y-2">
        {PROGRESS_STEPS.map((s, i) => {
          const state: "done" | "active" | "pending" =
            i < step ? "done" : i === step ? "active" : "pending";
          return (
            <li
              key={i}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2 transition-colors ${
                state === "done"
                  ? "border-[var(--color-good)]/30 bg-[var(--color-good)]/5"
                  : state === "active"
                  ? "border-[var(--color-helix-a)]/40 bg-[var(--color-helix-a)]/5"
                  : "border-white/5 bg-white/[0.02]"
              }`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-lg ${
                  state === "done"
                    ? "bg-[var(--color-good)]/20 text-[var(--color-good)]"
                    : state === "active"
                    ? "bg-[var(--color-helix-a)]/20 text-[var(--color-helix-a)]"
                    : "bg-white/5 text-[var(--color-ink-400)]"
                }`}
              >
                {state === "done" ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : state === "active" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  s.icon
                )}
              </span>
              <span
                className={`text-[13px] ${
                  state === "pending" ? "text-[var(--color-ink-400)]" : "text-white"
                }`}
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* =====================================================================
 *  REPORT ATTRIBUTION  - prominent AI-authored banner shown INSIDE the
 *  generated report card, right below the header.
 * =================================================================== */

export function LabReportAttribution({
  report,
  stack,
}: {
  report: LabReportResponse;
  stack: StackInfo | null;
}) {
  const llmOn = report.llm_enhanced;
  const model = stack?.chat_llm?.model ?? null;
  const modelShort = model ? model.split("/").pop() ?? model : "template";
  const nInsights = report.narrative.key_insights?.length ?? 0;
  const nRisks = report.narrative.risk_flags?.length ?? 0;
  const nOpp = report.narrative.opportunity_flags?.length ?? 0;

  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-white/10 bg-gradient-to-r from-[var(--color-helix-a)]/10 via-[var(--color-helix-b)]/5 to-[var(--color-helix-c)]/10 p-4 print:hidden">
      <div className="flex items-center gap-2.5">
        <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-ink-950)]/60 text-[var(--color-helix-a)] ring-1 ring-[var(--color-helix-a)]/40 print:bg-white print:text-neutral-700 print:ring-neutral-400">
          <Bot className="h-5 w-5" />
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--color-ink-300)] print:text-neutral-600">
            AI-composed report
          </p>
          <p className="text-sm font-semibold text-white print:text-black">
            {llmOn ? `Narrative by ${modelShort}` : "Heuristic template (no LLM key)"}
          </p>
        </div>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-1.5 text-[11px]">
        <AttrPill tone="a">
          <Search className="h-3 w-3" /> {nInsights} insight
          {nInsights === 1 ? "" : "s"}
        </AttrPill>
        {nRisks > 0 ? (
          <AttrPill tone="bad">
            <Zap className="h-3 w-3" /> {nRisks} risk{nRisks === 1 ? "" : "s"}
          </AttrPill>
        ) : null}
        {nOpp > 0 ? (
          <AttrPill tone="good">
            <Sparkles className="h-3 w-3" /> {nOpp} opportunit
            {nOpp === 1 ? "y" : "ies"}
          </AttrPill>
        ) : null}
        <AttrPill tone="b">
          <Layers3 className="h-3 w-3" /> {stack?.embeddings?.enabled ? "embed ✓" : "embed ✗"}
        </AttrPill>
        <AttrPill tone="c">
          <Globe2 className="h-3 w-3" />{" "}
          {stack?.research?.enabled ? stack.research.provider : "no web"}
        </AttrPill>
      </div>
    </div>
  );
}

/* =====================================================================
 *  PRINT-ONLY DOCUMENT CHROME
 *
 *  These two blocks render exclusively in the `@media print` context
 *  (see `globals.css`  - `.lab-report-cover` and `.lab-report-running-
 *  head` are `display:none` on screen). Together they turn a Save-as-
 *  PDF export into a proper analyst-grade document: a titled cover
 *  page followed by content pages that carry a subtle running header.
 * =================================================================== */

export function LabReportPrintCover({
  report,
  stack,
}: {
  report: LabReportResponse;
  stack: StackInfo | null;
}) {
  const issued = new Date(report.generated_at);
  const dateStr = issued.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = issued.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const reportId =
    `${report.address.slice(2, 8)}-${report.address.slice(-6)}`.toUpperCase();
  const modelName = stack?.chat_llm?.model ?? "template";
  const modelShort = modelName.split("/").pop() ?? modelName;
  const reportKind = report.mode === "wallet" ? "Wallet analysis" : "Token analysis";

  return (
    <div className="lab-report-cover">
      {/* Top strip: wordmark + reference id. We use the MONO mark so
          the cover stays in the document's greyscale palette and
          survives low-fidelity printers / greyscale PDF exports. */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3 text-neutral-800">
          <MemeLabMark variant="mono" size={38} />
          <div className="leading-tight">
            <p className="text-[11pt] font-semibold tracking-[0.04em] text-neutral-900">
              MemeLab
            </p>
            <p className="text-[8pt] uppercase tracking-[0.22em] text-neutral-500">
              Meme DNA Intelligence
            </p>
          </div>
        </div>
        <div className="text-right text-[8pt] uppercase tracking-[0.2em] text-neutral-500">
          <p>Report ref.</p>
          <p className="mt-0.5 font-mono text-[10pt] tracking-[0.08em] text-neutral-800">
            {reportId}
          </p>
        </div>
      </div>

      {/* Center block: title, subject, headline */}
      <div className="mx-auto max-w-[520pt] py-10">
        <p className="text-[9pt] uppercase tracking-[0.3em] text-neutral-500">
          Meme DNA Intelligence Report
        </p>
        <h1 className="mt-3 text-[28pt] font-semibold leading-[1.1] text-neutral-900">
          {report.narrative.headline}
        </h1>
        <div className="mt-6 border-t border-b border-neutral-300 py-4">
          <dl className="grid grid-cols-[120pt_1fr] gap-y-2 text-[10pt]">
            <dt className="uppercase tracking-[0.18em] text-neutral-500">Report type</dt>
            <dd className="text-neutral-900">{reportKind} · BNB Chain</dd>

            <dt className="uppercase tracking-[0.18em] text-neutral-500">Subject</dt>
            <dd className="break-all font-mono text-[9.5pt] text-neutral-900">
              {report.address}
            </dd>

            <dt className="uppercase tracking-[0.18em] text-neutral-500">Issued</dt>
            <dd className="text-neutral-900">
              {dateStr} · {timeStr}
            </dd>

            <dt className="uppercase tracking-[0.18em] text-neutral-500">Composed by</dt>
            <dd className="text-neutral-900">
              MemeLab AI
              {report.llm_enhanced ? (
                <span className="text-neutral-500"> · narrative by {modelShort}</span>
              ) : (
                <span className="text-neutral-500"> · heuristic template (LLM unavailable)</span>
              )}
            </dd>
          </dl>
        </div>

        {/* Executive summary excerpt (2-3 sentences from the narrative) */}
        <p className="mt-6 text-[11pt] leading-[1.65] text-neutral-800">
          {report.narrative.summary}
        </p>
      </div>

      {/* Bottom strip: classification + disclaimer */}
      <div className="space-y-3 border-t border-neutral-300 pt-4 text-[8pt] leading-relaxed text-neutral-500">
        <div className="flex items-center justify-between">
          <span className="uppercase tracking-[0.22em]">
            Classification · Research · Not investment advice
          </span>
          <span className="font-mono">memelab · bnb56</span>
        </div>
        <p>
          This document is an algorithmic research artefact generated by MemeLab from publicly
          available on-chain and web data. It is provided for informational and educational
          purposes only and does not constitute investment, legal, or tax advice. All
          market-data metrics are point-in-time snapshots from the issue date above.
        </p>
      </div>
    </div>
  );
}

export function LabReportRunningHead({
  report,
}: {
  report: LabReportResponse;
}) {
  const kind = report.mode === "wallet" ? "Wallet" : "Token";
  return (
    <div className="lab-report-running-head items-center justify-between border-b border-neutral-300 pb-2 text-[8pt] uppercase tracking-[0.22em] text-neutral-500">
      <span>MemeLab · Meme DNA Intelligence · {kind} analysis</span>
      <span className="font-mono tracking-[0.08em]">{report.address}</span>
    </div>
  );
}

function AttrPill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "a" | "b" | "c" | "bad" | "good";
}) {
  const cls =
    tone === "a"
      ? "border-[var(--color-helix-a)]/40 bg-[var(--color-helix-a)]/5 text-[var(--color-helix-a)]"
      : tone === "b"
      ? "border-[var(--color-helix-b)]/40 bg-[var(--color-helix-b)]/5 text-[var(--color-helix-b)]"
      : tone === "c"
      ? "border-[var(--color-helix-c)]/40 bg-[var(--color-helix-c)]/5 text-[var(--color-helix-c)]"
      : tone === "bad"
      ? "border-[var(--color-bad)]/40 bg-[var(--color-bad)]/5 text-[var(--color-bad)]"
      : "border-[var(--color-good)]/40 bg-[var(--color-good)]/5 text-[var(--color-good)]";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${cls} print:border-neutral-400 print:bg-white print:text-neutral-700`}
    >
      {children}
    </span>
  );
}
