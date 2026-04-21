import Link from "next/link";
import { X } from "lucide-react";
import { FamilyCard } from "@/components/family-card";
import { Pagination } from "@/components/pagination";
import { api, type FamiliesQuery } from "@/lib/api";
import type { DnaFamily } from "@/lib/types";

type SortKey = NonNullable<FamiliesQuery["sort"]>;

type Props = {
  searchParams?: Promise<{
    q?: string;
    limit?: string;
    offset?: string;
    sort?: string;
    min_conf?: string;
    min_muts?: string;
  }>;
};

const SORTS: { key: SortKey; label: string; hint: string }[] = [
  { key: "evolution_score", label: "Evolution", hint: "Fastest growing" },
  { key: "volume", label: "Volume", hint: "24h money flow" },
  { key: "mutations", label: "Mutations", hint: "Largest clusters" },
  { key: "created_at", label: "Newest", hint: "Latest clusters" },
];

const LIMITS = [12, 24, 48, 60];

function buildQs(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    qs.set(k, String(v));
  }
  return qs.toString() ? `?${qs.toString()}` : "";
}

export default async function FamiliesPage({ searchParams }: Props) {
  const sp = (await searchParams) ?? {};
  const q = (sp.q ?? "").toString().trim();
  const limit = LIMITS.includes(Number(sp.limit))
    ? Number(sp.limit)
    : 24;
  const offset = Math.max(0, Number(sp.offset ?? 0));
  const sortParam = (sp.sort ?? "evolution_score") as SortKey;
  const sort: SortKey = SORTS.some((s) => s.key === sortParam)
    ? sortParam
    : "evolution_score";
  const minConf = Math.max(0, Math.min(1, Number(sp.min_conf ?? 0.3)));
  const minMuts = Math.max(1, Math.min(50, Number(sp.min_muts ?? 2)));

  let families: DnaFamily[] = [];
  let total = 0;
  let error: string | null = null;

  try {
    const data = await api.families({
      limit,
      offset,
      sort,
      q: q || undefined,
      min_confidence: minConf,
      min_mutations: minMuts,
    });
    families = data.items;
    total = data.total;
  } catch (e) {
    error = (e as Error).message;
  }

  // Canonical link builder. Any filter change preserves everything else
  // *except* offset, which gets reset - otherwise paginating can silently
  // land users on an empty page.
  const linkFor = (override: Partial<Record<string, string | number>>) =>
    `/families${buildQs({
      q: q || undefined,
      sort,
      limit,
      offset: 0,
      min_conf: minConf !== 0.3 ? minConf : undefined,
      min_muts: minMuts !== 2 ? minMuts : undefined,
      ...override,
    })}`;

  const pageNum = Math.floor(offset / limit) + 1;
  const pageUrl = (p: number) =>
    `/families${buildQs({
      q: q || undefined,
      sort,
      limit,
      offset: Math.max(0, (p - 1) * limit),
      min_conf: minConf !== 0.3 ? minConf : undefined,
      min_muts: minMuts !== 2 ? minMuts : undefined,
    })}`;

  const filtersActive =
    q !== "" ||
    sort !== "evolution_score" ||
    minConf !== 0.3 ||
    minMuts !== 2 ||
    limit !== 24;

  return (
    <div className="page-shell space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">
            DNA Families
          </h1>
          <p className="mt-1 text-sm text-[var(--color-ink-400)]">
            Every cluster of Four.Meme tokens that trace back to the same
            real-world event.{" "}
            <span className="text-[var(--color-ink-200)]">
              {total.toLocaleString("en-US")} match filter
            </span>
          </p>
        </div>

        <form className="flex flex-wrap items-center gap-2" action="/families" method="get">
          {/* Preserve every other filter when the search box submits. */}
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="limit" value={limit} />
          <input type="hidden" name="min_conf" value={minConf} />
          <input type="hidden" name="min_muts" value={minMuts} />
          <input
            name="q"
            defaultValue={q}
            placeholder="Search event, narrative, ticker…"
            className="w-64 rounded-full border border-white/10 bg-white/[0.03] px-4 py-1.5 text-xs text-white outline-none placeholder:text-[var(--color-ink-400)] focus:border-[var(--color-helix-a)]/40"
          />
          <button className="rounded-full border border-[var(--color-helix-a)]/30 bg-[var(--color-helix-a)]/10 px-3 py-1.5 text-xs text-white transition-colors hover:bg-[var(--color-helix-a)]/20">
            Search
          </button>
          {filtersActive && (
            <Link
              href="/families"
              className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-[var(--color-ink-300)] hover:bg-white/[0.08]"
            >
              <X className="h-3 w-3" />
              Reset
            </Link>
          )}
        </form>
      </header>

      {/* FILTER TOOLBAR - active chips + sort + size + thresholds */}
      <div className="glass flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl p-4">
        <FilterGroup label="Sort">
          {SORTS.map((s) => {
            const active = s.key === sort;
            return (
              <Link
                key={s.key}
                href={linkFor({ sort: s.key })}
                className={chipCls(active)}
                title={s.hint}
              >
                {s.label}
              </Link>
            );
          })}
        </FilterGroup>

        <FilterGroup label="Page size">
          {LIMITS.map((n) => (
            <Link
              key={n}
              href={linkFor({ limit: n })}
              className={chipCls(n === limit)}
            >
              {n}
            </Link>
          ))}
        </FilterGroup>

        <FilterGroup label="Min confidence">
          {[0.1, 0.3, 0.5, 0.7].map((c) => (
            <Link
              key={c}
              href={linkFor({ min_conf: c === 0.3 ? undefined : c })}
              className={chipCls(c === minConf)}
            >
              {Math.round(c * 100)}%
            </Link>
          ))}
        </FilterGroup>

        <FilterGroup label="Min mutations">
          {[1, 2, 5, 10].map((n) => (
            <Link
              key={n}
              href={linkFor({ min_muts: n === 2 ? undefined : n })}
              className={chipCls(n === minMuts)}
            >
              ≥ {n}
            </Link>
          ))}
        </FilterGroup>
      </div>

      {q && (
        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-helix-b)]/30 bg-[var(--color-helix-b)]/10 px-3 py-1 text-xs text-white">
          Searching for &ldquo;{q}&rdquo;
          <Link
            href={linkFor({ q: undefined })}
            className="text-[var(--color-ink-300)] hover:text-white"
          >
            <X className="h-3 w-3" />
          </Link>
        </div>
      )}

      {error ? (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-200">
          {error}
        </div>
      ) : families.length === 0 ? (
        <NoResults q={q} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {families.map((f, i) => (
            <FamilyCard key={f.id} family={f} rank={offset + i + 1} />
          ))}
        </div>
      )}

      <Pagination
        total={total}
        limit={limit}
        page={pageNum}
        buildUrl={pageUrl}
        unit="families"
      />
    </div>
  );
}

