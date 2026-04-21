import Link from "next/link";
import type { DnaFamily } from "@/lib/types";
import { formatNumber, formatUsd } from "@/lib/format";

/**
 * "Genome Galaxy" - one helix-node per DNA family, positioned by
 *   x = log(total 24h volume),  y = log(mutation count)
 *   r = mutation count (log),   hue = evolution-score quartile
 *
 * Premium iteration: quantile-based color bucketing (so distribution
 * actually uses the whole ramp instead of flooding into the "viral"
 * color), labelled top-6, semantic volume/mutation ticks, nebula
 * gradient backdrop, animated pulse halos on the top-3, and connecting
 * thin "helix threads" between the hottest families.
 *
 * Pure SSR SVG - every coordinate rounded to 3dp to keep hydration clean.
 */
export function GenomeGalaxy({ families }: { families: DnaFamily[] }) {
  const rows = (families || []).filter((f) => f.mutations_count > 0);
  if (rows.length === 0) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-2xl border border-dashed border-white/10 text-xs text-[var(--color-ink-400)]">
        No families yet - waiting for the next pipeline tick.
      </div>
    );
  }

  const width = 1400;
  const height = 420;
  const pad = { l: 58, r: 48, t: 36, b: 54 };

  const r3 = (v: number) => Math.round(v * 1000) / 1000;

  // Volume axis - always log10 with a semantic max rounded up to a
  // nice value so tick labels read as $10K, $100K, $1M, $2M+.
  const volMax = Math.max(10, ...rows.map((r) => r.total_volume_usd || 0));
  const mutMax = Math.max(1, ...rows.map((r) => r.mutations_count));

  const xOf = (v: number) =>
    r3(pad.l + (Math.log10(v + 1) / Math.log10(volMax + 1)) * (width - pad.l - pad.r));
  const yOf = (m: number) =>
    r3(
      height - pad.b - (Math.log10(m + 1) / Math.log10(mutMax + 1)) * (height - pad.t - pad.b)
    );

  // Quantile buckets across the ACTUAL evolution-score distribution so
  // the palette is always spread evenly across what we have.
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
  const BUCKET_COLOR: Record<Bucket, string> = {
    cold: "var(--color-helix-b)",
    warm: "var(--color-helix-a)",
    hot: "var(--color-helix-d)",
    viral: "var(--color-helix-c)",
  };

  // Top-3 get animated halos AND are connected by a faint helix thread
  // so the viewer's eye has a natural "story of the week" path.
  const ranked = [...rows]
    .sort((a, b) => b.mutations_count - a.mutations_count || b.total_volume_usd - a.total_volume_usd)
    .slice(0, 3);
  const rankedIds = new Set(ranked.map((r) => r.id));

  // The 6 biggest families get printed labels (smart positioning to
  // avoid the most common label collision without full label layout).
  const labelled = [...rows]
    .sort((a, b) => b.mutations_count - a.mutations_count || b.total_volume_usd - a.total_volume_usd)
    .slice(0, 6);

  // Volume tick labels - evenly spaced in log space.
  const volTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const logVal = Math.pow(10, t * Math.log10(volMax + 1)) - 1;
    return { t, label: logVal < 100 ? "$0" : formatUsd(logVal, { compact: true }) };
  });

  // Mutation tick labels - powers of 10.
  const mutTicks = [1, 10, 100, 1000].filter((m) => m <= mutMax);

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/5 bg-[var(--color-ink-950)]/70 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[9px] uppercase tracking-[0.24em] text-[var(--color-helix-a)]">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-helix-a)]" />
            Genome Galaxy
          </div>
          <h3 className="mt-3 text-lg font-semibold tracking-tight text-white sm:text-xl">
            Every DNA family on a single helix map
          </h3>
          <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-[var(--color-ink-400)]">
            Horizontal axis → 24h on-chain volume (log). Vertical axis →
            mutation count (log). Color encodes evolution-score quartile.
            Top-3 families are linked by a live helix thread.
          </p>
        </div>
        <div className="hidden gap-2 text-[9px] uppercase tracking-[0.14em] text-[var(--color-ink-400)] md:flex">
          <LegendDot color={BUCKET_COLOR.cold} label={`cold · ≤${q33.toFixed(0)}`} />
          <LegendDot color={BUCKET_COLOR.warm} label={`warm · ${q33.toFixed(0)}+`} />
          <LegendDot color={BUCKET_COLOR.hot} label={`hot · ${q66.toFixed(0)}+`} />
          <LegendDot color={BUCKET_COLOR.viral} label={`viral · ${q90.toFixed(0)}+`} />
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mt-4 w-full select-none"
        aria-label="Family genome galaxy"
      >
        <defs>
          <radialGradient id="gx-nebula" cx="50%" cy="40%" r="75%">
            <stop offset="0%" stopColor="var(--color-helix-a)" stopOpacity="0.10" />
            <stop offset="50%" stopColor="var(--color-helix-b)" stopOpacity="0.04" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          <radialGradient id="gx-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="white" stopOpacity="0.35" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </radialGradient>
          <filter id="gx-soft" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feComposite in="SourceGraphic" in2="b" operator="over" />
          </filter>
          <filter id="gx-strong" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
          <pattern id="gx-stars" width="14" height="14" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="3" r="0.35" fill="white" opacity="0.18" />
            <circle cx="9" cy="10" r="0.25" fill="white" opacity="0.1" />
          </pattern>
        </defs>

        {/* Nebula backdrop */}
        <rect x={0} y={0} width={width} height={height} fill="url(#gx-nebula)" />
        <rect x={0} y={0} width={width} height={height} fill="url(#gx-stars)" />

        {/* Axes grid - major + minor */}
        {[0.2, 0.4, 0.6, 0.8].map((t) => {
          const x = r3(pad.l + t * (width - pad.l - pad.r));
          return (
            <line
              key={`vg-${t}`}
              x1={x}
              y1={pad.t}
              x2={x}
              y2={height - pad.b}
              stroke="rgba(255,255,255,0.035)"
              strokeDasharray="2 6"
            />
          );
        })}
        {[0.2, 0.4, 0.6, 0.8].map((t) => {
          const y = r3(pad.t + t * (height - pad.t - pad.b));
          return (
            <line
              key={`hg-${t}`}
              x1={pad.l}
              y1={y}
              x2={width - pad.r}
              y2={y}
              stroke="rgba(255,255,255,0.035)"
              strokeDasharray="2 6"
            />
          );
        })}

        {/* Axis frame */}
        <line
          x1={pad.l}
          y1={height - pad.b}
          x2={width - pad.r}
          y2={height - pad.b}
          stroke="rgba(255,255,255,0.12)"
        />
        <line
          x1={pad.l}
          y1={pad.t}
          x2={pad.l}
          y2={height - pad.b}
          stroke="rgba(255,255,255,0.12)"
        />

        {/* Volume axis ticks */}
        {volTicks.map((tk) => {
          const x = r3(pad.l + tk.t * (width - pad.l - pad.r));
          return (
            <g key={`vt-${tk.t}`}>
              <line
                x1={x}
                y1={height - pad.b}
                x2={x}
                y2={height - pad.b + 4}
                stroke="rgba(255,255,255,0.2)"
              />
              <text
                x={x}
                y={height - pad.b + 18}
                textAnchor="middle"
                fontSize={10}
                fill="rgba(255,255,255,0.42)"
                fontFamily="ui-monospace, SFMono-Regular, Menlo"
              >
                {tk.label}
              </text>
            </g>
          );
        })}
        <text
          x={width - pad.r}
          y={height - 10}
          textAnchor="end"
          fontSize={9}
          fill="rgba(255,255,255,0.35)"
          letterSpacing="0.14em"
        >
          24H VOLUME →
        </text>

        {/* Mutation axis ticks */}
        {mutTicks.map((m) => {
          const y = yOf(m);
          return (
            <g key={`mt-${m}`}>
              <line
                x1={pad.l - 4}
                y1={y}
                x2={pad.l}
                y2={y}
                stroke="rgba(255,255,255,0.2)"
              />
              <text
                x={pad.l - 8}
                y={y + 3}
                textAnchor="end"
                fontSize={10}
                fill="rgba(255,255,255,0.42)"
                fontFamily="ui-monospace, SFMono-Regular, Menlo"
              >
                {m}
              </text>
            </g>
          );
        })}
        <text
          x={16}
          y={pad.t + 4}
          fontSize={9}
          fill="rgba(255,255,255,0.35)"
          letterSpacing="0.14em"
          transform={`rotate(-90 16 ${pad.t + 4})`}
        >
          ↑ MUTATIONS
        </text>

        {/* Helix thread connecting the top-3 families. It makes the
            strongest narratives visibly bound. */}
        {ranked.length >= 2 && (
          <g opacity={0.55}>
            {ranked.slice(0, -1).map((a, i) => {
              const b = ranked[i + 1];
              const x1 = xOf(a.total_volume_usd || 0);
              const y1 = yOf(a.mutations_count);
              const x2 = xOf(b.total_volume_usd || 0);
              const y2 = yOf(b.mutations_count);
              const mx = r3((x1 + x2) / 2);
              const my = r3((y1 + y2) / 2 - 18);
              return (
                <path
                  key={`thread-${a.id}-${b.id}`}
                  d={`M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`}
                  fill="none"
                  stroke="var(--color-helix-c)"
                  strokeWidth={0.8}
                  strokeDasharray="3 4"
                />
              );
            })}
          </g>
        )}

        {rows.map((f) => {
          const cx = xOf(f.total_volume_usd || 0);
          const cy = yOf(f.mutations_count);
          const bucket = bucketOf(f.evolution_score);
          const color = BUCKET_COLOR[bucket];
          const isTop = rankedIds.has(f.id);

          // Radius scales with log(mutation count), capped so nothing
          // eats the canvas. Confidence pushes radius up subtly.
          const base =
            3 +
            Math.log10(f.mutations_count + 1) * 3 +
            Math.max(0, Math.min(1, f.confidence_score)) * 2;
          const rBase = Math.min(16, base);

          return (
            <a
              key={f.id}
              href={`/family/${f.id}`}
              aria-label={f.event_title}
              className="gx-node"
            >
              {/* Wide soft halo for everyone */}
              <circle
                cx={cx}
                cy={cy}
                r={r3(rBase + 10)}
                fill={color}
                opacity={0.14}
                filter="url(#gx-strong)"
              />
              {/* Top-3 get a pulsing inner halo */}
              {isTop && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={r3(rBase + 4)}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.2}
                  opacity={0.8}
                >
                  <animate
                    attributeName="r"
                    values={`${r3(rBase + 4)};${r3(rBase + 14)};${r3(rBase + 4)}`}
                    dur="2.6s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    values="0.9;0.1;0.9"
                    dur="2.6s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}
              {/* Core dot */}
              <circle
                cx={cx}
                cy={cy}
                r={r3(rBase)}
                fill={color}
                stroke="rgba(255,255,255,0.55)"
                strokeWidth={0.7}
                className="gx-core"
              />
              {/* Inner highlight so dots feel dimensional */}
              <circle
                cx={r3(cx - rBase * 0.35)}
                cy={r3(cy - rBase * 0.35)}
                r={r3(rBase * 0.35)}
                fill="url(#gx-glow)"
              />
              {/* Collapse to a single text node so SSR and CSR serialise
                  identically. Multi-fragment children inside <title> were
                  producing a hydration mismatch. */}
              <title>
                {`${f.event_title} - ${formatNumber(f.mutations_count)} mutations · ${formatUsd(f.total_volume_usd, { compact: true })} · evo ${f.evolution_score.toFixed(1)}`}
              </title>
            </a>
          );
        })}

        {/* Labels for the top-6 so you can read the story without hover */}
        {labelled.map((f, idx) => {
          const cx = xOf(f.total_volume_usd || 0);
          const cy = yOf(f.mutations_count);
          // Alternate label direction so they don't stack on top of each
          // other when the top tokens happen to cluster on the chart.
          const above = idx % 2 === 0;
          const ly = above ? cy - 14 : cy + 20;
          const anchor = cx > width - pad.r - 140 ? "end" : "start";
          const lx = cx + (anchor === "end" ? -10 : 10);
          const label =
            (f.event_title || "").length > 26
              ? f.event_title.slice(0, 24) + "…"
              : f.event_title;
          return (
            <g key={`lbl-${f.id}`} opacity={0.85}>
              <rect
                x={anchor === "end" ? lx - label.length * 5.2 - 8 : lx - 4}
                y={ly - 11}
                width={label.length * 5.2 + 12}
                height={16}
                rx={4}
                fill="rgba(10,10,20,0.75)"
                stroke="rgba(255,255,255,0.08)"
              />
              <text
                x={lx}
                y={ly + 1}
                textAnchor={anchor}
                fontSize={10.5}
                fill="white"
                fontFamily="ui-sans-serif, system-ui"
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-500)]">
        <span>
          {rows.length.toLocaleString("en-US")} families plotted · top-3 linked ·
          click any node to jump in
        </span>
        <Link
          href="/families?sort=volume"
          className="text-[var(--color-ink-300)] transition-colors hover:text-[var(--color-helix-a)]"
        >
          See the full list →
        </Link>
      </div>
    </div>
  );
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
