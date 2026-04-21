import Link from "next/link";
import {
  Compass,
  Droplet,
  Flame,
  Filter,
  Rocket,
  Search as SearchIcon,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { api } from "@/lib/api";
import { formatNumber, formatUsd } from "@/lib/format";
import { TokenCard } from "@/components/token-card";
import { Pagination } from "@/components/pagination";

export const revalidate = 15;

type SP = {
  q?: string;
  sort?: "newest" | "volume" | "liquidity" | "migrated" | "price";
  migrated?: string;
  fresh_24h?: string;
  min_liquidity?: string;
  page?: string;
};

type Props = { searchParams: Promise<SP> };

const SORT_OPTIONS: Array<{
  key: NonNullable<SP["sort"]>;
  label: string;
  icon: typeof TrendingUp;
}> = [
  { key: "volume", label: "24h Volume", icon: TrendingUp },
  { key: "liquidity", label: "Liquidity", icon: Droplet },
  { key: "price", label: "Price", icon: Sparkles },
  { key: "newest", label: "Newest", icon: Flame },
  { key: "migrated", label: "Migrated", icon: Rocket },
];

export default async function ExplorerPage({ searchParams }: Props) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = 48;
  const sort = (sp.sort || "volume") as NonNullable<SP["sort"]>;
  const migrated =
    sp.migrated === "1" ? true : sp.migrated === "0" ? false : undefined;
  const fresh_24h = sp.fresh_24h === "1";
  const min_liquidity = Number(sp.min_liquidity) || 0;

  // Main page data + a global overview for header stats. Fire them in
  // parallel so the page still feels instant even under load.
  const [data, overview] = await Promise.all([
    api.explorer({
      q: sp.q,
      sort,
      migrated,
      fresh_24h,
      min_liquidity,
      limit,
      offset: (page - 1) * limit,
    }),
    api.overview().catch(() => null),
  ]);

  const maxPage = Math.max(1, Math.ceil(data.total / limit));

  // Helper to preserve existing filters while toggling a single key.
  const buildUrl = (patch: Partial<SP>): string => {
    const qs = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      q: sp.q,
      sort: sp.sort,
      migrated: sp.migrated,
      fresh_24h: sp.fresh_24h,
      min_liquidity: sp.min_liquidity,
      ...patch,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    }
    const s = qs.toString();
    return s ? `/explorer?${s}` : "/explorer";
  };

  // Instant-insight stats above the grid. These reflect the *filtered*
  // response where possible, and fall back to global overview.
  const filteredVol24h = data.items.reduce(
    (a, t) => a + (t.volume_24h_usd || 0),
    0
  );
  const filteredLiq = data.items.reduce(
    (a, t) => a + (t.liquidity_usd || 0),
    0
  );
  const filteredMigrated = data.items.filter((t) => t.migrated).length;
  const filteredWithFamily = data.items.filter((t) => t.family_id).length;

  return (
    <div className="page-shell space-y-6">
      {/* HERO */}
      <header className="relative overflow-hidden rounded-3xl border border-white/5 bg-[var(--color-ink-950)]/70 p-6 sm:p-10">
        <div className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-[var(--color-helix-a)]/10 blur-3xl" />
        <div className="pointer-events-none absolute -right-16 top-1/2 h-80 w-80 -translate-y-1/2 rounded-full bg-[var(--color-helix-c)]/10 blur-3xl" />

        <div className="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-[var(--color-ink-300)]">
              <Compass className="h-3 w-3 text-[var(--color-helix-a)]" />
              Token Explorer · live index
            </div>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              Every <span className="gradient-text">Four.Meme</span> token in
              one place.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-300)] sm:text-base">
              Browse the raw token universe MemeLab ingests - including the
              tokens that haven&apos;t been clustered into a DNA Family yet.
              Filter by liquidity, migration status, or search by symbol /
              address. Click any card to open the full mutation fingerprint.
            </p>
          </div>

          {overview && (
            <dl className="grid min-w-[300px] grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2">
              <HeroStat
                label="Tokens indexed"
                value={formatNumber(overview.tokens_total)}
                hint="all Four.Meme launches"
                Icon={Compass}
                accent="helix-a"
              />
              <HeroStat
                label="24h volume"
                value={formatUsd(overview.volume_24h_usd, { compact: true })}
                hint="across universe"
                Icon={TrendingUp}
                accent="helix-c"
              />
              <HeroStat
                label="With liquidity"
                value={formatNumber(overview.tokens_with_liquidity)}
                hint="tradeable right now"
                Icon={Droplet}
                accent="helix-b"
              />
              <HeroStat
                label="Matched"
                value={formatNumber(data.total)}
                hint={`page ${page} / ${maxPage}`}
                Icon={Filter}
                accent="helix-d"
              />
            </dl>
          )}
        </div>
      </header>

      {/* SORT CHIPS */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-ink-500)]">
          Sort by
        </span>
        {SORT_OPTIONS.map((s) => {
          const active = sort === s.key;
          const Icon = s.icon;
          return (
            <Link
              key={s.key}
              href={buildUrl({ sort: s.key, page: "1" })}
              className={
                active
                  ? "inline-flex items-center gap-1.5 rounded-full border border-[var(--color-helix-a)]/40 bg-gradient-to-r from-[var(--color-helix-a)]/15 to-[var(--color-helix-c)]/15 px-3 py-1.5 text-[11px] font-semibold text-white"
                  : "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] text-[var(--color-ink-300)] hover:bg-white/[0.07] hover:text-white"
              }
            >
              <Icon className="h-3 w-3" />
              {s.label}
            </Link>
          );
        })}
      </div>

      {/* FILTER BAR */}
      <form
        action="/explorer"
        method="get"
        className="glass flex flex-wrap items-end gap-3 rounded-2xl border border-white/5 p-4"
      >
        <input type="hidden" name="sort" value={sort} />
        <label className="relative min-w-[240px] flex-1">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-400)]">
            Search
          </div>
          <div className="relative mt-1">
            <SearchIcon className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-ink-500)]" />
            <input
              name="q"
              defaultValue={sp.q || ""}
              placeholder="symbol, name or 0x…"
              className="w-full rounded-lg border border-white/10 bg-white/[0.03] py-2 pl-9 pr-3 text-sm text-white outline-none transition-colors focus:border-[var(--color-helix-a)]/40"
            />
          </div>
        </label>
        <label>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-400)]">
            Migrated
          </div>
          <select
            name="migrated"
            defaultValue={sp.migrated || ""}
            className="mt-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white outline-none"
          >
            <option value="" className="bg-[var(--color-ink-900)]">
              Any
            </option>
            <option value="1" className="bg-[var(--color-ink-900)]">
              Migrated only
            </option>
            <option value="0" className="bg-[var(--color-ink-900)]">
              Bonding only
            </option>
          </select>
        </label>
        <label>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-400)]">
            Min liquidity (USD)
          </div>
          <input
            name="min_liquidity"
            type="number"
            min={0}
            defaultValue={min_liquidity || ""}
            placeholder="0"
            className="mt-1 w-32 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white outline-none"
          />
        </label>
        <label className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-xs text-[var(--color-ink-200)]">
          <input
            type="checkbox"
            name="fresh_24h"
            value="1"
            defaultChecked={fresh_24h}
            className="h-3.5 w-3.5 rounded border-white/20 bg-white/[0.03] accent-[var(--color-helix-a)]"
          />
          Fresh · last 24h
        </label>
        <button
          type="submit"
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[var(--color-helix-a)] to-[var(--color-helix-c)] px-4 py-2 text-xs font-semibold text-[var(--color-ink-950)] hover:brightness-110"
        >
          <Filter className="h-3 w-3" /> Apply filters
        </button>
        {(sp.q || sp.migrated || sp.fresh_24h || sp.min_liquidity) && (
          <Link
            href="/explorer"
            className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-[var(--color-ink-300)] hover:bg-white/[0.07] hover:text-white"
          >
            Clear
          </Link>
        )}
      </form>

      {/* PAGE-SLICE STATS */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat
          label="On this page · 24h vol"
          value={formatUsd(filteredVol24h, { compact: true })}
        />
        <MiniStat
          label="On this page · liquidity"
          value={formatUsd(filteredLiq, { compact: true })}
        />
        <MiniStat
          label="Migrated on this page"
          value={`${filteredMigrated}/${data.items.length || 0}`}
        />
        <MiniStat
          label="Already in a family"
          value={`${filteredWithFamily}/${data.items.length || 0}`}
        />
      </div>

      {/* GRID */}
      {data.items.length === 0 ? (
        <div className="glass rounded-2xl border border-white/5 p-10 text-center text-sm text-[var(--color-ink-300)]">
          <SearchIcon className="mx-auto mb-3 h-6 w-6 text-[var(--color-ink-500)]" />
          No tokens match this filter.
          <br />
          <Link
            href="/explorer"
            className="mt-3 inline-block text-[var(--color-helix-a)] hover:underline"
          >
            Clear filters →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {data.items.map((t) => (
            <TokenCard key={t.token_address} t={t} />
          ))}
        </div>
      )}

      {/* PAGINATION */}
      <Pagination
        total={data.total}
        limit={limit}
        page={page}
        buildUrl={(p) => buildUrl({ page: String(p) })}
        unit="tokens"
      />
    </div>
  );
}

function HeroStat({
  label,
  value,
  hint,
  Icon,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  Icon: typeof TrendingUp;
  accent: "helix-a" | "helix-b" | "helix-c" | "helix-d";
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-white/5 bg-white/[0.02] p-3">
      <div
        className="absolute -left-6 -top-6 h-16 w-16 rounded-full blur-2xl"
        style={{ background: `var(--color-${accent})`, opacity: 0.18 }}
      />
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-[var(--color-ink-400)]">
        <Icon className={`h-3 w-3 text-[var(--color-${accent})]`} />
        {label}
      </div>
      <div className="mt-1.5 font-mono text-lg font-semibold leading-none text-white">
        {value}
      </div>
      {hint && (
        <div className="mt-1 text-[10px] text-[var(--color-ink-500)]">
          {hint}
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-400)]">
        {label}
      </div>
      <div className="mt-1 font-mono text-base font-semibold text-white">
        {value}
      </div>
    </div>
  );
}

// Pagination is shared across pages; see components/pagination.tsx.
