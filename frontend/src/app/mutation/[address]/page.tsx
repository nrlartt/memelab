import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  Dna,
  Droplet,
  ExternalLink,
  FlaskConical,
  GitBranch,
  Sparkles,
  Target,
  Users,
  Wallet,
} from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StrainBadge } from "@/components/strain-badge";
import { MutationFingerprint } from "@/components/mutation-fingerprint";
import { FamilyRank } from "@/components/family-rank";
import { SocialMentions } from "@/components/social-mentions";
import { formatNumber, formatPrice, formatUsd, shortAddress, timeAgo } from "@/lib/format";
import { TokenAvatar } from "@/components/token-avatar";

type Props = { params: Promise<{ address: string }> };

export default async function MutationPage({ params }: Props) {
  const { address } = await params;
  let m;
  try {
    m = await api.mutation(address.toLowerCase());
  } catch (e) {
    if (/404/.test((e as Error).message)) notFound();
    throw e;
  }
  // Parent family - used for the rank / positioning viz. Best-effort, fails silently.
  const family = m.family
    ? await api.family(m.family.id).catch(() => null)
    : null;

  const roles: React.ReactNode[] = [];
  if (m.is_origin_strain)
    roles.push(
      <StrainBadge
        key="o"
        kind="origin"
        strain={{ token: m.token_address, symbol: m.symbol }}
      />
    );
  if (m.is_dominant_strain)
    roles.push(
      <StrainBadge
        key="d"
        kind="dominant"
        strain={{ token: m.token_address, symbol: m.symbol }}
      />
    );
  if (m.is_fastest_mutation)
    roles.push(
      <StrainBadge
        key="f"
        kind="fastest"
        strain={{ token: m.token_address, symbol: m.symbol }}
      />
    );

  return (
    <div className="page-shell space-y-8">
      {m.family ? (
        <Link
          href={`/family/${m.family.id}`}
          className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-300)] hover:text-white"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to DNA Family · {m.family.event_title}
        </Link>
      ) : (
        <Link
          href="/families"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-300)] hover:text-white"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to DNA Families
        </Link>
      )}

      <section className="relative overflow-hidden rounded-3xl border border-white/5 bg-[var(--color-ink-950)]/70 p-6 sm:p-10">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-[var(--color-helix-b)]/8 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:gap-10">
          <TokenAvatar
            src={m.image_url}
            symbol={m.symbol}
            size={96}
            rounded="2xl"
          />
          <div className="flex-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-[var(--color-ink-300)]">
              <Dna className="h-3 w-3 text-[var(--color-helix-a)]" />
              Mutation · Four.Meme
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {m.symbol || "Unnamed Mutation"}
              <span className="ml-3 align-middle text-base font-normal text-[var(--color-ink-400)]">
                {m.name}
              </span>
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--color-ink-400)]">
              <span className="font-mono">{shortAddress(m.token_address, 10, 8)}</span>
              <a
                className="inline-flex items-center gap-1 hover:text-white"
                href={`https://bscscan.com/token/${m.token_address}`}
                target="_blank"
                rel="noreferrer"
              >
                BscScan <ExternalLink className="h-3 w-3" />
              </a>
              <a
                className="inline-flex items-center gap-1 hover:text-white"
                href={`https://four.meme/en/token/${m.token_address}`}
                target="_blank"
                rel="noreferrer"
              >
                Four.Meme <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            {roles.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">{roles}</div>
            )}

            {m.description && (
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-300)]">
                {m.description}
              </p>
            )}

            <Link
              href={`/lab-report?mode=token&address=${encodeURIComponent(m.token_address)}`}
              className="group mt-6 flex w-full max-w-2xl items-center justify-between gap-4 rounded-2xl border border-[var(--color-helix-a)]/35 bg-gradient-to-r from-[var(--color-helix-a)]/[0.12] via-[var(--color-helix-b)]/[0.08] to-transparent px-5 py-4 transition hover:border-[var(--color-helix-a)]/55 hover:from-[var(--color-helix-a)]/[0.18]"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-helix-a)]/20 text-[var(--color-helix-a)] ring-1 ring-[var(--color-helix-a)]/30">
                  <FlaskConical className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">
                    Analyze this token with Lab Report
                  </p>
                  <p className="mt-0.5 text-xs leading-snug text-[var(--color-ink-400)]">
                    Full DNA-style breakdown — your contract address is pre-filled; tap Generate when
                    you&apos;re ready.
                  </p>
                </div>
              </div>
              <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--color-helix-a)] group-hover:translate-x-0.5">
                Open
                <ArrowRight className="h-4 w-4" />
              </span>
            </Link>

            <dl className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <KPI
                label="Launched (chain)"
                value={timeAgo(m.created_at)}
                hint={`${formatUtc(m.created_at)} UTC`}
                icon={<Clock className="h-3.5 w-3.5 text-[var(--color-ink-400)]" />}
              />
              <KPI
                label="Price"
                value={formatPrice(m.trading.price_usd)}
                icon={<Target className="h-3.5 w-3.5 text-[var(--color-helix-c)]" />}
              />
              <KPI
                label="24h Vol"
                value={formatUsd(m.trading.volume_24h_usd, { compact: true })}
                icon={<GitBranch className="h-3.5 w-3.5 text-[var(--color-helix-b)]" />}
              />
              <KPI
                label="Liquidity"
                value={formatUsd(m.trading.liquidity_usd, { compact: true })}
                icon={<Droplet className="h-3.5 w-3.5 text-[var(--color-helix-a)]" />}
              />
              <KPI
                label="Mkt cap"
                value={formatUsd(m.trading.market_cap_usd, { compact: true })}
                icon={<Sparkles className="h-3.5 w-3.5 text-[var(--color-helix-d)]" />}
              />
              <KPI
                label="Holders"
                value={m.trading.holders > 0 ? formatNumber(m.trading.holders) : "-"}
                icon={<Users className="h-3.5 w-3.5 text-[var(--color-helix-a)]" />}
                hint={m.trading.holders > 0 ? "BscScan" : "holders pending"}
              />
            </dl>
          </div>
        </div>
      </section>

      {/* Gene expression fingerprint + family positioning */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Gene Expression Fingerprint</CardTitle>
          </CardHeader>
          <p className="mb-2 text-[11px] text-[var(--color-ink-400)]">
            Six key signals compressed into one glanceable shape. Hover an
            axis for the raw value.
          </p>
          <div className="flex items-center justify-center">
            <MutationFingerprint mutation={m} size={240} />
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Family positioning</CardTitle>
          </CardHeader>
          {family && family.mutations.length > 0 ? (
            <FamilyRank
              currentAddress={m.token_address}
              familyId={family.id}
              familyTitle={family.event_title}
              mutations={family.mutations}
            />
          ) : (
            <p className="text-xs italic text-[var(--color-ink-400)]">
              Family context unavailable.
            </p>
          )}
        </Card>
      </div>

      {/* SOCIAL MENTIONS (X + web chatter around this token) */}
      <Card>
        <CardHeader>
          <CardTitle>Social DNA · what the world is saying</CardTitle>
        </CardHeader>
        <p className="mb-3 text-[11px] text-[var(--color-ink-400)]">
          Live pull from X (when cookie-auth is configured) + DuckDuckGo,
          Tavily, and SerpAPI fallbacks. Cached 2 minutes.
        </p>
        <SocialMentions
          symbol={m.symbol}
          name={m.name}
          address={m.token_address}
        />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Why this mutation belongs</CardTitle>
          </CardHeader>
          {m.why_this_mutation_belongs ? (
            <p className="text-sm leading-relaxed text-[var(--color-ink-100)]">
              {m.why_this_mutation_belongs}
            </p>
          ) : (
            <p className="text-xs italic text-[var(--color-ink-400)]">
              AI reasoning pending.
            </p>
          )}
          <div className="mt-4 border-t border-white/5 pt-4">
            <CardTitle>Parent DNA Family</CardTitle>
            {m.family ? (
              <Link
                href={`/family/${m.family.id}`}
                className="mt-2 inline-flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-sm font-medium text-white ring-1 ring-white/5 hover:bg-white/[0.06]"
              >
                <Dna className="h-3.5 w-3.5 text-[var(--color-helix-a)]" />
                {m.family.event_title}
              </Link>
            ) : (
              <p className="mt-2 text-xs italic text-[var(--color-ink-400)]">
                This mutation hasn&apos;t been clustered into a family yet.
                The pipeline will assign one on its next run.
              </p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bonding curve & deployer</CardTitle>
          </CardHeader>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-[11px] text-[var(--color-ink-400)]">
                <span>Bonding progress</span>
                <span className="font-mono text-white">
                  {Math.round((m.bonding_progress ?? 0) * 100)}%
                </span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[var(--color-helix-a)] to-[var(--color-helix-c)]"
                  style={{
                    width: `${Math.min(100, Math.max(0, (m.bonding_progress ?? 0) * 100))}%`,
                  }}
                />
              </div>
              <div className="mt-2 text-[11px] text-[var(--color-ink-400)]">
                {m.migrated ? (
                  <Badge variant="good">Migrated to PancakeSwap</Badge>
                ) : (
                  <Badge variant="warn">Still on bonding curve</Badge>
                )}
              </div>
            </div>

            <div className="border-t border-white/5 pt-4">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-400)]">
                <Wallet className="h-3 w-3" />
                Deployer
              </div>
              <div className="mt-1 font-mono text-xs text-white">
                {shortAddress(m.deployer ?? "", 10, 8) || "-"}
              </div>
              {m.deployer && (
                <a
                  className="mt-1 inline-flex items-center gap-1 text-[11px] text-[var(--color-ink-400)] hover:text-white"
                  href={`https://bscscan.com/address/${m.deployer}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on BscScan <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
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
      <div className="mt-1 font-mono text-lg font-semibold tracking-tight text-white">
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
