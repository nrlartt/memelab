import { Brain, Quote, Sparkles } from "lucide-react";
import type { AIMetadata } from "@/lib/types";
import { Card, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import {
  prettyModel,
  prettyPromptVersion,
  prettyResearchChain,
} from "@/lib/humanize";

/**
 * Shows *exactly* what the AI stack contributed to a DNA Family:
 * model + version that validated the cluster, the raw reasoning string, and
 * which web-research provider will enrich it. This is how we close the
 * "I can't tell what the AI is doing" complaint.
 */
export function AIPanel({
  ai,
  confidence,
}: {
  ai: AIMetadata;
  confidence: number;
}) {
  const conf = Math.round(confidence * 100);
  const modelLabel = prettyModel(ai.model);
  const recipeLabel = prettyPromptVersion(ai.version);
  const research = prettyResearchChain(ai.research_provider);

  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_0%_0%,rgba(139,92,246,0.14),transparent_60%)]" />
      <CardHeader>
        <CardTitle className="inline-flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--color-helix-b)]" />
          AI Decision Log
        </CardTitle>
      </CardHeader>

      <div className="relative grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetaBlock
          label="Reasoning AI"
          value={modelLabel}
          hint={recipeLabel}
        />
        <MetaBlock
          label="Cluster confidence"
          value={`${conf}%`}
          hint={
            conf >= 60
              ? "High · event identity is clear"
              : conf >= 40
              ? "Medium · pattern-level match"
              : "Low · weak signal, keep an eye on it"
          }
        />
        <MetaBlock
          label="Event research"
          value={research.summary}
          hint={
            ai.references_count
              ? `${ai.references_count} web sources indexed`
              : research.hint
          }
        />
      </div>

      <div className="relative mt-5 rounded-xl border border-white/5 bg-black/30 p-4">
        <div className="mb-2 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-400)]">
          <Quote className="h-3 w-3" />
          Why MemeLab grouped these tokens
        </div>
        {ai.reasoning ? (
          <p className="text-sm leading-relaxed text-[var(--color-ink-100)]">
            {ai.reasoning}
          </p>
        ) : (
          <p className="text-sm italic text-[var(--color-ink-400)]">
            No reasoning was stored for this family. Run the pipeline with the
            chat LLM enabled to regenerate it.
          </p>
        )}
      </div>

      <div className="relative mt-3 flex flex-wrap gap-1.5">
        <Badge variant="muted" className="gap-1">
          <Brain className="h-3 w-3" />
          Validated by reasoning AI
        </Badge>
        {ai.research_provider && (
          <Badge variant="muted">Enriched with {research.summary}</Badge>
        )}
      </div>
    </Card>
  );
}

function MetaBlock({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-400)]">
        {label}
      </div>
      <div className="mt-1 font-mono text-sm font-medium text-white">
        {value}
      </div>
      {hint && (
        <div className="mt-1 text-[11px] text-[var(--color-ink-300)]">
          {hint}
        </div>
      )}
    </div>
  );
}
