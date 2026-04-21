import Link from "next/link";
import { ExternalLink, Sparkles } from "lucide-react";
import { StrainBadge } from "./strain-badge";
import { shortAddress, timeAgo, formatUsd, formatPrice } from "@/lib/format";
import type { Mutation } from "@/lib/types";

export function MutationRow({ m }: { m: Mutation }) {
  const tags: React.ReactNode[] = [];
  if (m.is_origin_strain)
    tags.push(
      <StrainBadge
        key="o"
        kind="origin"
        strain={{ token: m.token_address, symbol: m.symbol }}
        compact
      />
    );
  if (m.is_dominant_strain)
    tags.push(
      <StrainBadge
        key="d"
        kind="dominant"
        strain={{ token: m.token_address, symbol: m.symbol }}
        compact
      />
    );
  if (m.is_fastest_mutation)
    tags.push(
      <StrainBadge
        key="f"
        kind="fastest"
        strain={{ token: m.token_address, symbol: m.symbol }}
        compact
      />
    );

  const reason = m.why_this_mutation_belongs?.trim();

  return (
    <>
      <tr className="group border-t border-white/5 transition-colors hover:bg-white/[0.03]">
        <td className="px-3 py-3 align-top">
          <Link
            href={`/mutation/${m.token_address}`}
            className="flex min-w-0 items-center gap-3 rounded-lg -m-1 p-1 transition-colors hover:bg-white/[0.03]"
          >
            <div className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-gradient-to-br from-[var(--color-helix-a)]/25 to-[var(--color-helix-b)]/20 font-mono text-[10px] font-semibold text-white ring-1 ring-white/5 transition-transform group-hover:scale-105">
              {(m.symbol || "?").slice(0, 3).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-white group-hover:text-[var(--color-helix-a)]">
                {m.symbol || "-"}
              </div>
              <div className="truncate text-[11px] text-[var(--color-ink-400)] group-hover:text-[var(--color-ink-200)]">
                {m.name || "Unnamed"}
              </div>
            </div>
          </Link>
        </td>
        <td className="px-3 py-3 align-top font-mono text-[11px] text-[var(--color-ink-300)]">
          <Link
            href={`/mutation/${m.token_address}`}
            className="hover:text-white hover:underline"
          >
            {shortAddress(m.token_address)}
          </Link>
        </td>
        <td className="px-3 py-3 align-top text-[11px] text-[var(--color-ink-400)]">
          {timeAgo(m.created_at)}
        </td>
        <td className="px-3 py-3 align-top font-mono text-[11px] text-[var(--color-ink-200)]">
          {formatPrice(m.trading?.price_usd)}
        </td>
        <td className="px-3 py-3 align-top font-mono text-[11px] text-[var(--color-ink-200)]">
          {formatUsd(m.trading?.volume_24h_usd, { compact: true })}
        </td>
        <td className="px-3 py-3 align-top font-mono text-[11px] text-[var(--color-ink-200)]">
          {formatUsd(m.trading?.liquidity_usd, { compact: true })}
        </td>
        <td className="px-3 py-3 align-top">
          <div className="flex flex-wrap items-center gap-1.5">
            {tags.length === 0 ? (
              <span className="text-[11px] text-[var(--color-ink-500)]">-</span>
            ) : (
              tags
            )}
          </div>
        </td>
        <td className="px-3 py-3 align-top">
          <div className="flex items-center gap-2 text-[11px]">
            <a
              href={`https://four.meme/token/${m.token_address}`}
              target="_blank"
              rel="noreferrer"
              title="Open on Four.Meme"
              className="inline-flex items-center gap-1 rounded-md border border-white/5 bg-white/[0.03] px-2 py-1 text-[var(--color-ink-300)] transition-colors hover:bg-[var(--color-helix-a)]/10 hover:text-[var(--color-helix-a)]"
            >
              four.meme <ExternalLink className="h-2.5 w-2.5" />
            </a>
            <a
              href={`https://bscscan.com/token/${m.token_address}`}
              target="_blank"
              rel="noreferrer"
              title="Open on BscScan"
              className="inline-flex items-center gap-1 rounded-md border border-white/5 bg-white/[0.03] px-2 py-1 text-[var(--color-ink-300)] transition-colors hover:bg-white/10 hover:text-white"
            >
              bscscan <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </div>
        </td>
      </tr>
      {reason && (
        <tr className="border-t-0">
          <td colSpan={8} className="px-3 pb-3">
            <div className="ml-12 flex items-start gap-2 rounded-md border border-white/5 bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-[var(--color-ink-200)]">
              <Sparkles className="mt-[2px] h-3 w-3 flex-none text-[var(--color-helix-b)]" />
              <span className="italic">{reason}</span>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Table of mutations. For huge families (DexScreener-grade meta families with
 * 500+ tokens) rendering every row at once produces >10MB of HTML and a ~2s
 * hydration pause. So we:
 *   1. Sort "important" mutations first (roles → volume → liquidity → age).
 *   2. Show ``initialLimit`` rows inline; the rest lives inside a native
 *      <details> disclosure so the browser never touches the DOM until the
 *      user asks for it.
 */
export function MutationTable({
  mutations,
  initialLimit = 50,
}: {
  mutations: Mutation[];
  initialLimit?: number;
}) {
  const sorted = [...mutations].sort((a, b) => _importance(b) - _importance(a));
  const head = sorted.slice(0, initialLimit);
  const tail = sorted.slice(initialLimit);

  const Header = (
    <thead>
      <tr className="bg-white/[0.02] text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-400)]">
        <th className="px-3 py-2 font-medium">Token</th>
        <th className="px-3 py-2 font-medium">Address</th>
        <th className="px-3 py-2 font-medium">Launched</th>
        <th className="px-3 py-2 font-medium">Price</th>
        <th className="px-3 py-2 font-medium">24h Vol</th>
        <th className="px-3 py-2 font-medium">Liquidity</th>
        <th className="px-3 py-2 font-medium">Role</th>
        <th className="px-3 py-2 font-medium"></th>
      </tr>
    </thead>
  );

  return (
    <div className="scrollbar-slim overflow-x-auto rounded-xl border border-white/5">
      <table className="min-w-full text-left text-sm">
        {Header}
        <tbody>
          {head.map((m) => (
            <MutationRow key={m.token_address} m={m} />
          ))}
        </tbody>
      </table>
      {tail.length > 0 && (
        <details className="group border-t border-white/5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-white/[0.02] px-4 py-2.5 text-xs text-[var(--color-ink-300)] transition-colors hover:bg-white/[0.05]">
            <span>
              <span className="font-medium text-white">+{tail.length}</span>{" "}
              more mutations in this family
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-400)] group-open:hidden">
              expand ↓
            </span>
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-400)] group-open:inline">
              collapse ↑
            </span>
          </summary>
          <table className="min-w-full text-left text-sm">
            {Header}
            <tbody>
              {tail.map((m) => (
                <MutationRow key={m.token_address} m={m} />
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

function _importance(m: Mutation): number {
  let score = 0;
  if (m.is_origin_strain) score += 1_000_000;
  if (m.is_dominant_strain) score += 500_000;
  if (m.is_fastest_mutation) score += 250_000;
  score += (m.trading?.volume_24h_usd ?? 0) / 1_000;
  score += (m.trading?.liquidity_usd ?? 0) / 10_000;
  return score;
}
