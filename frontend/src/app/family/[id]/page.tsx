import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Clock,
  Dna,
  ExternalLink,
  GitBranch,
  TrendingUp,
} from "lucide-react";
import { api } from "@/lib/api";
import { AIPanel } from "@/components/ai-panel";
import { ConfidenceRing } from "@/components/confidence-ring";
import { StrainBadge } from "@/components/strain-badge";
import { CenterCard } from "@/components/center-card";
import { EvolutionCurve } from "@/components/evolution-curve";
import { FamilyGenome } from "@/components/family-genome";
import { MutationTable } from "@/components/mutation-row";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatNumber, formatUsd, timeAgo } from "@/lib/format";

type Props = { params: Promise<{ id: string }> };

export default async function FamilyDetailPage({ params }: Props) {
  const { id } = await params;
  let family;
  try {
    family = await api.family(id);
  } catch (e) {
    if (/404/.test((e as Error).message)) notFound();
    throw e;
  }

  const c = family.centers;

  return (
    <div className="page-shell space-y-8">
      <Link
        href="/families"
        className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-300)] hover:text-white"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to DNA Families
      </Link>

      {/* HERO */}
      <section className="relative overflow-hidden rounded-3xl border border-white/5 bg-[var(--color-ink-950)]/70 p-6 sm:p-10">
        <div className="absolute -left-24 -top-24 -z-0 h-96 w-96 rounded-full bg-[var(--color-helix-a)]/8 blur-3xl" />
        <div className="absolute -right-24 top-1/3 -z-0 h-96 w-96 rounded-full bg-[var(--color-helix-b)]/8 blur-3xl" />

        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">
          <div className="flex-shrink-0">
            <ConfidenceRing value={family.confidence_score} size={104} stroke={8} />
          </div>
          <div className="flex-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-[var(--color-ink-300)]">
              <Dna className="h-3 w-3 text-[var(--color-helix-a)]" />
              DNA Family · {family.id}
            </div>
            <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl">
              {family.event_title}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[var(--color-ink-300)] sm:text-base">
              {family.event_summary || "No summary yet."}
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <StrainBadge kind="origin" strain={family.origin_strain} />
              <StrainBadge kind="dominant" strain={family.dominant_strain} />
              <StrainBadge kind="fastest" strain={family.fastest_mutation} />
              {family.onchain_tx_hash && (
                <a
                  href={`https://bscscan.com/tx/${family.onchain_tx_hash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Badge variant="good" className="gap-1">
                    on-chain anchored <ExternalLink className="h-3 w-3" />
                  </Badge>
                </a>
              )}
            </div>

            <dl className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <KPI
                label="Mutations"
                value={formatNumber(family.mutations_count)}
                icon={<GitBranch className="h-3.5 w-3.5 text-[var(--color-helix-a)]" />}
              />
              <KPI
                label="Evolution"
                value={family.evolution_score.toFixed(2)}
                icon={<TrendingUp className="h-3.5 w-3.5 text-[var(--color-helix-c)]" />}
              />
              <KPI
                label="Total volume"
                value={formatUsd(family.total_volume_usd, { compact: true })}
              />
              <KPI
                label="First seen"
                value={timeAgo(family.first_seen_at)}
                hint={new Date(family.first_seen_at).toLocaleString("en-US")}
                icon={<Clock className="h-3.5 w-3.5 text-[var(--color-ink-400)]" />}
              />
            </dl>
          </div>
        </div>
      </section>

      {/* 2D GENOME VISUALIZATION */}
      <section>
        <SectionHeader
          title="Family Genome"
          description="Every mutation rendered as a base pair along the DNA helix, time-ordered left → right. Base size scales with 24h volume. Hover for stats, click to open the mutation detail."
        />
        <Card>
          <FamilyGenome
            mutations={family.mutations}
            backbone={family.mutations.length < 300}
          />
        </Card>
      </section>

      {/* FOUR CENTERS + EVOLUTION side by side */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <SectionHeader
            title="Four Event Centers"
            description="Every real-world event has four centers. MemeLab extracts them from token signals plus web research."
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <CenterCard kind="source" value={c.source_center} url={c.source_url} />
            <CenterCard kind="entity" value={c.entity_center} />
            <CenterCard kind="geo" value={c.geo_center} />
            <CenterCard kind="community" value={c.community_center} />
          </div>
        </div>
        <div className="xl:col-span-2">
          <SectionHeader
            title="Evolution Curve"
            description="Mutation count over time. Steep slopes signal a viral narrative."
          />
          <Card className="h-full">
            <EvolutionCurve points={family.evolution_curve} metric="mutations" />
          </Card>
        </div>
      </section>

      {/* AI DECISION LOG */}
      <section>
        <SectionHeader
          title="How MemeLab thinks"
          description="The reasoning MemeLab produced while deciding this is one event, plus every AI provider that touched the family."
        />
        <AIPanel ai={family.ai} confidence={family.confidence_score} />
      </section>

      {/* MUTATIONS */}
      <section>
        <SectionHeader
          title={`Mutations · ${formatNumber(family.mutations_count)}`}
          description="All Four.Meme tokens assigned to this DNA Family."
        />
        {family.mutations.length === 0 ? (
          <Card>
            <div className="text-sm text-[var(--color-ink-400)]">
              No mutations yet.
            </div>
          </Card>
        ) : (
          <MutationTable mutations={family.mutations} />
        )}
      </section>
    </div>
  );
}

function SectionHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="mb-4">
      <h2 className="text-lg font-semibold tracking-tight text-white">{title}</h2>
      <p className="mt-0.5 text-xs text-[var(--color-ink-400)]">{description}</p>
    </header>
  );
}

function KPI({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-400)]">
        {icon}
        {label}
      </div>
      <div className="mt-1 font-mono text-xl font-semibold tracking-tight text-white">
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-[10px] text-[var(--color-ink-500)]">
          {hint}
        </div>
      )}
    </div>
  );
}
