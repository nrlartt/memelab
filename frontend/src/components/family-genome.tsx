"use client";

import * as React from "react";
import Link from "next/link";
import type { Mutation } from "@/lib/types";
import { formatPrice, formatUsd, shortAddress, timeAgo } from "@/lib/format";

type Props = {
  mutations: Mutation[];
  height?: number;
  /** Draw the two phosphate backbones; disable for dense families (>300). */
  backbone?: boolean;
};

const NUCLEOTIDES = [
  "var(--color-helix-a)",
  "var(--color-helix-b)",
  "var(--color-helix-c)",
  "var(--color-helix-d)",
];

const ROLE_COLORS: Record<string, string> = {
  origin: "var(--color-strain-origin)",
  dominant: "var(--color-strain-dominant)",
  fastest: "var(--color-strain-fastest)",
};

function roleOf(m: Mutation): "origin" | "dominant" | "fastest" | null {
  if (m.is_origin_strain) return "origin";
  if (m.is_dominant_strain) return "dominant";
  if (m.is_fastest_mutation) return "fastest";
  return null;
}

/**
 * Premium 2-D double helix.
 *
 *   - Base pairs scale with 24-h volume (log-normalized).
 *   - Role nucleotides (origin / dominant / fastest) get a soft radial glow.
 *   - Invisible, wider hit-rectangles guarantee hover works even on dense
 *     (1000+ mutation) families where each column is a few pixels wide.
 *   - All SVG numbers are rounded to 3 decimals so SSR === CSR output.
 */
