import Link from "next/link";
import { TrendingUp, Flame } from "lucide-react";
import { api } from "@/lib/api";
import { formatNumber, formatUsd } from "@/lib/format";

export const revalidate = 30;

export default async function TrendingPage() {
  let items: Awaited<ReturnType<typeof api.trending>>["items"] = [];
  let error: string | null = null;
  try {
    const r = await api.trending(24);
    items = r.items;
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <div className="page-shell space-y-6">
      <header>
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-[var(--color-helix-c)]">
          <Flame className="h-3 w-3" />
          Evolution curve · last 24h
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">
          Trending DNA
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink-400)]">
          Families ranked by <code className="font-mono">evolution_score</code>{" "}
          - a composite of mutation count, time-density of launches, and 24h
          volume. Top of the list = the fastest-growing real-world narrative on
          Four.Meme right now.
        </p>
      </header>

      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-white/5">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/[0.02] text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-400)]">
            <tr>
              <th className="px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">DNA Family</th>
              <th className="px-4 py-3 font-medium">Evolution</th>
              <th className="px-4 py-3 font-medium">Mutations</th>
              <th className="px-4 py-3 font-medium">24h Volume</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((t, i) => (
              <tr
                key={t.id}
                className="border-t border-white/5 transition-colors hover:bg-white/[0.025]"
              >
                <td className="px-4 py-3 font-mono text-[10px] text-[var(--color-ink-400)]">
                  {String(i + 1).padStart(2, "0")}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/family/${t.id}`}
                    className="block text-sm font-medium text-white hover:underline"
                  >
                    {t.event_title}
                  </Link>
                  <div className="mt-0.5 font-mono text-[10px] text-[var(--color-ink-500)]">
                    {t.id}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[var(--color-helix-a)] to-[var(--color-helix-c)]"
                        style={{
                          width: `${Math.min(100, (t.evolution_score / (items[0]?.evolution_score || 1)) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="font-mono text-[11px] text-white">
                      {t.evolution_score.toFixed(2)}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-[var(--color-ink-200)]">
                  {formatNumber(t.mutations_count)}
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-[var(--color-ink-200)]">
                  {formatUsd(t.total_volume_usd, { compact: true })}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/family/${t.id}`}
                    className="inline-flex items-center gap-1 text-[11px] text-[var(--color-ink-400)] hover:text-white"
                  >
                    open <TrendingUp className="h-3 w-3" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
