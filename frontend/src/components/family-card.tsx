import Link from "next/link";
import { ArrowUpRight, GitBranch, Clock, TrendingUp } from "lucide-react";
import { ConfidenceRing } from "./confidence-ring";
import { StrainBadge } from "./strain-badge";
import { Sparkline } from "./sparkline";
import { formatUsd, formatNumber, timeAgo } from "@/lib/format";
import type { DnaFamily } from "@/lib/types";

export function FamilyCard({ family, rank }: { family: DnaFamily; rank?: number }) {
  const spark = family.evolution_spark ?? [];
  const last = spark[spark.length - 1] ?? 0;
  const prev = spark[spark.length - 2] ?? last;
  const delta = last - prev;
  const deltaLabel =
    spark.length >= 2
      ? delta > 0
        ? `+${formatNumber(delta)} vs prev bucket`
        : delta < 0
        ? `${formatNumber(delta)} vs prev bucket`
        : "flat vs prev"
      : "cold-start";

  return (
    <Link
      href={`/family/${family.id}`}
      className="group relative block"
      aria-label={`Open DNA Family ${family.event_title}`}
    >
      <article className="border-gradient relative flex h-full flex-col gap-4 rounded-2xl bg-[var(--color-ink-900)]/80 p-5 transition-all duration-300 group-hover:-translate-y-0.5 group-hover:shadow-[0_30px_80px_-40px_rgba(94,247,209,0.25)]">
        {typeof rank === "number" && (
          <span className="absolute right-5 top-5 font-mono text-[10px] tracking-widest text-[var(--color-ink-400)]">
            #{String(rank).padStart(2, "0")}
          </span>
        )}
        <header className="flex items-start gap-4">
          <ConfidenceRing value={family.confidence_score} />
          <div className="min-w-0 flex-1 pr-8">
            <h3 className="line-clamp-1 text-base font-semibold leading-snug text-white">
              {family.event_title}
            </h3>
            <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-[var(--color-ink-300)]">
              {family.event_summary || "No summary yet."}
            </p>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-1.5">
          <StrainBadge kind="origin" strain={family.origin_strain} compact />
          <StrainBadge kind="dominant" strain={family.dominant_strain} compact />
          <StrainBadge kind="fastest" strain={family.fastest_mutation} compact />
        </div>

        <div className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-2.5 ring-1 ring-white/5">
          <div>
            <div className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-400)]">
              <TrendingUp className="h-3 w-3 text-[var(--color-helix-c)]" />
              Evolution
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-[var(--color-ink-300)]">
              {deltaLabel}
            </div>
          </div>
          <Sparkline points={spark} width={96} height={26} />
        </div>

        <dl className="grid grid-cols-3 gap-3 border-t border-white/5 pt-4 text-xs">
          <Stat
            label="Mutations"
            value={formatNumber(family.mutations_count)}
            icon={<GitBranch className="h-3 w-3 text-[var(--color-helix-a)]" />}
          />
          <Stat
            label="Volume"
            value={formatUsd(family.total_volume_usd, { compact: true })}
          />
          <Stat
            label="Last seen"
            value={timeAgo(family.last_seen_at)}
            icon={<Clock className="h-3 w-3 text-[var(--color-ink-400)]" />}
          />
        </dl>

        <div className="absolute right-5 bottom-5 opacity-0 transition-opacity group-hover:opacity-100">
          <ArrowUpRight className="h-4 w-4 text-[var(--color-helix-a)]" />
        </div>
      </article>
    </Link>
  );
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-400)]">
        {icon}
        {label}
      </dt>
      <dd className="font-mono text-[13px] font-medium tabular-nums text-[var(--color-ink-100)]">
        {value}
      </dd>
    </div>
  );
}