function NoResults({ q }: { q: string }) {
  const trimmed = q.trim();
  const isAddr =
    trimmed.startsWith("0x") &&
    trimmed.length === 42 &&
    /^[0-9a-fA-F]+$/.test(trimmed.slice(2));
  return (
    <div className="glass space-y-4 rounded-2xl p-10 text-center text-sm text-[var(--color-ink-300)]">
      <div>
        No families match{" "}
        <span className="font-mono text-white">{trimmed || "this filter"}</span>
        .
      </div>
      {isAddr && (
        <div className="space-y-2">
          <p className="text-xs text-[var(--color-ink-400)]">
            That looks like a Four.Meme token address. It may not belong to any
            clustered family yet (min-mutations filter, or still cold). Try:
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Link
              href={`/mutation/${trimmed.toLowerCase()}`}
              className="rounded-full border border-[var(--color-helix-a)]/30 bg-[var(--color-helix-a)]/10 px-4 py-1.5 text-xs text-white hover:bg-[var(--color-helix-a)]/20"
            >
              Open mutation page →
            </Link>
            <Link
              href={`/families?q=${trimmed}&min_muts=1&min_conf=0.1`}
              className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-1.5 text-xs text-[var(--color-ink-200)] hover:bg-white/[0.08]"
            >
              Search with loose filters
            </Link>
          </div>
        </div>
      )}
      {!isAddr && (
        <Link href="/families" className="text-white underline">
          Reset filters
        </Link>
      )}
    </div>
  );
}

function chipCls(active: boolean): string {
  return [
    "rounded-full border px-3 py-1.5 text-xs transition-colors",
    active
      ? "border-[var(--color-helix-a)]/40 bg-[var(--color-helix-a)]/10 text-white"
      : "border-white/10 bg-white/[0.02] text-[var(--color-ink-300)] hover:bg-white/[0.06] hover:text-white",
  ].join(" ");
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-400)]">
        {label}
      </span>
      {children}
    </div>
  );
}
