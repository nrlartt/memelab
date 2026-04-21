/**
 * Human-friendly labels for the backend stack.
 *
 * Users don't care that we're calling `openai/gpt-oss-120b` via Groq,
 * or that the research chain is literally `tavily → serpapi → jina →
 * duckduckgo`. They care *what* the product is doing for them in plain
 * English. Everything that gets surfaced in the UI flows through here.
 */

const MODEL_PRETTY: Record<string, string> = {
  "openai/gpt-oss-120b": "GPT-OSS 120B (open-weight reasoning)",
  "llama-3.3-70b-versatile": "Llama 3.3 70B",
  "llama-3.1-70b-versatile": "Llama 3.1 70B",
  "gpt-4o-mini": "GPT-4o mini",
  "gpt-4.1-mini": "GPT-4.1 mini",
  "gpt-4o": "GPT-4o",
  "text-embedding-3-small": "OpenAI embeddings (compact)",
  "text-embedding-3-large": "OpenAI embeddings (large)",
};

const PROVIDER_PRETTY: Record<string, string> = {
  groq: "Groq Cloud",
  openai: "OpenAI",
  together: "Together AI",
  fireworks: "Fireworks",
  azure: "Azure OpenAI",
};

const RESEARCH_SOURCE_PRETTY: Record<string, string> = {
  x: "X (Twitter)",
  tavily: "Tavily",
  serpapi: "Google (SerpAPI)",
  jina: "Jina Reader",
  duckduckgo: "DuckDuckGo",
};

export function prettyModel(slug: string | null | undefined): string {
  if (!slug) return "heuristic fallback";
  return MODEL_PRETTY[slug] ?? slug.replace(/^[^/]+\//, "");
}

export function prettyProvider(slug: string | null | undefined): string {
  if (!slug) return "local";
  return PROVIDER_PRETTY[slug.toLowerCase()] ?? slug;
}

export function prettyReasoningStack(
  provider: string | null | undefined,
  model: string | null | undefined,
): string {
  if (!model) return "Heuristic fallback";
  return `${prettyModel(model)} via ${prettyProvider(provider)}`;
}

/**
 * The raw /stack-info response ships the research chain as
 * `"tavily → serpapi → jina → duckduckgo"`. That's way too technical
 * for the overview strip. Convert to a plain-English sentence that
 * still tells the user what to expect.
 */
export function prettyResearchChain(
  raw: string | null | undefined,
): { summary: string; hint: string } {
  if (!raw) {
    return {
      summary: "No live web research",
      hint: "Configure Tavily, SerpAPI, Jina, or X cookies to enrich families with real articles and tweets.",
    };
  }
  const keys = raw
    .split(/[→,>]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const names = keys.map((k) => RESEARCH_SOURCE_PRETTY[k] ?? k);
  if (names.length === 0) {
    return { summary: "Keyless fallback", hint: "DuckDuckGo is always tried last." };
  }
  const primary = names[0];
  const rest = names.slice(1);
  const summary =
    rest.length === 0
      ? primary
      : `${primary} · ${rest.length} fallback${rest.length > 1 ? "s" : ""}`;
  const hint =
    rest.length === 0
      ? "Only one research source active."
      : `Tries ${names.join(", then ")}. DuckDuckGo is keyless and always available.`;
  return { summary, hint };
}

/**
 * The backend tags each LLM run with a schema version like ``v2``. We
 * don't want to surface that raw - it confuses people ("prompt v2 of
 * what?") - so translate to a friendly descriptor.
 */
export function prettyPromptVersion(v: string | null | undefined): string | undefined {
  if (!v) return undefined;
  const trimmed = String(v).trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === "v2") return "Current reasoning recipe";
  if (trimmed === "v1") return "Legacy reasoning recipe";
  if (/^v\d+$/.test(trimmed)) return `Reasoning recipe ${trimmed}`;
  return trimmed;
}
