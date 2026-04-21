import { cn } from "@/lib/cn";

export function ConfidenceRing({
  value,
  size = 56,
  stroke = 5,
  className,
  label = "conf",
}: {
  value: number;
  size?: number;
  stroke?: number;
  className?: string;
  label?: string;
}) {
  const v = Math.max(0, Math.min(1, value));
  const r = (size - stroke) / 2;
  // Round to 3 decimals so SSR/CSR hydration agrees on the string form of
  // this irrational number.
  const C = Math.round(2 * Math.PI * r * 1000) / 1000;
  const offset = Math.round(C * (1 - v) * 1000) / 1000;
  const hue =
    v >= 0.8
      ? "var(--color-helix-a)"
      : v >= 0.55
        ? "var(--color-helix-c)"
        : v >= 0.3
          ? "var(--color-helix-d)"
          : "var(--color-bad)";
  return (
    <div
      className={cn("relative grid place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={hue}
          strokeWidth={stroke}
          strokeDasharray={C}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 500ms ease-out" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center leading-none">
        <span className="text-[12px] font-semibold tabular-nums text-white">
          {Math.round(v * 100)}
          <span className="text-[8px] text-[var(--color-ink-400)]">%</span>
        </span>
        <span className="text-[8px] uppercase tracking-[0.18em] text-[var(--color-ink-400)]">
          {label}
        </span>
      </div>
    </div>
  );
}
