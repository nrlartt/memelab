import Link from "next/link";
import { Database, Dna, FlaskConical, Flame } from "lucide-react";
import { Hero } from "@/components/hero";
import { FamilyCard } from "@/components/family-card";
import { FamilyRibbon } from "@/components/family-ribbon";
import { GenomeGalaxy } from "@/components/genome-galaxy";
import { StackStrip } from "@/components/stack-strip";
import { StatStrip, type Stat } from "@/components/stat-strip";
import { api } from "@/lib/api";
import { formatNumber, formatUsd } from "@/lib/format";

export const revalidate = 30;

export default async function Home() {
  let families: Awaited<ReturnType<typeof api.families>> = {
    items: [],
    total: 0,
    limit: 0,
    offset: 0,
  };
  // Volume-sorted top families; useful signal of "what's moving right now".
  let topVolume: Awaited<ReturnType<typeof api.families>> = {
    items: [],
    total: 0,
    limit: 0,
    offset: 0,
  };
  let trending: Awaited<ReturnType<typeof api.trending>> = { items: [] };
  let overview: Awaited<ReturnType<typeof api.overview>> | null = null;
  let error: string | null = null;

  // Separate broad dataset for the galaxy/ribbon visualizations - we want
  // up to ~120 families regardless of the 9-card hero list above.
  let galaxy: Awaited<ReturnType<typeof api.families>> = {
    items: [],
    total: 0,
    limit: 0,
    offset: 0,
  };

  try {
    [families, topVolume, trending, overview, galaxy] = await Promise.all([
        api.families({ limit: 9 }),
        api.families({ limit: 6, sort: "volume" }),
        api.trending(6),
        api.overview().catch(() => null),
        api
          .families({ limit: 120, sort: "volume", min_mutations: 1 })
          .catch(() => galaxy),
      ]);
  } catch (e) {
    error = (e as Error).message;
  }

  const stats: Stat[] = [
    {
      label: "Indexed tokens",
      value: formatNumber(overview?.tokens_total ?? 0),
      hint: "Live Four.Meme universe, always growing",
      icon: Database,
      accent: "helix-a",
    },
    {
      label: "DNA Families",
      value: formatNumber(overview?.families_total ?? families.total),
      hint: "Clustered real-world events",
      icon: Dna,
      accent: "helix-b",
    },
    {
      label: "Mutations",
      value: formatNumber(overview?.mutations_total ?? 0),
      hint: "Tokens placed in families",
      icon: FlaskConical,
      accent: "helix-c",
    },
    {
      label: "24h volume",
      value: formatUsd(overview?.volume_24h_usd ?? 0, { compact: true }),
      hint: `${formatNumber(
        overview?.tokens_with_liquidity ?? 0
      )} tokens with liquidity`,
      icon: Flame,
      accent: "helix-d",
    },
  ];

  const liveStats = [
    {
      label: "Indexed tokens",
      value: formatNumber(overview?.tokens_total ?? 0),
      hint: "growing continuously",
    },
    {
      label: "DNA Families",
      value: formatNumber(overview?.families_total ?? families.total),
      hint: "clustered events",
    },
    {
      label: "Mutations",
      value: formatNumber(overview?.mutations_total ?? 0),
      hint: "on-chain placements",
    },
    {
      label: "24h volume",
      value: formatUsd(overview?.volume_24h_usd ?? 0, { compact: true }),
      hint: "across every family",
    },
  ];

  return (
    <div>
      <Hero liveStats={liveStats} />

      <div className="page-shell space-y-10">
        {error && (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-200">
            <p className="font-semibold">Couldn&apos;t reach the MemeLab API.</p>
            <p className="mt-1 text-rose-300/80">
              Is FastAPI up at <code className="font-mono">{api.base}</code>?
            </p>
          </div>
        )}

        {/* The transparency strip: lets people see exactly what stack is live. */}
        <StackStrip />

        <StatStrip stats={stats} />

        <section className="rounded-2xl border border-[var(--color-helix-a)]/20 bg-gradient-to-br from-[var(--color-helix-a)]/[0.06] to-[var(--color-helix-b)]/[0.04] p-6 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-8">
          <div className="max-w-xl">
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--color-helix-a)]">
              MemeLab AI
            </p>
            <h2 className="mt-2 text-lg font-semibold text-white sm:text-xl">
              Lab Report · AI wallet &amp; token intelligence
            </h2>
            <p className="mt-2 text-sm text-[var(--color-ink-300)]">
              Get a narrative Lab Report with on-chain and web context—connect
              your wallet to unlock the console.
            </p>
          </div>
          <Link
            href="/lab-report"
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[var(--color-helix-a)] to-[var(--color-helix-b)] px-6 py-3 text-sm font-semibold text-[var(--color-ink-950)] shadow-[0_12px_40px_-12px_rgba(94,247,209,0.45)] transition hover:brightness-105 sm:mt-0 sm:shrink-0"
          >
            <FlaskConical className="h-4 w-4" aria-hidden />
            Try Lab Report
          </Link>
        </section>

      {/* Full-ecosystem scatter plot of every family we've clustered. */}
      <section>
        <GenomeGalaxy families={galaxy.items} />
      </section>

      {/* Decorative DNA ribbon for the top families */}
      <section>
        <FamilyRibbon families={galaxy.items} />
      </section>

      <section>
        <header className="mb-5 flex items-end justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-white">
              Highest-volume DNA Families · 24h
            </h2>
            <p className="mt-1 text-sm text-[var(--color-ink-400)]">
              Money-follows-attention ranking. Volume is aggregated from
              DexScreener for every mutation in the family.
            </p>
          </div>
          <Link
            href="/families?sort=volume"
            className="hidden text-xs text-[var(--color-ink-300)] hover:text-white sm:inline-block"
          >
            See all →
          </Link>
        </header>
        {topVolume.items.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {topVolume.items.map((f, i) => (
              <FamilyCard key={f.id} family={f} rank={i + 1} />
            ))}
          </div>
        )}
      </section>

      <section>
        <header className="mb-5 flex items-end justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-white">
              Trending Evolution
            </h2>
            <p className="mt-1 text-sm text-[var(--color-ink-400)]">
              Families with the steepest evolution curve - growing fastest
              right now.
            </p>
          </div>
          <Link
            href="/trending"
            className="hidden text-xs text-[var(--color-ink-300)] hover:text-white sm:inline-block"
          >
            See all →
          </Link>
        </header>
        <TrendingRail items={trending.items} />
      </section>

      <section>
        <header className="mb-5 flex items-end justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-white">
              DNA Families · latest clusters
            </h2>
            <p className="mt-1 text-sm text-[var(--color-ink-400)]">
              Each family groups tokens that all spawned from the same
              real-world event (tweet, news, trend).
            </p>
          </div>
          <Link
            href="/families"
            className="hidden text-xs text-[var(--color-ink-300)] hover:text-white sm:inline-block"
          >
            Browse all →
          </Link>
        </header>
        {families.items.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {families.items.map((f, i) => (
              <FamilyCard key={f.id} family={f} rank={i + 1} />
            ))}
          </div>
        )}
      </section>
      </div>
    </div>
  );
}