export function FamilyGenome({
  mutations,
  height = 320,
  backbone = true,
}: Props) {
  const [hover, setHover] = React.useState<number | null>(null);

  if (!mutations || mutations.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-xl border border-dashed border-white/10 text-xs text-[var(--color-ink-400)]">
        No mutations to render
      </div>
    );
  }

  const sorted = [...mutations].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const n = sorted.length;
  const width = 1200;
  const pad = { l: 36, r: 36, t: 28, b: 36 };
  const midY = height / 2;
  const amp = (height - pad.t - pad.b) / 2.1;
  const stepX = Math.max(3, (width - pad.l - pad.r) / Math.max(1, n - 1));
  const turns = Math.max(1.8, Math.min(8, n / 14));

  const r3 = (v: number) => Math.round(v * 1000) / 1000;

  // Volume normalization → base radius (log-scale)
  const maxVol = Math.max(1, ...sorted.map((m) => m.trading?.volume_24h_usd ?? 0));
  const volScale = (v: number) => {
    if (v <= 0) return 0;
    return Math.log10(v + 1) / Math.log10(maxVol + 1);
  };

  const items = sorted.map((m, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const theta = turns * Math.PI * 2 * t;
    const x = r3(pad.l + t * (width - pad.l - pad.r));
    const yA = r3(midY + Math.sin(theta) * amp);
    const yB = r3(midY - Math.sin(theta) * amp);
    const depth = r3((Math.cos(theta) + 1) / 2);
    const role = roleOf(m);
    const color = role ? ROLE_COLORS[role] : NUCLEOTIDES[i % 4];
    const vol = m.trading?.volume_24h_usd ?? 0;
    const sizeBoost = r3(volScale(vol));
    return { m, x, yA, yB, depth, role, color, t, sizeBoost };
  });

  const strandPts = (phase: 0 | 1) => {
    const steps = 160;
    const pts: string[] = [];
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const theta = turns * Math.PI * 2 * t + (phase ? Math.PI : 0);
      const x = pad.l + t * (width - pad.l - pad.r);
      const y = midY + Math.sin(theta) * amp;
      pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    }
    return pts.join(" ");
  };

  const firstLabel = new Date(sorted[0].created_at).toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric" }
  );
  const lastLabel = new Date(
    sorted[sorted.length - 1].created_at
  ).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const hovered = hover !== null ? items[hover] : null;

  // 10 equally-spaced time ticks across the axis, hairline.
  const ticks = Array.from({ length: 9 }, (_, i) => (i + 1) / 10);

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full select-none"
        aria-label="DNA family genome"
      >
        <defs>
          <linearGradient id="gen-a" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-helix-a)" stopOpacity="0.15" />
            <stop offset="50%" stopColor="var(--color-helix-a)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--color-helix-c)" stopOpacity="0.15" />
          </linearGradient>
          <linearGradient id="gen-b" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-helix-b)" stopOpacity="0.15" />
            <stop offset="50%" stopColor="var(--color-helix-c)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--color-helix-b)" stopOpacity="0.15" />
          </linearGradient>
          <radialGradient id="bg-halo" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stopColor="var(--color-helix-a)" stopOpacity="0.08" />
            <stop offset="60%" stopColor="var(--color-helix-b)" stopOpacity="0.04" />
            <stop offset="100%" stopColor="transparent" stopOpacity="0" />
          </radialGradient>
          <filter id="soft-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Ambient halo */}
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill="url(#bg-halo)"
        />

        {/* Center axis + ticks */}
        <line
          x1={pad.l}
          y1={midY}
          x2={width - pad.r}
          y2={midY}
          stroke="rgba(255,255,255,0.05)"
          strokeDasharray="1 3"
        />
        {ticks.map((t, i) => {
          const x = r3(pad.l + t * (width - pad.l - pad.r));
          return (
            <line
              key={i}
              x1={x}
              y1={midY - 4}
              x2={x}
              y2={midY + 4}
              stroke="rgba(255,255,255,0.08)"
            />
          );
        })}

        {/* Phosphate backbones */}
        {backbone && (
          <>
            <polyline
              points={strandPts(0)}
              fill="none"
              stroke="url(#gen-a)"
              strokeWidth={1.8}
              strokeLinecap="round"
              filter="url(#soft-glow)"
            />
            <polyline
              points={strandPts(1)}
              fill="none"
              stroke="url(#gen-b)"
              strokeWidth={1.8}
              strokeLinecap="round"
              filter="url(#soft-glow)"
            />
          </>
        )}

        {/* Base pairs */}
        {items.map((it, i) => {
          const active = hover === i;
          const baseR = it.role ? 4.2 : 2.6;
          const boost = 1.6 * it.sizeBoost;
          const r = r3(baseR + boost + (active ? 2.5 : 0));
          return (
            <g
              key={i}
              opacity={active ? 1 : 0.55 + it.depth * 0.45}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: "pointer" }}
            >
              <line
                x1={it.x}
                y1={it.yA}
                x2={it.x}
                y2={it.yB}
                stroke={it.color}
                strokeWidth={it.role ? 2 : 1}
                strokeOpacity={active ? 0.9 : 0.35}
              />
              {it.role && (
                <circle
                  cx={it.x}
                  cy={it.yA}
                  r={r3(r + 5)}
                  fill={it.color}
                  opacity={active ? 0.35 : 0.2}
                  filter="url(#soft-glow)"
                />
              )}
              <circle
                cx={it.x}
                cy={it.yA}
                r={r}
                fill={it.color}
                stroke={active ? "#fff" : "transparent"}
                strokeWidth={active ? 1.5 : 0}
              />
              <circle
                cx={it.x}
                cy={it.yB}
                r={r3(r * 0.92)}
                fill={it.color}
                opacity={0.8}
                stroke={active ? "#fff" : "transparent"}
                strokeWidth={active ? 1.2 : 0}
              />
              {/* Invisible hit column */}
              <rect
                x={r3(it.x - Math.max(3, stepX / 2))}
                y={pad.t}
                width={r3(Math.max(6, stepX))}
                height={r3(height - pad.t - pad.b)}
                fill="transparent"
              />
            </g>
          );
        })}

        {/* Hover crosshair */}
        {hovered && (
          <line
            x1={hovered.x}
            y1={pad.t}
            x2={hovered.x}
            y2={height - pad.b}
            stroke="rgba(255,255,255,0.14)"
            strokeDasharray="2 3"
          />
        )}

        {/* Timestamp rail */}
        <text
          x={pad.l}
          y={height - 10}
          fontSize={10}
          fill="rgba(255,255,255,0.4)"
          fontFamily="ui-monospace, SFMono-Regular, Menlo"
        >
          {firstLabel}
        </text>
        <text
          x={(pad.l + width - pad.r) / 2}
          y={height - 10}
          fontSize={9}
          textAnchor="middle"
          fill="rgba(255,255,255,0.22)"
          fontFamily="ui-monospace, SFMono-Regular, Menlo"
        >
          chronological axis · left = older · right = newer
        </text>
        <text
          x={width - pad.r}
          y={height - 10}
          fontSize={10}
          textAnchor="end"
          fill="rgba(255,255,255,0.4)"
          fontFamily="ui-monospace, SFMono-Regular, Menlo"
        >
          {lastLabel}
        </text>
      </svg>

      {hovered && (
        <HoverCard
          mutation={hovered.m}
          xFrac={(hovered.x - pad.l) / (width - pad.l - pad.r)}
        />
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-400)]">
        <LegendDot color="var(--color-strain-origin)" label="origin" />
        <LegendDot color="var(--color-strain-dominant)" label="dominant" />
        <LegendDot color="var(--color-strain-fastest)" label="fastest" />
        <span className="text-[var(--color-ink-500)]">
          · base size ∝ 24h volume · {n.toLocaleString("en-US")} base pairs ·{" "}
          {turns.toFixed(1)} turns
        </span>
      </div>
    </div>
  );
}

