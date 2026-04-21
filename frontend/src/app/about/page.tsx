import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Dna,
  FlaskConical,
  GitBranch,
  Layers,
  Network,
  Sparkles,
  Activity,
} from "lucide-react";

export const metadata: Metadata = {
  title: "About MemeLab",
  description:
    "How MemeLab works: live Four.Meme indexing, DNA Families, AI-assisted narratives, and Lab Reports.",
};

export default function AboutPage() {
  return (
    <div className="page-shell space-y-12 pb-16 pt-8">
      <header className="max-w-3xl">
        <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-[var(--color-helix-a)]">
          About
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Meme DNA, decoded live
        </h1>
        <p className="mt-4 text-base leading-relaxed text-[var(--color-ink-300)]">
          MemeLab watches{" "}
          <a
            href="https://four.meme"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--color-helix-a)] hover:underline"
          >
            Four.Meme
          </a>{" "}
          around the clock. New launches are added automatically; the indexed token count
          keeps growing as the ecosystem runs. We group launches into{" "}
          <strong className="text-white">DNA Families</strong> (real-world events),
          classify each token as a <strong className="text-white">mutation</strong>, and
          surface evolution, volume, and (where available) social context with{" "}
          <strong className="text-white">AI-assisted</strong> summaries and reports, not
          raw table dumps.
        </p>
      </header>

      <section className="grid gap-6 lg:grid-cols-3">
        <Spotlight
          icon={<Activity className="h-5 w-5" />}
          title="Always-on indexing"
          body="A scheduled pipeline listens to on-chain launches, market data, and optional research sources so the database reflects a living market, not a one-time snapshot."
        />
        <Spotlight
          icon={<Dna className="h-5 w-5" />}
          title="DNA Families"
          body="Tokens that refer to the same narrative or event are clustered so you can compare strains, volume, and evolution inside one family."
        />
        <Spotlight
          icon={<Bot className="h-5 w-5" />}
          title="AI where it helps"
          body="Machine learning assists grouping and wording; facts still come from on-chain data and configured providers. Nothing here is investment advice."
        />
      </section>

      <section className="rounded-2xl border border-white/10 bg-[var(--color-ink-900)]/50 p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
          <GitBranch className="h-5 w-5 text-[var(--color-helix-b)]" />
          How DNA Families are formed
        </h2>
        <ol className="mt-5 space-y-4 text-sm leading-relaxed text-[var(--color-ink-300)]">
          <li>
            <strong className="text-white">1. Ingest.</strong> New Four.Meme tokens are
            discovered from chain events and enriched with metadata and trading signals
            (e.g. DEX activity).
          </li>
          <li>
            <strong className="text-white">2. Represent.</strong> Each token&apos;s name,
            symbol, and text are turned into a numerical fingerprint (embeddings) so
            similar narratives can be compared mathematically.
          </li>
          <li>
            <strong className="text-white">3. Cluster.</strong> Density-based clustering
            groups tokens that sit close together in that space (candidates for the same
            cultural moment).
          </li>
          <li>
            <strong className="text-white">4. Validate &amp; label.</strong> A reasoning
            step checks whether a cluster truly shares one underlying event; families can
            be split or merged as new data arrives.
          </li>
          <li>
            <strong className="text-white">5. Strains.</strong> Inside each family, roles
            like origin, dominant, and fastest-moving mutations summarize how the meme
            propagated on-chain.
          </li>
        </ol>
      </section>

      <section className="rounded-2xl border border-white/10 bg-[var(--color-ink-900)]/50 p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
          <FlaskConical className="h-5 w-5 text-[var(--color-helix-c)]" />
          Lab Report: what goes in, and how it is built
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-[var(--color-ink-300)]">
          <strong className="text-white">Lab Report</strong> is the one-page brief for a
          wallet or a token. It is assembled from{" "}
          <strong className="text-white">structured facts</strong> (holdings, family
          ties, liquidity and volume where available, timing, optional risk-style
          flags), then passed through a{" "}
          <strong className="text-white">deterministic template</strong> so every section
          is filled consistently. When configured, an{" "}
          <strong className="text-white">AI narrative layer</strong> tightens phrasing and
          connects the dots, always grounded in those facts, not invented prices or
          guarantees.
        </p>
        <ul className="mt-4 list-inside list-disc space-y-2 text-sm text-[var(--color-ink-300)]">
          <li>
            <strong className="text-white">Criteria:</strong> reports favor verifiable
            numbers, explicit uncertainty when data is missing, and clear separation
            between observation and opinion.
          </li>
          <li>
            <strong className="text-white">Social context:</strong> when enabled, web
            research supplements on-chain data; rate limits and timeouts are respected so
            the UI stays responsive.
          </li>
        </ul>
      </section>

      <section className="rounded-2xl border border-white/10 bg-[var(--color-ink-900)]/50 p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
          <Layers className="h-5 w-5 text-[var(--color-helix-a)]" />
          How AI is used (at a glance)
        </h2>
        <ul className="mt-5 space-y-3 text-sm leading-relaxed text-[var(--color-ink-300)]">
          <li className="flex gap-3">
            <Network className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-helix-a)]" />
            <span>
              <strong className="text-white">Clustering &amp; classification.</strong>{" "}
              Vector similarity and models help decide which tokens belong together and how
              to describe archetypes.
            </span>
          </li>
          <li className="flex gap-3">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-helix-b)]" />
            <span>
              <strong className="text-white">Copy &amp; narrative.</strong> Optional
              language models turn fact bundles into readable analyst-style prose. You can
              run in template-only mode without any generative API.
            </span>
          </li>
          <li className="flex gap-3">
            <Bot className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-helix-c)]" />
            <span>
              <strong className="text-white">No black-box price prediction.</strong>{" "}
              Outputs highlight signals and lineage; they are not buy/sell instructions.
            </span>
          </li>
        </ul>
      </section>

      <div className="flex flex-wrap gap-4">
        <Link
          href="/lab-report"
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[var(--color-helix-a)] to-[var(--color-helix-c)] px-5 py-2.5 text-sm font-semibold text-[var(--color-ink-950)]"
        >
          Try Lab Report
          <ArrowRight className="h-4 w-4" />
        </Link>
        <Link
          href="/docs"
          className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/5"
        >
          Technical docs
        </Link>
      </div>
    </div>
  );
}

function Spotlight({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
      <div className="text-[var(--color-helix-a)]">{icon}</div>
      <h3 className="mt-3 text-sm font-semibold text-white">{title}</h3>
      <p className="mt-2 text-xs leading-relaxed text-[var(--color-ink-400)]">{body}</p>
    </div>
  );
}
