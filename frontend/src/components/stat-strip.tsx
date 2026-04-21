import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export type Stat = {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  accent?: "helix-a" | "helix-b" | "helix-c" | "helix-d";
};

const ACCENTS: Record<NonNullable<Stat["accent"]>, string> = {
  "helix-a": "text-[var(--color-helix-a)]",
  "helix-b": "text-[var(--color-helix-b)]",
  "helix-c": "text-[var(--color-helix-c)]",
  "helix-d": "text-[var(--color-helix-d)]",
};

export function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((s) => {
        const Icon = s.icon;
        return (
          <div
            key={s.label}
            className="glass rounded-xl p-4 transition-colors hover:bg-white/[0.04]"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-400)]">
                {s.label}
              </span>
              <Icon
                className={cn(
                  "h-3.5 w-3.5",
                  s.accent ? ACCENTS[s.accent] : "text-[var(--color-ink-400)]"
                )}
              />
            </div>
            <div className="mt-2 font-mono text-2xl font-semibold tracking-tight text-white">
              {s.value}
            </div>
            {s.hint && (
              <div className="mt-1 text-[11px] text-[var(--color-ink-400)]">
                {s.hint}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
