export const dynamic = 'force-dynamic';

import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Boxes,
  Brain,
  Cog,
  Database,
  Dna,
  ExternalLink,
  Flame,
  GitBranch,
  Globe2,
  KeyRound,
  Layers,
  Network,
  Rocket,
  Shield,
  Sparkles,
  Terminal,
  Zap,
} from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import {
  prettyModel,
  prettyProvider,
  prettyResearchChain,
} from "@/lib/humanize";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000";

type Endpoint = {
  method: "GET";
  path: string;
  description: string;
  example?: string;
};

const ENDPOINTS: { group: string; items: Endpoint[] }[] = [
  {
    group: "DNA Families",
    items: [
      {
        method: "GET",
        path: "/dna-families",
        description:
          "Paginated list of clustered events. Filter by q (title, ticker, or token address), sort, confidence, mutations.",
        example: "/dna-families?sort=volume&limit=12&q=robot",
      },
      {
        method: "GET",
        path: "/dna-family/{id}",
        description:
          "Full detail: centers, evolution curve, mutations, references, timeline, AI reasoning.",
        example: "/dna-family/fam_ab39e276a59a1f3572a9",
      },
      {
        method: "GET",
        path: "/trending-dna",
        description:
          "Fastest-growing families in the last evolution window (short-timescale momentum).",
        example: "/trending-dna?limit=8",
      },
    ],
  },
  {
    group: "Mutations (Tokens)",
    items: [
      {
        method: "GET",
        path: "/mutation/{address}",
        description:
          "Full fingerprint of a Four.Meme token: bonding curve, deployer, trading metrics, parent family link, AI reasoning.",
        example:
          "/mutation/0xA5B6FAe090550eDACED3F0839f13c051e69d4444",
      },
      {
        method: "GET",
        path: "/explorer/tokens",
        description:
          "Paginated raw token index (even without a family). Supports search, sort, migrated/fresh filters.",
        example: "/explorer/tokens?sort=volume&limit=24",
      },
      {
        method: "GET",
        path: "/social/search",
        description:
          "Ad-hoc web/X search for a single token - used to power the Social Mentions panel.",
        example:
          "/social/search?q=0xA5B6FAe090550eDACED3F0839f13c051e69d4444",
      },
    ],
  },
  {
    group: "Wallet & System",
    items: [
      {
        method: "GET",
        path: "/wallet/{address}/dna",
        description:
          "All Four.Meme tokens deployed by a wallet + the DNA families they belong to.",
        example: "/wallet/0x0000000000000000000000000000000000000000/dna",
      },
      {
        method: "GET",
        path: "/stats/overview",
        description:
          "Global counts: total tokens, families, mutations, 24h volume, tokens with liquidity.",
      },
      {
        method: "GET",
        path: "/stack-info",
        description:
          "Live snapshot of LLM / embeddings / research provider / data sources in use.",
      },
      {
        method: "GET",
        path: "/readyz",
        description:
          "Health probe. Returns pipeline_fresh + last_run_status for scheduler monitoring.",
      },
    ],
  },
];

type EnvVar = {
  name: string;
  required: "required" | "recommended" | "optional";
  what: string;
  where: string; // where to obtain
  note?: string;
};

