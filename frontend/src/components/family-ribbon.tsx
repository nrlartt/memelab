import Link from "next/link";
import type { DnaFamily } from "@/lib/types";
import { formatNumber, formatUsd } from "@/lib/format";

/**
 * Horizontal "DNA ribbon" - each family becomes one base-pair on a
 * wavy helix strand. Segment height ∝ log(mutation count), color is
 * quartile-bucketed across the actual evolution-score distribution,
 * and the strand itself rides a sine wave so the whole thing reads
 * as a living chromosome rather than a plain bar chart.
 *
 * Clickable per segment · rounded 3dp for stable SSR hydration.
 */
export function FamilyRibbon({ families }: { families: DnaFamily[] }) {
  const rows = [...(families || [])]
    .filter((f) => f.mutations_count > 0)
    .sort(
      (a, b) =>
        b.total_volume_usd - a.total_volume_usd ||
        b.mutations_count - a.mutations_count,
    )
    .slice(0, 48);

  if (rows.length === 0) return null;

  const width = 1400;
  const height = 150;
  const pad = { l: 24, r: 24, t: 18, b: 30 };

  const mutMax = Math.max(1, ...rows.map((r) => r.mutations_count));
  const r3 = (v: number) => Math.round(v * 1000) / 1000;

  // Quantile buckets across actual distribution so every family
  // doesn't collapse into the "viral" color.
  const sortedEvo = [...rows.map((r) => r.evolution_score)].sort((a, b) => a - b);
  const quantile = (p: number) =>
    sortedEvo[Math.min(sortedEvo.length - 1, Math.floor(p * (sortedEvo.length - 1)))] || 0;
  const q33 = quantile(0.33);
  const q66 = quantile(0.66);
  const q90 = quantile(0.9);

  type Bucket = "cold" | "warm" | "hot" | "viral";
  const bucketOf = (score: number): Bucket => {
    if (score >= q90) return "viral";
    if (score >= q66) return "hot";
    if (score >= q33) return "warm";
    return "cold";
  };
  const GRADIENTS: Record<Bucket, string> = {
    cold: "url(#rb-g-cold)",
    warm: "url(#rb-g-warm)",
    hot: "url(#rb-g-hot)",
    viral: "url(#rb-g-viral)",
  };
  const GLOW: Record<Bucket, string> = {
    cold: "var(--color-helix-b)",
    warm: "var(--color-helix-a)",
    hot: "var(--color-helix-d)",
    viral: "var(--color-helix-c)",
  };

  const stepX = (width - pad.l - pad.r) / rows.length;

  // Sine-wave baseline - the strand itself undulates so the ribbon
  // reads as a DNA helix section rather than a bar chart.
  const midY = height / 2;
  const waveAmp = 10;
  const yBase = (i: number) =>
    midY + Math.sin((i / rows.length) * Math.PI * 3) * waveAmp;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/5 bg-[var(--color-ink-950)]/70 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[9px] uppercase tracking-[0.24em] text-[var(--color-helix-c)]">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-helix-c)]" />
            DNA Ribbon
          </div>
          <h3 className="mt-3 text-lg font-semibold tracking-tight text-white sm:text-xl">
            Top 48 families, woven into a single chromosome
          </h3>
          <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-[var(--color-ink-400)]">
            Each base-pair is a family · height ∝ log(mutations) · color
            bucket ∝ evolution-score quartile · strand itself undulates so
            the story reads left-to-right.
          </p>
        </div>
        <div className="hidden gap-2 text-[9px] uppercase tracking-[0.14em] text-[var(--color-ink-400)] md:flex">
          <LegendDot color={GLOW.cold} label="cold" />
          <LegendDot color={GLOW.warm} label="warm" />
          <LegendDot color={GLOW.hot} label="hot" />
          <LegendDot color={GLOW.viral} label="viral" />
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mt-4 w-full"
        aria-label="Family ribbon"
      >
        <defs>
          <linearGradient id="rb-strand" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-helix-a)" stopOpacity="0.6" />
            <stop offset="50%" stopColor="var(--color-helix-b)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--color-helix-c)" stopOpacity="0.6" />
          </linearGradient>
          <linearGradient id="rb-g-cold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-helix-b)" stopOpacity="1" />
            <stop offset="100%" stopColor="var(--color-helix-b)" stopOpacity="0.35" />
          </linearGradient>
          <linearGradient id="rb-g-warm" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-helix-a)" stopOpacity="1" />
            <stop offset="100%" stopColor="var(--color-helix-b)" stopOpacity="0.4" />
          </linearGradient>
          <linearGradient id="rb-g-hot" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-helix-d)" stopOpacity="1" />
            <stop offset="100%" stopColor="var(--color-helix-a)" stopOpacity="0.4" />
          </linearGradient>
          <linearGradient id="rb-g-viral" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-helix-c)" stopOpacity="1" />
            <stop offset="100%" stopColor="var(--color-helix-d)" stopOpacity="0.4" />
          </linearGradient>
        </defs>

        {/* Upper + lower strand pair (classic dna double helix) */}
        <path
          d={strandPath(rows.length, pad.l, width - pad.r, midY, waveAmp, -6)}
          fill="none"
          stroke="url(#rb-strand)"
          strokeWidth={1.1}
        />
        <path
          d={strandPath(rows.length, pad.l, width - pad.r, midY, waveAmp, 6)}
          fill="none"
          stroke="url(#rb-strand)"
          strokeWidth={1.1}
        />

        {rows.map((f, i) => {
          const x = r3(pad.l + stepX * i + stepX / 2);
          const bucket = bucketOf(f.evolution_score);
          const fill = GRADIENTS[bucket];
          const glow = GLOW[bucket];
          const h = r3(
            22 +
              (Math.log10(f.mutations_count + 1) / Math.log10(mutMax + 1)) *
                (height - pad.t - pad.b),
          );
          const yCenter = yBase(i);
          const y1 = r3(yCenter - h / 2);
          const y2 = r3(yCenter + h / 2);
          const w = Math.max(3, stepX * 0.58);
          const viral = bucket === "viral";

          return (
            <a key={f.id} href={`/family/${f.id}`} aria-label={f.event_title}>
              {/* Soft halo for hot/viral segments */}
              {(bucket === "hot" || viral) && (
                <rect
                  x={r3(x - w / 2 - 2)}
                  y={r3(y1 - 4)}
                  width={r3(w + 4)}
                  height={r3(y2 - y1 + 8)}
                  rx={3}
                  fill={glow}
                  opacity={0.18}
                />
              )}
              {/* Main base-pair */}
              <rect
                x={r3(x - w / 2)}
                y={y1}
                width={r3(w)}
                height={r3(y2 - y1)}
                rx={2}
                fill={fill}
                stroke="rgba(255,255,255,0.12)"
                strokeWidth={0.5}
              >
                {viral && (
                  <animate
                    attributeName="opacity"
                    values="0.95;0.55;0.95"
                    dur="2.4s"
                    repeatCount="indefinite"
                  />
                )}
                <title>
                  {`${f.event_title} - ${formatNumber(f.mutations_count)} mutations · ${formatUsd(f.total_volume_usd, { compact: true })} · evo ${f.evolution_score.toFixed(1)}`}
                </title>
              </rect>
              {/* Top-end cap dot - gives each rung a nucleotide-like head */}
              <circle cx={x} cy={y1} r={1.6} fill={glow} opacity={0.9} />
              <circle cx={x} cy={y2} r={1.6} fill={glow} opacity={0.9} />
            </a>
          );
        })}

        {/* Rank ticks every 8 segments */}
        {rows.map((_, i) => {
          if (i % 8 !== 0 && i !== rows.length - 1) return null;
          const x = r3(pad.l + stepX * i + stepX / 2);
          return (
            <text
              key={`tk-${i}`}
              x={x}
              y={height - 6}
              textAnchor="middle"
              fontSize={9}
              fill="rgba(255,255,255,0.35)"
              fontFamily="ui-monospace, SFMono-Regular, Menlo"
            >
              #{i + 1}
            </text>
          );
        })}
      </svg>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-500)]">
        <span>top 48 families · sorted by 24h volume</span>
        <Link
          href="/families?sort=volume"
          className="text-[var(--color-ink-300)] transition-colors hover:text-[var(--color-helix-c)]"
        >
          Browse every family →
        </Link>
      </div>
    </div>
  );
}

function strandPath(
  n: number,
  xL: number,
  xR: number,
  midY: number,
  amp: number,
  offset: number,
): string {
  // Sample 64 points along the sine wave shifted by `offset` so the
  // two strands ride parallel but visibly separated.
  const STEPS = 64;
  const pts: string[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const x = xL + (xR - xL) * t;
    const y = midY + Math.sin(t * Math.PI * 3) * amp + offset;
    pts.push(`${i === 0 ? "M" : "L"} ${x.toFixed(3)} ${y.toFixed(3)}`);
  }
  return pts.join(" ");
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      />
      {label}
    </span>
  );
}
