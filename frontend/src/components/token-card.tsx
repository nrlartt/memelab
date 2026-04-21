import Link from "next/link";
import {
  Activity,
  Droplet,
  ExternalLink,
  GitBranch,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import type { ExplorerToken } from "@/lib/types";
import {
  formatNumber,
  formatPrice,
  formatUsd,
  shortAddress,
  timeAgo,
} from "@/lib/format";
import { TokenAvatar } from "@/components/token-avatar";

/**
 * Premium token card used in the Explorer grid.
 *
 * - Entire card is clickable via an absolutely-positioned Link overlay
 *   so we can legally put a sibling <a> (four.meme) inside the same card.
 * - Accent halo pulses stronger when a token already belongs to a family
 *   or has migrated - subtle visual hierarchy for "signal-rich" tokens.
 */
export function TokenCard({ t }: { t: ExplorerToken }) {
  const prog = Math.min(100, Math.round((t.bonding_progress || 0) * 100));
  const isSignal = t.migrated || !!t.family_id || (t.volume_24h_usd || 0) > 25_000;
  const accent = t.migrated
    ? "var(--color-good)"
    : t.family_id
    ? "var(--color-helix-b)"
    : (t.volume_24h_usd || 0) > 25_000
    ? "var(--color-helix-c)"
    : "var(--color-helix-a)";

  return (
    <div
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/5 bg-[var(--color-ink-950)]/80 p-4 transition-all hover:-translate-y-[2px] hover:border-white/10 hover:shadow-[0_20px_60px_-30px_rgba(94,247,209,0.45)]"
    >
      {/* Accent halo */}
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-30 blur-3xl transition-opacity group-hover:opacity-60"
        style={{ background: accent }}
      />

      <Link
        href={`/mutation/${t.token_address}`}
        aria-label={`Open ${t.symbol || t.token_address}`}
        className="absolute inset-0 z-[1]"
      />

      {/* HEAD */}
      <div className="relative z-[2] flex items-center gap-3">
        <TokenAvatar
          src={t.image_url}
          symbol={t.symbol}
          size={44}
          accent={accent}
          rounded="xl"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white transition-colors group-hover:text-[var(--color-helix-a)]">
            {t.symbol || "-"}
          </div>
          <div className="truncate text-[11px] text-[var(--color-ink-400)]">
            {t.name || "Unnamed"}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {t.migrated && (
            <span className="rounded-full bg-[var(--color-good)]/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--color-good)]">
              migrated
            </span>
          )}
          {!t.migrated && isSignal && (
            <span className="rounded-full bg-[var(--color-helix-c)]/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--color-helix-c)]">
              heating up
            </span>
          )}
        </div>
      </div>

      {/* METRICS */}
      <div className="relative z-[2] mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] text-[var(--color-ink-400)]">
        <KV
          icon={<TrendingUp className="h-3 w-3 text-[var(--color-helix-c)]" />}
          label="24h"
          value={formatUsd(t.volume_24h_usd, { compact: true })}
        />
        <KV
          icon={<Droplet className="h-3 w-3 text-[var(--color-helix-a)]" />}
          label="Liq"
          value={formatUsd(t.liquidity_usd, { compact: true })}
        />
        <KV
          icon={<Sparkles className="h-3 w-3 text-[var(--color-helix-d)]" />}
          label="Px"
          value={formatPrice(t.price_usd)}
        />
        <KV
          icon={<Users className="h-3 w-3 text-[var(--color-helix-a)]" />}
          label="Holders"
          value={t.holders > 0 ? formatNumber(t.holders) : "-"}
        />
        {(t.trades_24h || 0) > 0 && (
          <KV
            icon={<Activity className="h-3 w-3 text-[var(--color-helix-b)]" />}
            label="Trades"
            value={formatNumber(t.trades_24h || 0)}
          />
        )}
      </div>

      {/* BONDING PROGRESS */}
      {!t.migrated && (
        <div className="relative z-[2] mt-3">
          <div className="flex items-center justify-between text-[9px] uppercase tracking-[0.14em] text-[var(--color-ink-400)]">
            <span>bonding curve</span>
            <span className="font-mono text-[var(--color-ink-200)]">
              {prog}%
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[var(--color-helix-a)] via-[var(--color-helix-b)] to-[var(--color-helix-c)] transition-[width]"
              style={{ width: `${prog}%` }}
            />
          </div>
        </div>
      )}

      {/* FOOTER */}
      <div className="relative z-[2] mt-3 flex items-center justify-between border-t border-white/5 pt-3 text-[10px] text-[var(--color-ink-500)]">
        <span className="font-mono">
          {shortAddress(t.token_address, 5, 4)} · {timeAgo(t.created_at)}
        </span>
        <div className="flex items-center gap-2">
          {t.family_id && (
            <Link
              href={`/family/${t.family_id}`}
              title={t.family_title || ""}
              className="relative z-[3] inline-flex max-w-[110px] items-center gap-1 truncate rounded-full bg-[var(--color-helix-b)]/10 px-1.5 py-0.5 text-[9px] text-[var(--color-helix-b)] hover:bg-[var(--color-helix-b)]/20"
            >
              <GitBranch className="h-2.5 w-2.5" />
              family
            </Link>
          )}
          <a
            href={`https://four.meme/token/${t.token_address}`}
            target="_blank"
            rel="noreferrer"
            className="relative z-[3] inline-flex items-center gap-0.5 rounded-md border border-white/5 bg-white/[0.03] px-1.5 py-0.5 text-[9px] hover:bg-[var(--color-helix-a)]/10 hover:text-[var(--color-helix-a)]"
          >
            four.meme <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
      </div>
    </div>
  );
}

function KV({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 font-mono">
      {icon}
      <span className="text-[9px] uppercase tracking-[0.14em] text-[var(--color-ink-400)]">
        {label}
      </span>
      <span className="truncate text-white">{value}</span>
    </div>
  );
}