const ENV_GROUPS: { group: string; icon: React.ComponentType<{ className?: string }>; items: EnvVar[] }[] = [
  {
    group: "Database",
    icon: Database,
    items: [
      {
        name: "DATABASE_URL",
        required: "required",
        what: "Postgres DSN with pgvector enabled. Compose sets it automatically.",
        where:
          "Already wired if you run `docker compose up` - only touch it if you're pointing at a managed Postgres.",
      },
    ],
  },
  {
    group: "Chat LLM (reasoning + extraction)",
    icon: Brain,
    items: [
      {
        name: "OPENAI_API_KEY",
        required: "required",
        what: "Any OpenAI-compatible chat key. Default is Groq + gpt-oss-120b, the free open-weight reasoning model.",
        where:
          "Groq (fast, free tier): https://console.groq.com/keys · OpenAI: https://platform.openai.com/api-keys · Together / Fireworks also work.",
      },
      {
        name: "OPENAI_BASE_URL",
        required: "required",
        what: "Base URL of the OpenAI-compatible endpoint.",
        where:
          "Groq: https://api.groq.com/openai/v1 · OpenAI: https://api.openai.com/v1",
      },
      {
        name: "OPENAI_CHAT_MODEL",
        required: "recommended",
        what: "Model slug.",
        where:
          "Groq: `openai/gpt-oss-120b` (default) or `llama-3.3-70b-versatile`. OpenAI: `gpt-4o-mini`, `gpt-4.1-mini`.",
      },
    ],
  },
  {
    group: "Embeddings (for clustering)",
    icon: Layers,
    items: [
      {
        name: "EMBEDDINGS_API_KEY",
        required: "recommended",
        what: "OpenAI-compatible embedding key. If empty, MemeLab falls back to a local semantic-hash - clustering still works but is coarser.",
        where:
          "OpenAI (recommended for quality): https://platform.openai.com/api-keys - reuse the same account as the chat key if you want.",
      },
      {
        name: "EMBEDDINGS_BASE_URL",
        required: "optional",
        what: "Override if you point embeddings at a different provider (e.g., Together).",
        where:
          "Leave blank for OpenAI. Together: https://api.together.xyz/v1",
      },
      {
        name: "EMBEDDINGS_MODEL",
        required: "optional",
        what: "Embedding model slug.",
        where:
          "Default `text-embedding-3-small` is 1536 dims - matches the pgvector schema. Only change if you migrate the column.",
      },
    ],
  },
  {
    group: "Web research (tweets, articles, context)",
    icon: Globe2,
    items: [
      {
        name: "TWITTER_AUTH_TOKEN",
        required: "recommended",
        what: "Auth cookie for X. Lets MemeLab pull the actual tweets that spawned a meme wave - huge boost for source_center quality.",
        where:
          "Create a DEDICATED alt X account, log into x.com, DevTools → Application → Cookies → copy `auth_token`.",
        note: "Cookies expire every ~30 days. Rotate when research logs show `X search auth failed`.",
      },
      {
        name: "TWITTER_CT0",
        required: "recommended",
        what: "The CSRF token cookie. Required together with `TWITTER_AUTH_TOKEN`.",
        where: "Same DevTools pane - copy the `ct0` cookie value.",
      },
      {
        name: "TAVILY_API_KEY",
        required: "optional",
        what: "High-quality web search with LLM-ready snippets.",
        where: "https://tavily.com → Dashboard → API Keys (1000 free/mo).",
      },
      {
        name: "SERPAPI_API_KEY",
        required: "optional",
        what: "Google / Google News scraping. Useful for news + event timeline.",
        where: "https://serpapi.com → Account → API Key (100 free/mo).",
      },
      {
        name: "JINA_API_KEY",
        required: "optional",
        what: "Jina s.reader + search API - alternative research provider.",
        where: "https://jina.ai/api-dashboard",
      },
      {
        name: "BITQUERY_API_KEY",
        required: "optional",
        what: "GraphQL access to historical BSC data. Speeds up deep backfills.",
        where: "https://account.bitquery.io/user/api_v2/access_tokens",
      },
    ],
  },
  {
    group: "Market & on-chain",
    icon: Rocket,
    items: [
      {
        name: "BSCSCAN_API_KEY",
        required: "optional",
        what: "Fallback for holder counts if GoPlus is rate-limited. Main source is already free + keyless.",
        where: "https://bscscan.com/myapikey (free tier: 100k req/day).",
      },
      {
        name: "BSC_RPC_URL",
        required: "required",
        what: "BSC node to read TokenManager2 events.",
        where:
          "Default `https://bsc-dataseed.bnbchain.org` works. Use a dedicated provider (Ankr, QuickNode, drpc) for heavy ingest.",
      },
      {
        name: "FOURMEME_TOKEN_MANAGER",
        required: "required",
        what: "Address of the Four.Meme TokenManager2 contract.",
        where:
          "Already set: `0x5c952063c7fc8610FFDB798152D69F0B9550762b`. Don't change unless Four.Meme redeploys.",
      },
    ],
  },
  {
    group: "Pipeline tuning",
    icon: Cog,
    items: [
      {
        name: "PIPELINE_LOOKBACK_HOURS",
        required: "optional",
        what: "How far back to scan for ingestion each run.",
        where: "720 = 30 days. Raise if you're cold-starting, lower for lean runs.",
      },
      {
        name: "PIPELINE_CLUSTER_EPS",
        required: "optional",
        what: "DBSCAN cosine radius. Lower = tighter clusters, higher = more inclusive families.",
        where: "0.42 is a good ceiling; push to 0.48 if families feel too fragmented.",
      },
      {
        name: "PIPELINE_MIN_CONFIDENCE",
        required: "optional",
        what: "Minimum cluster confidence to keep a family.",
        where: "0.25 lets borderline-but-meaningful clusters in; raise to 0.35+ for stricter curation.",
      },
      {
        name: "PIPELINE_INTERVAL_MINUTES",
        required: "optional",
        what: "How often the background scheduler re-runs the full pipeline.",
        where: "5 = near-realtime. Set to 15–30 on a single-node dev box.",
      },
    ],
  },
];

