"use client";

import Link from "next/link";
import { FlaskConical, Lock, Wallet } from "lucide-react";
import { ConnectWallet } from "@/components/connect-wallet";
import { MEMELAB_TAGLINE } from "@/lib/brand";

export function LabReportWalletGate() {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[var(--color-ink-900)]/80 p-8 sm:p-12 print:hidden">
      <div className="pointer-events-none absolute -right-20 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full bg-[var(--color-helix-b)]/10 blur-[100px]" />
      <div className="relative mx-auto max-w-lg text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-black/40">
          <Lock className="h-7 w-7 text-[var(--color-helix-a)]" />
        </div>
        <p className="mt-6 text-[10px] font-medium uppercase tracking-[0.28em] text-[var(--color-helix-a)]">
          Lab Report
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Connect your wallet to continue
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-[var(--color-ink-300)]">
          {MEMELAB_TAGLINE} Lab Report runs AI-assisted analysis on your
          connected wallet (and any token you choose). We only read your public address;
          nothing is signed except the wallet app&apos;s own connect flow.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <ConnectWallet />
          <Link
            href="/"
            className="text-xs text-[var(--color-ink-400)] hover:text-white"
          >
            Back to Overview
          </Link>
        </div>
        <div className="mt-10 flex justify-center gap-8 text-[11px] text-[var(--color-ink-500)]">
          <span className="inline-flex items-center gap-1.5">
            <FlaskConical className="h-3.5 w-3.5 text-[var(--color-helix-b)]" />
            Wallet &amp; token reports
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Wallet className="h-3.5 w-3.5 text-[var(--color-helix-c)]" />
            BNB Chain
          </span>
        </div>
      </div>
    </div>
  );
}
