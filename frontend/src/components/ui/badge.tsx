import * as React from "react";
import { cn } from "@/lib/cn";

const variants = {
  default:
    "bg-white/5 text-[var(--color-ink-200)] ring-1 ring-white/10",
  origin:
    "bg-[color-mix(in_oklab,var(--color-strain-origin)_18%,transparent)] text-[var(--color-strain-origin)] ring-1 ring-[color-mix(in_oklab,var(--color-strain-origin)_35%,transparent)]",
  dominant:
    "bg-[color-mix(in_oklab,var(--color-strain-dominant)_18%,transparent)] text-[var(--color-strain-dominant)] ring-1 ring-[color-mix(in_oklab,var(--color-strain-dominant)_35%,transparent)]",
  fastest:
    "bg-[color-mix(in_oklab,var(--color-strain-fastest)_18%,transparent)] text-[var(--color-strain-fastest)] ring-1 ring-[color-mix(in_oklab,var(--color-strain-fastest)_35%,transparent)]",
  good: "bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-400/25",
  warn: "bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/25",
  bad: "bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/25",
  muted:
    "bg-white/[0.03] text-[var(--color-ink-400)] ring-1 ring-white/5",
} as const;

export type BadgeVariant = keyof typeof variants;

export function Badge({
  variant = "default",
  className,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-wide",
        variants[variant],
        className
      )}
      {...rest}
    />
  );
}