export default async function DocsPage() {
  const [stack, overview] = await Promise.all([
    api.stack().catch(() => null),
    api.overview().catch(() => null),
  ]);

  return (
    <div className="page-shell space-y-14">
      {/* HERO */}
      <section className="relative overflow-hidden rounded-3xl border border-white/5 bg-[var(--color-ink-950)]/70 p-6 sm:p-10">
        <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-[var(--color-helix-a)]/10 blur-3xl" />
        <div className="pointer-events-none absolute -right-24 top-1/3 h-96 w-96 rounded-full bg-[var(--color-helix-c)]/10 blur-3xl" />
        <div className="relative z-10 grid gap-10 lg:grid-cols-[1.3fr_1fr] lg:items-end">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-[var(--color-ink-300)]">
              <BookOpen className="h-3 w-3 text-[var(--color-helix-a)]" />
              Documentation · v1
            </div>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              How MemeLab decodes every meme launch on{" "}
              <span className="gradient-text">Four.Meme</span>.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-300)] sm:text-base">
              MemeLab ingests every <code>TokenCreate</code> event on BNB
              Chain, embeds each token&apos;s signal, clusters tokens that
              point to the same real-world narrative, and enriches the
              resulting <span className="text-white">DNA Family</span> with
              AI-extracted centers, timelines, and external references. This
              page covers the whole system end-to-end: metaphor, pipeline,
              scoring, API, and configuration.
            </p>
            <p className="mt-3 max-w-2xl text-sm text-[var(--color-ink-400)]">
              New here? Read the{" "}
              <Link href="/about" className="text-[var(--color-helix-a)] hover:underline">
                About
              </Link>{" "}
              page for a plain-language tour: how families form, how Lab
              Reports are built, and how AI is used (without implementation
              detail).
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              <a
                href={`${API_BASE}/docs`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-[var(--color-helix-a)]/30 bg-[var(--color-helix-a)]/10 px-4 py-1.5 text-xs text-white hover:bg-[var(--color-helix-a)]/20"
              >
                Interactive Swagger UI <ExternalLink className="h-3 w-3" />
              </a>
              <a
                href={`${API_BASE}/openapi.json`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-1.5 text-xs text-[var(--color-ink-200)] hover:bg-white/[0.08]"
              >
                OpenAPI schema <ExternalLink className="h-3 w-3" />
              </a>
              <a
                href="https://four-meme.gitbook.io/four.meme"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-1.5 text-xs text-[var(--color-ink-200)] hover:bg-white/[0.08]"
              >
                Four.Meme gitbook <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>

          {/* Section TOC */}
          <nav className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
            <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-ink-400)]">
              On this page
            </div>
            <ul className="mt-3 grid gap-1.5 text-sm">
              {[
                { href: "#metaphor", label: "The DNA metaphor", icon: Dna },
                { href: "#pipeline", label: "Pipeline flow", icon: Network },
                { href: "#scoring", label: "Scoring & clustering", icon: Sparkles },
                { href: "#api", label: "API reference", icon: Terminal },
                { href: "#configuration", label: "Configuration · .env", icon: KeyRound },
                { href: "#stack", label: "Live stack", icon: Boxes },
                { href: "#security", label: "Security notes", icon: Shield },
              ].map((l) => {
                const Icon = l.icon;
                return (
                  <li key={l.href}>
                    <a
                      href={l.href}
                      className="group flex items-center justify-between rounded-lg border border-transparent px-2.5 py-1.5 text-[var(--color-ink-300)] hover:border-white/5 hover:bg-white/[0.04] hover:text-white"
                    >
                      <span className="inline-flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5 text-[var(--color-helix-a)]" />
                        {l.label}
                      </span>
                      <ArrowRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-70" />
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>

        {overview && (
          <div className="relative z-10 mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat
              label="DNA Families"
              value={overview.families_total.toLocaleString("en-US")}
              Icon={Dna}
            />
            <Stat
              label="Four.Meme tokens"
              value={overview.tokens_total.toLocaleString("en-US")}
              Icon={GitBranch}
            />
            <Stat
              label="Mutations tracked"
              value={overview.mutations_total.toLocaleString("en-US")}
              Icon={Layers}
            />
            <Stat
              label="24h volume"
              value={`$${(overview.volume_24h_usd / 1_000_000).toFixed(2)}M`}
              Icon={Flame}
            />
          </div>
        )}
      </section>

      {/* METAPHOR */}
      <section id="metaphor" className="scroll-mt-20">
        <SectionHeader
          title="The DNA metaphor"
          description="We model meme tokens as living organisms so humans can reason about chaos at a glance."
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <MetaphorCard
            label="Event Cluster"
            value="DNA Family"
            hint="Every real-world narrative that spawned ≥2 Four.Meme tokens becomes a family."
          />
          <MetaphorCard
            label="Token"
            value="Mutation"
            hint="Each Four.Meme token is one mutation of the shared meme genome."
          />
          <MetaphorCard
            label="First token"
            value="Origin Strain"
            hint="The chronologically earliest mutation in the family."
          />
          <MetaphorCard
            label="Top by liquidity"
            value="Dominant Strain"
            hint="The mutation with the largest market / liquidity footprint."
          />
          <MetaphorCard
            label="Fastest-rising"
            value="Fastest Mutation"
            hint="The mutation with the steepest volume / mcap slope."
          />
          <MetaphorCard
            label="Growth over time"
            value="Evolution Curve"
            hint="Mutation count + volume at 1h / 6h / 24h buckets."
          />
        </div>
      </section>

      {/* PIPELINE */}
      <section id="pipeline" className="scroll-mt-20">
        <SectionHeader
          title="Pipeline flow"
          description="Five stages, fully deterministic, reruns every PIPELINE_INTERVAL_MINUTES minutes."
        />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          {PIPELINE_STEPS.map((s, i) => (
            <PipelineStep key={s.title} step={i + 1} {...s} />
          ))}
        </div>
        <div className="mt-4 rounded-2xl border border-white/5 bg-white/[0.02] p-4 text-[11px] leading-relaxed text-[var(--color-ink-300)]">
          <span className="text-[var(--color-helix-a)]">Idempotent by design.</span>{" "}
          The scheduler re-runs every step; stale families are refreshed, new
          tokens are merged, and nothing is ever deleted - historical family
          state is preserved so the Evolution Curve is cumulative.
        </div>
      </section>

      {/* SCORING */}
      <section id="scoring" className="scroll-mt-20">
        <SectionHeader
          title="Scoring & clustering"
          description="How the numbers you see on the family pages are actually computed."
        />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <ScoringCard
            title="Cluster confidence"
            formula="confidence = 1 − mean_cosine_distance(members, centroid)"
            hint="Reported as a 0–1 score on each family card. Anything < PIPELINE_MIN_CONFIDENCE is dropped."
          />
          <ScoringCard
            title="Evolution score"
            formula="evo = z(volume_24h) · 0.45 + z(momentum_1h) · 0.35 + z(log₁₀ mutations) · 0.2"
            hint="Standard-scored across the active family set. Drives the Genome Galaxy color buckets (cold → viral)."
          />
          <ScoringCard
            title="Dominant strain pick"
            formula="argmax(liquidity_usd · 0.55 + volume_24h · 0.35 + holders · 0.1)"
            hint="Chosen from the family's mutations. Ties break on earlier `created_at`."
          />
          <ScoringCard
            title="Fastest mutation pick"
            formula="argmax((volume_24h − volume_prev_day) / max(1, hours_alive))"
            hint="Measures the *slope* of attention, not the absolute amount."
          />
        </div>
      </section>

      {/* API */}
      <section id="api" className="scroll-mt-20">
        <SectionHeader
          title="API reference"
          description="Every endpoint returns JSON shaped after the DNA abstraction. Base URL of this deployment:"
        />
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 font-mono text-xs text-[var(--color-ink-200)]">
          {API_BASE}
        </div>
        <div className="space-y-6">
          {ENDPOINTS.map((g) => (
            <div key={g.group}>
              <h3 className="mb-2 text-[11px] uppercase tracking-[0.22em] text-[var(--color-ink-400)]">
                {g.group}
              </h3>
              <div className="space-y-2">
                {g.items.map((ep) => (
                  <EndpointRow key={ep.path} ep={ep} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ENV GUIDE */}
      <section id="configuration" className="scroll-mt-20">
        <SectionHeader
          title="Configuration · .env"
          description="How to fill in every variable without leaking anything. Required = the pipeline refuses to boot without it. Recommended = quality drops noticeably. Optional = nice-to-have."
        />
        <div className="mb-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-[12px] leading-relaxed text-amber-100">
          <span className="font-semibold">Safety:</span> MemeLab never logs
          secret values. The{" "}
          <code className="rounded bg-black/30 px-1 py-0.5">/stack-info</code>{" "}
          endpoint and every page in this UI only display <em>booleans</em>{" "}
          (key set / not set), provider names, and non-sensitive model slugs.
          Keep your <code className="rounded bg-black/30 px-1 py-0.5">.env</code>{" "}
          out of git -{" "}
          <code className="rounded bg-black/30 px-1 py-0.5">.gitignore</code>{" "}
          already excludes it.
        </div>

        <div className="space-y-6">
          {ENV_GROUPS.map((g) => {
            const Icon = g.icon;
            return (
              <div key={g.group}>
                <h3 className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-[var(--color-ink-400)]">
                  <Icon className="h-3 w-3 text-[var(--color-helix-a)]" />
                  {g.group}
                </h3>
                <div className="space-y-2">
                  {g.items.map((v) => (
                    <EnvRow key={v.name} v={v} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* STACK */}
      {stack && (
        <section id="stack" className="scroll-mt-20">
          <SectionHeader
            title="Current stack"
            description="What's actively running in this deployment right now. Values are read live from /stack-info."
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  <Brain className="h-3.5 w-3.5 text-[var(--color-helix-a)]" />
                  Reasoning AI
                </CardTitle>
              </CardHeader>
              <div className="text-sm text-white">
                {stack.chat_llm.enabled
                  ? prettyModel(stack.chat_llm.model)
                  : "disabled"}
              </div>
              <div className="mt-1 text-[11px] text-[var(--color-ink-400)]">
                {stack.chat_llm.enabled
                  ? `Running via ${prettyProvider(stack.chat_llm.provider)}`
                  : "Set an OpenAI-compatible key to enable."}
              </div>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-[var(--color-helix-b)]" />
                  Semantic space
                </CardTitle>
              </CardHeader>
              <div className="text-sm text-white">
                {stack.embeddings.fallback
                  ? "Local semantic hash"
                  : "Real embedding model"}
              </div>
              <div className="mt-1 text-[11px] text-[var(--color-ink-400)]">
                {stack.embeddings.fallback
                  ? "Deterministic CPU-only fallback. Works but coarser than a real model."
                  : "High-dimensional vector space feeds the cluster engine."}
              </div>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  <Globe2 className="h-3.5 w-3.5 text-[var(--color-helix-c)]" />
                  Event research
                </CardTitle>
              </CardHeader>
              <div className="text-sm text-white">
                {prettyResearchChain(stack.research.provider).summary}
              </div>
              <div className="mt-1 text-[11px] text-[var(--color-ink-400)]">
                {prettyResearchChain(stack.research.provider).hint}
              </div>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  <Database className="h-3.5 w-3.5 text-[var(--color-helix-d)]" />
                  Data sources
                </CardTitle>
              </CardHeader>
              <ul className="space-y-1 text-sm text-white">
                <li className="flex items-center gap-2">
                  <Badge variant="good">BSC on-chain</Badge>
                  <span className="text-[11px] text-[var(--color-ink-400)]">
                    Four.Meme TokenManager2 events
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <Badge variant="good">DexScreener</Badge>
                  <span className="text-[11px] text-[var(--color-ink-400)]">
                    live price / volume / liquidity
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <Badge variant="good">GoPlus Security</Badge>
                  <span className="text-[11px] text-[var(--color-ink-400)]">
                    holder counts (keyless)
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <Badge
                    variant={stack.data_sources.bitquery ? "good" : "muted"}
                  >
                    Bitquery
                  </Badge>
                  <span className="text-[11px] text-[var(--color-ink-400)]">
                    {stack.data_sources.bitquery ? "enabled" : "disabled"}
                  </span>
                </li>
              </ul>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  <Boxes className="h-3.5 w-3.5 text-[var(--color-helix-a)]" />
                  Pipeline
                </CardTitle>
              </CardHeader>
              <ul className="space-y-1 text-sm text-white">
                <li>every {stack.pipeline.interval_minutes} min</li>
                <li className="text-[11px] text-[var(--color-ink-400)]">
                  lookback {stack.pipeline.lookback_hours}h · eps{" "}
                  {stack.pipeline.cluster_eps} · min conf{" "}
                  {stack.pipeline.min_confidence}
                </li>
                <li className="text-[11px] text-[var(--color-ink-400)]">
                  incremental: {stack.pipeline.incremental ? "yes" : "no"}
                </li>
              </ul>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  <Rocket className="h-3.5 w-3.5 text-[var(--color-helix-b)]" />
                  Blockchain
                </CardTitle>
              </CardHeader>
              <ul className="space-y-1 text-sm text-white">
                <li>BNB Chain (id {stack.blockchain.chain_id})</li>
                <li className="text-[11px] text-[var(--color-ink-400)]">
                  on-chain anchor:{" "}
                  {stack.blockchain.registry
                    ? "enabled"
                    : "registry not deployed"}
                </li>
              </ul>
            </Card>
          </div>
        </section>
      )}

      {/* SECURITY */}
      <section id="security" className="scroll-mt-20">
        <SectionHeader
          title="Security notes"
          description="Guardrails worth knowing before you wire MemeLab into anything public."
        />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <SecurityCard
            title="Read-only by default"
            body="MemeLab never signs trades. The only signer is the optional registry deployer used to anchor family hashes on-chain."
          />
          <SecurityCard
            title="Holder counts are rate-limited"
            body="GoPlus free tier allows ~30 req/min. The ingestor auto-throttles and enters a 90 s cooldown on HTTP 4029. Back-off is global, so restarts resume cleanly."
          />
          <SecurityCard
            title="Never commit secrets"
            body=".env is git-ignored. Any keys in .env.example are illustrative placeholders; the UI never re-displays secret values."
          />
        </div>
        <div className="mt-4 rounded-2xl border border-[var(--color-helix-a)]/15 bg-[var(--color-helix-a)]/[0.04] p-4 text-[12px] leading-relaxed text-[var(--color-ink-200)]">
          <Link
            href="/families"
            className="inline-flex items-center gap-2 text-[var(--color-helix-a)] hover:underline"
          >
            Ready to dive in? Browse the current DNA Families →
          </Link>
        </div>
      </section>
    </div>
  );
}

/* ─── Pipeline graph data ─────────────────────────────────────────────── */

const PIPELINE_STEPS: {
  title: string;
  body: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: "helix-a" | "helix-b" | "helix-c" | "helix-d";
}[] = [
  {
    title: "Ingest",
    body: "Stream TokenCreate logs from BSC, hydrate metadata, upsert DexScreener market stats, fetch holder counts.",
    icon: Database,
    accent: "helix-a",
  },
  {
    title: "Embed",
    body: "Embed each token's name + symbol + description into a 1536-dim vector (pgvector HNSW index).",
    icon: Layers,
    accent: "helix-b",
  },
  {
    title: "Cluster",
    body: "DBSCAN over the token embeddings to discover narrative groups. Orphans get skipped until they gain siblings.",
    icon: Network,
    accent: "helix-d",
  },
  {
    title: "Enrich",
    body: "LLM extracts four centers (source / geo / entity / context), a human title, and an evolution reasoning chain.",
    icon: Brain,
    accent: "helix-c",
  },
  {
    title: "Score",
    body: "Compute confidence, evolution score, origin/dominant/fastest strains, and the 1h/6h/24h curve for each family.",
    icon: Sparkles,
    accent: "helix-a",
  },
];

/* ─── Sub-components ──────────────────────────────────────────────────── */

function PipelineStep({
  step,
  title,
  body,
  icon: Icon,
  accent,
}: {
  step: number;
  title: string;
  body: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: "helix-a" | "helix-b" | "helix-c" | "helix-d";
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02] p-4">
      <div
        className="absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-25 blur-2xl"
        style={{ background: `var(--color-${accent})` }}
      />
      <div className="flex items-center gap-2">
        <span
          className="grid h-7 w-7 place-items-center rounded-full font-mono text-[10px] font-bold"
          style={{
            background: `var(--color-${accent})`,
            color: "var(--color-ink-950)",
          }}
        >
          {step}
        </span>
        <h4 className="font-semibold text-white">{title}</h4>
        <Icon className={`ml-auto h-4 w-4 text-[var(--color-${accent})]`} />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-ink-300)]">
        {body}
      </p>
    </div>
  );
}

function ScoringCard({
  title,
  formula,
  hint,
}: {
  title: string;
  formula: string;
  hint: string;
}) {
  return (
    <Card>
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-400)]">
        Formula
      </div>
      <div className="mt-1 text-sm font-semibold text-white">{title}</div>
      <code className="mt-3 block overflow-x-auto rounded-lg border border-white/5 bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-[var(--color-helix-a)]">
        {formula}
      </code>
      <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-ink-400)]">
        {hint}
      </p>
    </Card>
  );
}

function SecurityCard({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <div className="flex items-center gap-2">
        <Shield className="h-3.5 w-3.5 text-[var(--color-helix-a)]" />
        <div className="text-sm font-semibold text-white">{title}</div>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-ink-300)]">
        {body}
      </p>
    </Card>
  );
}

function EnvRow({ v }: { v: EnvVar }) {
  const pill =
    v.required === "required"
      ? "bg-rose-400/15 text-rose-200 ring-1 ring-rose-400/20"
      : v.required === "recommended"
      ? "bg-[var(--color-helix-c)]/15 text-[var(--color-helix-c)] ring-1 ring-[var(--color-helix-c)]/20"
      : "bg-white/5 text-[var(--color-ink-300)] ring-1 ring-white/10";
  return (
    <Card>
      <div className="flex flex-wrap items-start gap-3">
        <code className="rounded-md bg-black/30 px-2 py-1 font-mono text-[12px] text-white">
          {v.name}
        </code>
        <span
          className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] ${pill}`}
        >
          {v.required}
        </span>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-[var(--color-ink-200)]">
        {v.what}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-ink-400)]">
        <span className="text-[var(--color-helix-a)]">Where to get it:</span>{" "}
        {v.where}
      </p>
      {v.note && (
        <p className="mt-1 text-[11px] italic leading-relaxed text-amber-200/80">
          note: {v.note}
        </p>
      )}
    </Card>
  );
}

function Stat({
  label,
  value,
  Icon,
}: {
  label: string;
  value: string;
  Icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-[var(--color-ink-400)]">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-1 font-mono text-lg font-semibold tracking-tight text-white">
        {value}
      </div>
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
      <h2 className="text-xl font-semibold tracking-tight text-white">
        {title}
      </h2>
      <p className="mt-1 text-[13px] text-[var(--color-ink-400)]">
        {description}
      </p>
    </header>
  );
}

function MetaphorCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card>
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-400)]">
        {label}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <Dna className="h-4 w-4 text-[var(--color-helix-a)]" />
        <div className="text-base font-semibold text-white">{value}</div>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-ink-400)]">
        {hint}
      </p>
    </Card>
  );
}

function EndpointRow({ ep }: { ep: Endpoint }) {
  const tryUrl = (ep.example || ep.path).replace(/\{[^}]+\}/g, "{id}");
  return (
    <Card className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Badge variant="good">{ep.method}</Badge>
        <div className="min-w-0 flex-1">
          <code className="font-mono text-sm text-white">{ep.path}</code>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-ink-300)]">
            {ep.description}
          </p>
          {ep.example && (
            <div className="mt-2 flex items-center gap-2 text-[10px] text-[var(--color-ink-400)]">
              <span>try:</span>
              <code className="rounded-md bg-white/[0.04] px-2 py-0.5 font-mono text-[var(--color-ink-200)]">
                {ep.example}
              </code>
            </div>
          )}
        </div>
      </div>
      {ep.example && !ep.example.includes("{") && (
        <a
          href={`${API_BASE}${ep.example}`}
          target="_blank"
          rel="noreferrer"
          className="flex-shrink-0 self-start rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[10px] text-[var(--color-ink-200)] hover:bg-white/[0.08]"
        >
          Open →
        </a>
      )}
      {ep.path.includes("{") && !ep.example?.includes("{") && (
        <a
          href={`${API_BASE}${ep.example || tryUrl}`}
          target="_blank"
          rel="noreferrer"
          className="flex-shrink-0 self-start rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[10px] text-[var(--color-ink-200)] hover:bg-white/[0.08]"
        >
          Open →
        </a>
      )}
    </Card>
  );
}