function TrendingRail({
  items,
}: {
  items: {
    id: string;
    event_title: string;
    evolution_score: number;
    mutations_count: number;
    total_volume_usd: number;
  }[];
}) {
  if (items.length === 0) {
    return (
      <div className="glass rounded-xl p-4 text-sm text-[var(--color-ink-400)]">
        No trending data yet - waiting for the next pipeline run.
      </div>
    );
  }
  return (
    <div className="scrollbar-slim flex gap-3 overflow-x-auto pb-2">
      {items.map((t, idx) => (
        <Link
          key={t.id}
          href={`/family/${t.id}`}
          className="group flex min-w-[240px] flex-1 flex-col justify-between rounded-xl border border-white/5 bg-[var(--color-ink-900)]/80 p-4 transition-colors hover:border-[var(--color-helix-a)]/30"
        >
          <div className="flex items-start justify-between">
            <span className="font-mono text-[10px] tracking-widest text-[var(--color-ink-400)]">
              #{String(idx + 1).padStart(2, "0")}
            </span>
            <span className="rounded-full bg-[var(--color-helix-a)]/10 px-2 py-0.5 font-mono text-[10px] text-[var(--color-helix-a)]">
              evo {t.evolution_score.toFixed(1)}
            </span>
          </div>
          <div className="mt-3 line-clamp-2 text-sm font-medium leading-snug text-white">
            {t.event_title}
          </div>
          <div className="mt-4 flex items-center justify-between text-[11px] text-[var(--color-ink-400)]">
            <span>{formatNumber(t.mutations_count)} mutations</span>
            <span className="font-mono text-[var(--color-ink-200)]">
              {formatUsd(t.total_volume_usd, { compact: true })}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="glass rounded-2xl p-10 text-center">
      <Dna className="mx-auto mb-3 h-8 w-8 text-[var(--color-helix-a)]" />
      <p className="text-sm text-[var(--color-ink-200)]">
        No DNA Families yet.
      </p>
      <p className="mt-1 text-xs text-[var(--color-ink-400)]">
        Run the pipeline with{" "}
        <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px]">
          python -m scripts.run_pipeline
        </code>{" "}
        to populate the genome.
      </p>
    </div>
  );
}
