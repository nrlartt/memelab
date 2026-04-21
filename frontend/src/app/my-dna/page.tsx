"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Dna,
  Droplet,
  ExternalLink,
  GitBranch,
  Rocket,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { api } from "@/lib/api";
import {
  formatNumber,
  formatPrice,
  formatUsd,
  shortAddress,
  timeAgo,
} from "@/lib/format";
import type { WalletDna } from "@/lib/types";

const STORAGE_KEY = "memedna.wallet";
const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

// `useSearchParams` must live inside a <Suspense> boundary or Next 15
// refuses to statically prerender the page. The page itself is fully
// client-rendered anyway (localStorage + MetaMask), so Suspense is just
// ceremony - but it's the documented escape hatch.
export default function MyDnaPage() {
  return (
    <React.Suspense
      fallback={
        <div className="page-shell py-16 text-center text-sm text-[var(--color-ink-300)]">
          Decoding wallet…
        </div>
      }
    >
      <MyDnaView />
    </React.Suspense>
  );
}

function MyDnaView() {
  // The page works in three modes:
  //   1. ?address=0x… → look up someone else's wallet (read-only)
  //   2. localStorage  → resume the previously connected wallet
  //   3. otherwise     → show the connect-wallet CTA
  // The URL form takes precedence so the search bar always wins.
  const search = useSearchParams();
  const queryAddr = (search.get("address") || "").toLowerCase().trim();
  const lookupAddr = ADDR_RE.test(queryAddr) ? queryAddr : null;

  const [addr, setAddr] = React.useState<string | null>(null);
  const [data, setData] = React.useState<WalletDna | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  // When an `?address=` is present, we *do not* persist it as the
  // user's connected wallet - it's just a lookup. Otherwise we resume
  // whatever was last connected.
  React.useEffect(() => {
    if (lookupAddr) {
      setAddr(lookupAddr);
      return;
    }
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setAddr(stored);
  }, [lookupAddr]);

  React.useEffect(() => {
    if (!addr) return;
    setLoading(true);
    setErr(null);
    api
      .wallet(addr)
      .then((d) => setData(d))
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [addr]);

  async function connect() {
    const eth = (window as Window).ethereum;
    if (!eth) {
      window.open("https://metamask.io/download", "_blank");
      return;
    }
    try {
      const accts = (await eth.request({
        method: "eth_requestAccounts",
      })) as string[];
      if (accts?.[0]) {
        const a = accts[0].toLowerCase();
        localStorage.setItem(STORAGE_KEY, a);
        setAddr(a);
      }
    } catch {
      /* user rejected */
    }
  }

  if (!addr) {
    return (
      <div className="page-shell mx-auto max-w-2xl space-y-6 py-16 text-center">
        <div className="grid h-20 w-20 place-items-center rounded-2xl bg-gradient-to-br from-[var(--color-helix-a)]/25 to-[var(--color-helix-c)]/25 text-white ring-1 ring-white/10 mx-auto">
          <Dna className="h-10 w-10 text-[var(--color-helix-a)]" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-white">
          Your wallet, <span className="gradient-text">decoded</span>.
        </h1>
        <p className="text-sm text-[var(--color-ink-300)]">
          Connect an EOA on BNB Chain and MemeLab will lay out every Four.Meme
          token you&apos;ve ever deployed, mapped onto the DNA Families they
          spawned from. You can also search any wallet from the top bar to
          inspect it read-only.
        </p>
        <button
          onClick={connect}
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[var(--color-helix-a)] to-[var(--color-helix-c)] px-5 py-2 text-sm font-semibold text-[var(--color-ink-950)]"
        >
          <Wallet className="h-4 w-4" /> Connect wallet
        </button>
      </div>
    );
  }

  const isLookup = lookupAddr !== null;

  if (loading && !data) {
    return (
      <div className="page-shell py-16 text-center text-sm text-[var(--color-ink-300)]">
        Decoding the DNA of {shortAddress(addr, 8, 8)}…
      </div>
    );
  }

  if (err) {
    return (
      <div className="page-shell">
        <div className="glass rounded-2xl p-8 text-center text-sm text-[var(--color-bad)]">
          Failed to load wallet DNA: {err}
        </div>
      </div>
    );
  }

  if (!data) return null;
  const s = data.stats;

  return (
    <div className="page-shell space-y-6">
      <header className="relative overflow-hidden rounded-3xl border border-white/5 bg-[var(--color-ink-950)]/70 p-6 sm:p-8">
        <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-[var(--color-helix-b)]/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-[var(--color-ink-300)]">
              <Dna className="h-3 w-3 text-[var(--color-helix-a)]" />
              {isLookup ? "Wallet DNA · read-only" : "Your Wallet DNA"}
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {shortAddress(addr, 10, 8)}
            </h1>
            <div className="mt-2 flex items-center gap-3 text-xs text-[var(--color-ink-400)]">
              <a
                href={`https://bscscan.com/address/${addr}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-white"
              >
                BscScan <ExternalLink className="h-3 w-3" />
              </a>
              <a
                href={`https://four.meme/user/${addr}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-white"
              >
                Four.Meme profile <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
          {isLookup ? (
            <Link
              href="/my-dna"
              className="self-start rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] text-[var(--color-ink-300)] hover:bg-white/[0.08] hover:text-white"
            >
              Back to my wallet
            </Link>
          ) : (
            <button
              onClick={() => {
                localStorage.removeItem(STORAGE_KEY);
                setAddr(null);
                setData(null);
              }}
              className="self-start rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] text-[var(--color-ink-300)] hover:bg-white/[0.08] hover:text-white"
            >
              Disconnect
            </button>
          )}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat
          icon={<Rocket className="h-4 w-4 text-[var(--color-helix-d)]" />}
          label="Tokens deployed"
          value={formatNumber(s.tokens_deployed)}
        />
        <Stat
          icon={<Dna className="h-4 w-4 text-[var(--color-helix-a)]" />}
          label="DNA Families touched"
          value={formatNumber(s.families_touched)}
        />
        <Stat
          icon={<TrendingUp className="h-4 w-4 text-[var(--color-helix-c)]" />}
          label="24h volume"
          value={formatUsd(s.total_volume_24h_usd, { compact: true })}
        />
        <Stat
          icon={<Droplet className="h-4 w-4 text-[var(--color-helix-a)]" />}
          label="Liquidity"
          value={formatUsd(s.total_liquidity_usd, { compact: true })}
        />
        <Stat
          icon={<Sparkles className="h-4 w-4 text-[var(--color-good)]" />}
          label="Migrated"
          value={formatNumber(s.migrated_count)}
        />
      </div>

      {data.deployed.length === 0 ? (
        <div className="glass rounded-2xl p-10 text-center text-sm text-[var(--color-ink-300)]">
          This wallet hasn&apos;t deployed any Four.Meme token that MemeLab has
          seen yet. If you just launched one, wait for the next pipeline tick
          ({"~5 min"}).
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {data.deployed.map((t) => (
            <Link
              key={t.token_address}
              href={`/mutation/${t.token_address}`}
              className="group flex flex-col rounded-2xl border border-white/5 bg-[var(--color-ink-950)]/70 p-4 transition-all hover:-translate-y-[1px] hover:border-[var(--color-helix-a)]/30"
            >
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-[var(--color-helix-a)]/25 to-[var(--color-helix-b)]/20 font-mono text-[11px] font-bold text-white ring-1 ring-white/10">
                  {(t.symbol || "?").slice(0, 3).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-white group-hover:text-[var(--color-helix-a)]">
                    {t.symbol || "-"}
                  </div>
                  <div className="truncate text-[11px] text-[var(--color-ink-400)]">
                    {t.name || "Unnamed"}
                  </div>
                </div>
                {t.migrated && (
                  <span className="flex-none rounded-full bg-[var(--color-good)]/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--color-good)]">
                    migrated
                  </span>
                )}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-mono text-[var(--color-ink-200)]">
                <span>Vol {formatUsd(t.volume_24h_usd, { compact: true })}</span>
                <span>Liq {formatUsd(t.liquidity_usd, { compact: true })}</span>
                <span>Px {formatPrice(t.price_usd)}</span>
                <span>{timeAgo(t.created_at)}</span>
              </div>
              {t.family_id && (
                <div className="mt-3 border-t border-white/5 pt-2 text-[11px] text-[var(--color-ink-400)]">
                  <span className="inline-flex items-center gap-1">
                    <GitBranch className="h-3 w-3 text-[var(--color-helix-b)]" />
                    <span className="truncate">{t.family_title}</span>
                  </span>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/5 bg-[var(--color-ink-950)]/60 p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-400)]">
        {icon}
        {label}
      </div>
      <div className="mt-2 font-mono text-xl font-semibold tracking-tight text-white">
        {value}
      </div>
    </div>
  );
}

type Window = typeof globalThis & {
  ethereum?: {
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  };
};
