"use client";

import { useEffect, useState } from "react";
import { Bot, Cpu, Dna, Sparkles } from "lucide-react";
import { shortAddress } from "@/lib/format";

const STEPS = [
  "Reading on-chain footprint…",
  "Mapping tokens to DNA families…",
  "Running AI narrative layer…",
  "Composing your Lab Report…",
];

/**
 * Full-width “AI is analyzing your wallet” moment shown once after connect.
 */
export function WalletAiScanAnimation({ address }: { address: string }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setStep((s) => (s + 1) % STEPS.length);
    }, 720);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative flex min-h-[420px] flex-col items-center justify-center overflow-hidden rounded-3xl border border-white/10 bg-[var(--color-ink-950)]/90 px-6 py-16 print:hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="lab-ai-aurora blob-a absolute -left-1/4 top-0 h-[420px] w-[420px] rounded-full bg-[var(--color-helix-a)]/20 blur-[100px]" />
        <div className="lab-ai-aurora blob-b absolute -right-1/4 bottom-0 h-[380px] w-[380px] rounded-full bg-[var(--color-helix-b)]/20 blur-[100px]" />
      </div>

      <div className="relative mb-8 flex h-32 w-32 items-center justify-center">
        <span className="lab-ai-ring absolute h-28 w-28 rounded-full border-2 border-[var(--color-helix-a)]/35" />
        <span className="lab-ai-ring lab-ai-ring-delay absolute h-36 w-36 rounded-full border border-[var(--color-helix-b)]/25" />
        <span className="lab-ai-ring lab-ai-ring-delay2 absolute h-44 w-44 rounded-full border border-[var(--color-helix-c)]/15" />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--color-helix-a)]/30 to-[var(--color-helix-b)]/20 ring-1 ring-white/10">
          <Bot className="h-9 w-9 text-white" />
        </div>
      </div>

      <p className="text-center text-xs font-medium uppercase tracking-[0.28em] text-[var(--color-helix-a)]">
        AI wallet analysis
      </p>
      <h2 className="mt-3 max-w-lg text-center text-2xl font-semibold tracking-tight text-white sm:text-3xl">
        Decoding your wallet
      </h2>
      <p className="mt-2 font-mono text-sm text-[var(--color-ink-300)]">
        {shortAddress(address, 6, 6)}
      </p>

      <div className="mt-10 flex min-h-[52px] items-center gap-2 text-center text-sm text-[var(--color-ink-200)]">
        <Sparkles className="h-4 w-4 shrink-0 animate-pulse text-[var(--color-helix-c)]" />
        <span key={step} className="lab-ai-step-text">
          {STEPS[step]}
        </span>
      </div>

      <div className="mt-10 flex flex-wrap justify-center gap-6 text-[11px] uppercase tracking-[0.14em] text-[var(--color-ink-500)]">
        <span className="inline-flex items-center gap-1.5">
          <Dna className="h-3.5 w-3.5 text-[var(--color-helix-a)]" /> DNA
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Cpu className="h-3.5 w-3.5 text-[var(--color-helix-b)]" /> Signals
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Bot className="h-3.5 w-3.5 text-[var(--color-helix-c)]" /> Narrative
        </span>
      </div>
    </div>
  );
}
