import { Brain, Database, Globe2, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import type { StackInfo } from "@/lib/types";
import {
  prettyReasoningStack,
  prettyResearchChain,
} from "@/lib/humanize";

/**
 * Thin strip shown on the Overview page so users immediately see *what* is
 * powering the current view. Every label is user-friendly: we never
 * surface raw model slugs (``openai/gpt-oss-120b``) or provider chains
 * (``tavily > serpapi > jina``) directly - see ``lib/humanize.ts``.
 *
 * Fetches ``/stack-info`` on the server; degrades to a neutral banner on error.
 */
export async function StackStrip() {
  let stack: StackInfo | null = null;
  try {
    stack = await api.stack();
  } catch {
    return null;
  }

  const chat = stack.chat_llm;
  const embed = stack.embeddings;
  const ds = stack.data_sources;
  const research = stack.research;
  const chain = stack.blockchain;

  const research_pretty = prettyResearchChain(research.provider);

  const chips: Array<{
    icon: React.ReactNode;
    label: string;
    value: string;
    tone: "ok" | "warn" | "muted";
    hint?: string;
  }> = [
    {
      icon: <Brain className="h-3.5 w-3.5" />,
      label: "Reasoning AI",
      value: chat.enabled
        ? prettyReasoningStack(chat.provider, chat.model)
        : "Offline (heuristic clustering only)",
      tone: chat.enabled ? "ok" : "warn",
      hint: chat.enabled
        ? "Validates every cluster, writes the plain-English event summary, and explains per-token reasoning."
        : "Add an OpenAI-compatible key to turn the reasoning layer back on.",
    },
    {
      icon: <Brain className="h-3.5 w-3.5" />,
      label: "Semantic space",
      value: embed.enabled
        ? "Real embedding model"
        : "Local semantic hash (fallback)",
      tone: embed.enabled ? "ok" : "muted",
      hint: embed.fallback
        ? "Deterministic CPU-only fallback. Works but less nuanced than a real embedding model."
        : "High-dimensional vector space drives the cluster discovery.",
    },
    {
      icon: <Database className="h-3.5 w-3.5" />,
      label: "Live data",
      value: [
        ds.four_meme_onchain && "Four.Meme on-chain",
        ds.dexscreener && "DexScreener prices",
        ds.bitquery && "Bitquery history",
      ]
        .filter(Boolean)
        .join(" · ") || "limited",
      tone: "ok",
      hint: "Every number on this page comes from public, verifiable sources.",
    },
    {
      icon: <Globe2 className="h-3.5 w-3.5" />,
      label: "Event research",
      value: research.enabled ? research_pretty.summary : "Disabled",
      tone: research.enabled ? "ok" : "muted",
      hint: research_pretty.hint,
    },
    {
      icon: <ShieldCheck className="h-3.5 w-3.5" />,
      label: "BNB anchor",
      value: chain.registry
        ? `On-chain: ${chain.anchor_address?.slice(0, 8)}…`
        : "Registry offline",
      tone: chain.registry ? "ok" : "muted",
      hint: chain.registry
        ? "Family fingerprints are anchored to BNB Chain for public auditing."
        : "Deploy the on-chain registry contract (MemeDNARegistry) to enable anchoring.",
    },
  ];

  return (
    <section className="glass flex flex-wrap items-stretch gap-0 overflow-hidden rounded-2xl">
      {chips.map((c, i) => (
        <div
          key={c.label}
          className={[
            "flex min-w-[180px] flex-1 items-start gap-3 px-4 py-3",
            i > 0 && "border-l border-white/5",
          ]
            .filter(Boolean)
            .join(" ")}
          title={c.hint}
        >
          <span
            className={[
              "mt-0.5 grid h-6 w-6 flex-shrink-0 place-items-center rounded-md",
              c.tone === "ok"
                ? "bg-[var(--color-helix-a)]/10 text-[var(--color-helix-a)]"
                : c.tone === "warn"
                ? "bg-amber-500/10 text-amber-300"
                : "bg-white/5 text-[var(--color-ink-400)]",
            ].join(" ")}
          >
            {c.icon}
          </span>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-400)]">
              {c.label}
            </div>
            <div className="truncate text-[12px] font-medium leading-tight text-white">
              {c.value}
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}