function HoverCard({
  mutation,
  xFrac,
}: {
  mutation: Mutation;
  xFrac: number;
}) {
  const left = `${Math.max(0, Math.min(1, xFrac)) * 100}%`;
  return (
    <Link
      href={`/mutation/${mutation.token_address}`}
      className="pointer-events-auto absolute top-1 z-10 -translate-x-1/2 rounded-xl border border-white/10 bg-[var(--color-ink-950)]/95 p-3 text-[11px] text-white shadow-2xl ring-1 ring-white/5 backdrop-blur transition-colors hover:border-[var(--color-helix-a)]/40 hover:bg-[var(--color-ink-900)]"
      style={{ left }}
    >
      <div className="flex items-center gap-2">
        <div className="grid h-8 w-8 place-items-center rounded-md bg-gradient-to-br from-[var(--color-helix-a)]/25 to-[var(--color-helix-b)]/20 font-mono text-[10px] font-bold text-white ring-1 ring-white/10">
          {(mutation.symbol || "?").slice(0, 3).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">
            {mutation.symbol || "Unnamed"}
          </div>
          <div className="truncate text-[10px] text-[var(--color-ink-400)]">
            {mutation.name}
          </div>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
        <KV
          label="Vol"
          value={formatUsd(mutation.trading?.volume_24h_usd, { compact: true })}
        />
        <KV label="Px" value={formatPrice(mutation.trading?.price_usd)} />
        <KV
          label="Liq"
          value={formatUsd(mutation.trading?.liquidity_usd, { compact: true })}
        />
        <KV label="Born" value={timeAgo(mutation.created_at)} />
      </div>
      <div className="mt-2 font-mono text-[9px] text-[var(--color-ink-500)]">
        {shortAddress(mutation.token_address, 6, 4)} → open ↗
      </div>
    </Link>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 font-mono">
      <span className="uppercase text-[9px] tracking-[0.14em] text-[var(--color-ink-400)]">
        {label}
      </span>
      <span className="truncate">{value}</span>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: color, boxShadow: `0 0 10px ${color}` }}
      />
      {label}
    </span>
  );
}
