"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, Wallet, Coins } from "lucide-react";

type Mode = "auto" | "wallet";

function isAddr(q: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(q.trim());
}
function isFamilyId(q: string) {
  return /^fam_[a-f0-9]{8,}$/.test(q.trim());
}

export function SearchBar() {
  const [q, setQ] = React.useState("");
  const [mode, setMode] = React.useState<Mode>("auto");
  const router = useRouter();

  function go(target: string) {
    setQ("");
    router.push(target);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = q.trim();
    if (!v) return;
    // Explicit "wallet:0x…" prefix always wins.
    const walletPrefix = v.match(/^(?:wallet:|w:)\s*(0x[a-fA-F0-9]{40})$/i);
    if (walletPrefix) {
      go(`/my-dna?address=${walletPrefix[1].toLowerCase()}`);
      return;
    }
    if (isFamilyId(v)) {
      go(`/family/${v}`);
      return;
    }
    if (isAddr(v)) {
      if (mode === "wallet") go(`/my-dna?address=${v.toLowerCase()}`);
      else go(`/mutation/${v.toLowerCase()}`);
      return;
    }
    go(`/families?q=${encodeURIComponent(v)}`);
  }

  const tokenActive = mode === "auto";
  const walletActive = mode === "wallet";
  const placeholder =
    mode === "wallet"
      ? "Wallet 0x… to view its DNA"
      : "Token 0x… · Family fam_… · or text";

  return (
    <form
      onSubmit={onSubmit}
      className="relative hidden w-72 sm:flex md:w-[22rem]"
      role="search"
    >
      {/* Mode pill: token (default) | wallet */}
      <div
        role="tablist"
        aria-label="Search mode"
        className="mr-2 inline-flex items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.04] p-0.5"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tokenActive}
          onClick={() => setMode("auto")}
          title="Search a token, family, or free text"
          className={[
            "inline-flex h-7 items-center gap-1 rounded-full px-2 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors",
            tokenActive
              ? "bg-gradient-to-r from-[var(--color-helix-a)] to-[var(--color-helix-c)] text-[var(--color-ink-950)]"
              : "text-[var(--color-ink-300)] hover:text-white",
          ].join(" ")}
        >
          <Coins className="h-3 w-3" />
          Token
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={walletActive}
          onClick={() => setMode("wallet")}
          title="Decode any wallet's DNA (deployed tokens, families touched)"
          className={[
            "inline-flex h-7 items-center gap-1 rounded-full px-2 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors",
            walletActive
              ? "bg-gradient-to-r from-[var(--color-helix-b)] to-[var(--color-helix-c)] text-[var(--color-ink-950)]"
              : "text-[var(--color-ink-300)] hover:text-white",
          ].join(" ")}
        >
          <Wallet className="h-3 w-3" />
          Wallet
        </button>
      </div>

      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-ink-400)]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          aria-label={
            mode === "wallet" ? "Search wallet by address" : "Search tokens, families"
          }
          className="w-full rounded-full border border-white/5 bg-white/[0.04] py-1.5 pl-9 pr-3 text-xs text-white outline-none ring-0 transition placeholder:text-[var(--color-ink-400)] focus:border-[var(--color-helix-a)]/40 focus:bg-white/[0.06]"
        />
      </div>
    </form>
  );
}
