"use client";

import * as React from "react";
import type { MutationWithFamily } from "@/lib/types";

type Axis = { key: string; label: string; value: number; raw: string };

function log10Norm(v: number, max: number): number {
  if (v <= 0) return 0;
  const lv = Math.log10(v + 1);
  const lm = Math.log10(max + 1);
  return Math.max(0, Math.min(1, lv / lm));
}

/**
 * "Gene expression" fingerprint for a single mutation.
 *
 * A 6-axis radar that compresses every signal we have on a token into one
 * glanceable shape. The user can compare two shapes side-by-side to feel
 * the difference between an origin strain (young, low vol, curve-fresh)
 * and the dominant strain (migrated, liquid, older).
 *
 * Axes (all log-normalized to 0..1):
 *   - volume 24h         (DEX activity)
 *   - liquidity          (market depth)
 *   - price              (per-token price)
 *   - trades 24h         (tx count)
 *   - bonding progress   (0..1 already)
 *   - age                (hours since launch, capped)
 */
export function MutationFingerprint({
  mutation,
  size = 260,
}: {
  mutation: MutationWithFamily;
  size?: number;
}) {
  const t = mutation.trading;
  const now = Date.now();
  const ageHours = Math.max(
    0,
    (now - new Date(mutation.created_at).getTime()) / 3_600_000
  );

  const axes: Axis[] = [
    {
      key: "volume",
      label: "Volume",
      value: log10Norm(t?.volume_24h_usd ?? 0, 1_000_000),
      raw: `$${(t?.volume_24h_usd ?? 0).toLocaleString(undefined, {
        maximumFractionDigits: 0,
      })}`,
    },
    {
      key: "liquidity",
      label: "Liquidity",
      value: log10Norm(t?.liquidity_usd ?? 0, 500_000),
      raw: `$${(t?.liquidity_usd ?? 0).toLocaleString(undefined, {
        maximumFractionDigits: 0,
      })}`,
    },
    {
      key: "trades",
      label: "Trades",
      value: log10Norm(t?.trades_24h ?? 0, 10_000),
      raw: `${(t?.trades_24h ?? 0).toLocaleString("en-US")}`,
    },
    {
      key: "bonding",
      label: "Bonding",
      value: Math.max(0, Math.min(1, mutation.bonding_progress ?? 0)),
      raw: `${Math.round((mutation.bonding_progress ?? 0) * 100)}%`,
    },
    {
      key: "price",
      label: "Price",
      value: log10Norm(t?.price_usd ?? 0, 1),
      raw:
        (t?.price_usd ?? 0) >= 1
          ? `$${(t?.price_usd ?? 0).toFixed(2)}`
          : `$${(t?.price_usd ?? 0).toPrecision(3)}`,
    },
    {
      key: "age",
      label: "Age",
      value: Math.max(0, Math.min(1, ageHours / (24 * 30))),
      raw: ageHours < 24 ? `${ageHours.toFixed(1)}h` : `${(ageHours / 24).toFixed(1)}d`,
    },
  ];

  const n = axes.length;
  const cx = size / 2;
  const cy = size / 2;
  const rMax = size / 2 - 32;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;

  const angle = (i: number) => (-Math.PI / 2) + (i / n) * 2 * Math.PI;
  const point = (i: number, v: number) => ({
    x: r3(cx + Math.cos(angle(i)) * rMax * v),
    y: r3(cy + Math.sin(angle(i)) * rMax * v),
  });

  const rings = [0.2, 0.4, 0.6, 0.8, 1.0];
  const [hover, setHover] = React.useState<number | null>(null);

  const dataPts = axes.map((a, i) => point(i, a.value));
  const pathD =
    dataPts
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
      .join(" ") + " Z";

  return (
    <div className="flex flex-col items-center gap-2">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        className="select-none"
      >
        <defs>
          <radialGradient id="fp-bg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--color-helix-a)" stopOpacity="0.15" />
            <stop offset="100%" stopColor="var(--color-helix-a)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="fp-data" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-helix-a)" />
            <stop offset="100%" stopColor="var(--color-helix-c)" />
          </linearGradient>
        </defs>

        <circle cx={cx} cy={cy} r={rMax} fill="url(#fp-bg)" />
        {rings.map((r) => (
          <circle
            key={r}
            cx={cx}
            cy={cy}
            r={r3(rMax * r)}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeDasharray={r < 1 ? "2 4" : undefined}
          />
        ))}
        {axes.map((_, i) => {
          const p = point(i, 1);
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={p.x}
              y2={p.y}
              stroke="rgba(255,255,255,0.08)"
            />
          );
        })}

        {/* Data polygon */}
        <path
          d={pathD}
          fill="url(#fp-data)"
          fillOpacity={0.35}
          stroke="var(--color-helix-a)"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
        {dataPts.map((p, i) => (
          <g
            key={i}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <circle
              cx={p.x}
              cy={p.y}
              r={hover === i ? 5 : 3}
              fill="var(--color-helix-a)"
              stroke="var(--color-ink-950)"
              strokeWidth={1.5}
            />
          </g>
        ))}

        {/* Axis labels */}
        {axes.map((a, i) => {
          const lp = point(i, 1.18);
          return (
            <text
              key={a.key}
              x={lp.x}
              y={lp.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={10}
              fontFamily="ui-monospace, SFMono-Regular, Menlo"
              fill={
                hover === i
                  ? "#fff"
                  : "rgba(255,255,255,0.55)"
              }
              className="uppercase"
            >
              {a.label}
            </text>
          );
        })}
      </svg>

      <div className="grid w-full grid-cols-3 gap-x-3 gap-y-1 text-[10px] text-[var(--color-ink-400)] sm:grid-cols-6">
        {axes.map((a, i) => (
          <div
            key={a.key}
            className={[
              "flex flex-col items-center text-center transition-colors",
              hover === i ? "text-white" : "",
            ].join(" ")}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="uppercase tracking-[0.14em]">{a.label}</span>
            <span className="mt-0.5 font-mono text-[11px] text-[var(--color-ink-100)]">
              {a.raw}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
