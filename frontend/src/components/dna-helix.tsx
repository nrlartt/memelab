"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Pure-CSS/SVG animated double helix.
 *
 * Renders two sinusoidal phosphate strands + N evenly-spaced base pairs
 * (the "rungs"). Colors cycle through the four nucleotide accents so every
 * rung feels alive and slightly different. No external deps; GPU-friendly.
 */
type Props = {
  className?: string;
  /** Number of base-pair rungs (visual density). */
  rungs?: number;
  /** Vertical turns through the helix. Higher = tighter coil. */
  turns?: number;
  height?: number;
  speedSeconds?: number;
};

const RUNG_COLORS = [
  "var(--color-helix-a)",
  "var(--color-helix-b)",
  "var(--color-helix-c)",
  "var(--color-helix-d)",
];

export function DnaHelix({
  className,
  rungs = 22,
  turns = 2.2,
  height = 520,
  speedSeconds = 14,
}: Props) {
  const width = 320;
  const midX = width / 2;
  const amplitude = 90;

  // Rounding to a fixed 3-decimal precision kills hydration mismatches:
  // Node's V8 and the browser's V8 can disagree on the LAST bit of floats
  // (79.50603331002965 vs …66). Forcing a common precision eliminates it.
  const r3 = (n: number) => Math.round(n * 1000) / 1000;

  const strand = (phase: 0 | 1) => {
    const steps = 80;
    const pts: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const theta = turns * Math.PI * 2 * t + (phase ? Math.PI : 0);
      const x = midX + Math.sin(theta) * amplitude;
      const y = t * height;
      pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    }
    return pts.join(" ");
  };

  const rungItems = Array.from({ length: rungs }, (_, i) => {
    const t = i / (rungs - 1);
    const theta = turns * Math.PI * 2 * t;
    const x1 = r3(midX + Math.sin(theta) * amplitude);
    const x2 = r3(midX - Math.sin(theta) * amplitude);
    const y = r3(t * height);
    const depth = r3((Math.cos(theta) + 1) / 2);
    return { x1, x2, y, depth, color: RUNG_COLORS[i % RUNG_COLORS.length] };
  });

  return (
    <div
      className={cn("pointer-events-none select-none", className)}
      aria-hidden
      style={{
        animation: `float-y 7s ease-in-out infinite`,
      }}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        style={{ filter: "drop-shadow(0 20px 60px rgba(94,247,209,0.15))" }}
      >
        <defs>
          <linearGradient id="strandA" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-helix-a)" stopOpacity="0.1" />
            <stop offset="50%" stopColor="var(--color-helix-a)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--color-helix-a)" stopOpacity="0.1" />
          </linearGradient>
          <linearGradient id="strandB" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-helix-b)" stopOpacity="0.1" />
            <stop offset="50%" stopColor="var(--color-helix-c)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--color-helix-b)" stopOpacity="0.1" />
          </linearGradient>
        </defs>

        <g
          style={{
            transformOrigin: `${midX}px ${height / 2}px`,
            animation: `helix-spin ${speedSeconds}s linear infinite`,
          }}
        >
          <polyline
            points={strand(0)}
            fill="none"
            stroke="url(#strandA)"
            strokeWidth={3}
            strokeLinecap="round"
          />
          <polyline
            points={strand(1)}
            fill="none"
            stroke="url(#strandB)"
            strokeWidth={3}
            strokeLinecap="round"
          />
          {rungItems.map((r, i) => (
            <g key={i} opacity={r3(0.35 + r.depth * 0.65)}>
              <line
                x1={r.x1}
                y1={r.y}
                x2={r.x2}
                y2={r.y}
                stroke={r.color}
                strokeWidth={1.5}
                strokeOpacity={0.6}
              />
              <circle cx={r.x1} cy={r.y} r={3.2} fill={r.color} />
              <circle cx={r.x2} cy={r.y} r={3.2} fill={r.color} opacity={0.8} />
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
