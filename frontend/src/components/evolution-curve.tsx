"use client";

import * as React from "react";
import type { EvolutionPoint } from "@/lib/types";

type Props = {
  points: EvolutionPoint[];
  metric?: "mutations" | "volume_usd";
  height?: number;
};

export function EvolutionCurve({
  points,
  metric = "mutations",
  height = 180,
}: Props) {
  const [hover, setHover] = React.useState<number | null>(null);
  const width = 720;
  const pad = { l: 36, r: 12, t: 14, b: 22 };

  if (!points || points.length === 0) {
    return (
      <div className="flex h-[180px] items-center justify-center rounded-xl border border-dashed border-white/10 text-xs text-[var(--color-ink-400)]">
        no evolution data yet
      </div>
    );
  }

  const ys = points.map((p) => Number(p[metric] ?? 0));
  const yMax = Math.max(1, ...ys);
  const xs = points.map((p) => new Date(p.t).getTime());
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const xSpan = Math.max(1, xMax - xMin);

  const x = (t: number) =>
    pad.l + ((t - xMin) / xSpan) * (width - pad.l - pad.r);
  const y = (v: number) =>
    height - pad.b - (v / yMax) * (height - pad.t - pad.b);

  // Force a deterministic precision - Node/Chromium can disagree on the
  // last float bit of trig-derived coordinates which bricks hydration.
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const pts = points.map((p, i) => ({
    x: r2(x(xs[i])),
    y: r2(y(Number(p[metric] ?? 0))),
    raw: p,
  }));

  // Catmull-Rom → cubic Bézier keeps the line smooth without overshooting.
  const linePath = pts
    .map((p, i, arr) => {
      if (i === 0) return `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      const p0 = arr[i - 2] ?? arr[i - 1];
      const p1 = arr[i - 1];
      const p2 = p;
      const p3 = arr[i + 1] ?? p;
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      return `C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(
        1
      )} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    })
    .join(" ");
  const areaPath = `${linePath} L ${pts[pts.length - 1].x.toFixed(1)} ${
    height - pad.b
  } L ${pts[0].x.toFixed(1)} ${height - pad.b} Z`;

  const gridLines = 4;
  const grid = Array.from({ length: gridLines + 1 }, (_, i) => {
    const v = (yMax / gridLines) * i;
    return { y: y(v), label: Math.round(v).toString() };
  });

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
        <defs>
          <linearGradient id="evo-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-helix-a)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--color-helix-a)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="evo-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-helix-a)" />
            <stop offset="100%" stopColor="var(--color-helix-c)" />
          </linearGradient>
        </defs>

        {/* gridlines */}
        {grid.map((g, i) => (
          <g key={i}>
            <line
              x1={pad.l}
              y1={g.y}
              x2={width - pad.r}
              y2={g.y}
              stroke="rgba(255,255,255,0.05)"
              strokeDasharray="2 4"
            />
            <text
              x={pad.l - 6}
              y={g.y + 3}
              textAnchor="end"
              fontSize={9}
              fill="rgba(255,255,255,0.35)"
              fontFamily="ui-monospace, SFMono-Regular, Menlo"
            >
              {g.label}
            </text>
          </g>
        ))}

        <path d={areaPath} fill="url(#evo-area)" />
        <path
          d={linePath}
          fill="none"
          stroke="url(#evo-line)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {hover !== null && (
          <line
            x1={pts[hover].x}
            x2={pts[hover].x}
            y1={pad.t}
            y2={height - pad.b}
            stroke="rgba(94,247,209,0.25)"
            strokeDasharray="3 3"
          />
        )}

        {pts.map((p, i) => (
          <g key={i}>
            <circle
              cx={p.x}
              cy={p.y}
              r={hover === i ? 4.5 : 2.5}
              fill={hover === i ? "#fff" : "var(--color-helix-a)"}
              stroke="var(--color-ink-950)"
              strokeWidth={1}
            />
            <rect
              x={p.x - 14}
              y={pad.t - 6}
              width={28}
              height={height - pad.t - pad.b + 12}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          </g>
        ))}
      </svg>

      {hover !== null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg bg-[var(--color-ink-950)]/90 px-2.5 py-1.5 text-[10px] font-mono text-white shadow-lg ring-1 ring-white/10"
          style={{
            left: `${(pts[hover].x / width) * 100}%`,
            top: `${(pts[hover].y / height) * 100}%`,
          }}
        >
          <div className="text-[9px] uppercase tracking-widest text-[var(--color-ink-400)]">
            {new Date(pts[hover].raw.t).toLocaleString("en-US")}
          </div>
          <div>
            {metric === "mutations"
              ? `${pts[hover].raw.mutations} mutations`
              : `$${Math.round(pts[hover].raw.volume_usd).toLocaleString("en-US")}`}
          </div>
        </div>
      )}
    </div>
  );
}
