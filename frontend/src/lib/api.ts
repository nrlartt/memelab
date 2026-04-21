import type {
  DnaFamilyDetail,
  DnaFamilyList,
  ExplorerResponse,
  MutationWithFamily,
  OverviewStats,
  QuickIngestResponse,
  ReadyResponse,
  ScanningStats,
  SocialResponse,
  StackInfo,
  TrendingResponse,
  WalletDna,
  LabReportResponse,
} from "./types";

/** Absolute API origin; never rely on empty string (would fetch same-origin /lab-report on :3000 → 404). */
function getApiBase(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE;
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.replace(/\/$/, "");
  }
  return "http://127.0.0.1:8000";
}

const BASE = getApiBase();

// Next 15 App Router: `revalidate` on the fetch = per-request ISR window.
// 30 s keeps list pages snappy while still surfacing fresh data after each
// pipeline tick (scheduler runs every 5 min by default).
type ReqOpts = { revalidate?: number; signal?: AbortSignal };

async function req<T>(path: string, opts: ReqOpts = {}): Promise<T> {
  const { revalidate = 30, signal } = opts;
  const res = await fetch(`${BASE}${path}`, {
    headers: { accept: "application/json" },
    next: { revalidate },
    signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `API ${res.status} ${res.statusText} – ${path}\n${body.slice(0, 200)}`
    );
  }
  return (await res.json()) as T;
}

export type FamiliesQuery = {
  limit?: number;
  offset?: number;
  q?: string;
  sort?: "evolution_score" | "volume" | "created_at" | "mutations";
  min_confidence?: number;
  min_mutations?: number;
};

function qstr(obj: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export const api = {
  base: BASE,
  ready: () => req<ReadyResponse>("/readyz", { revalidate: 10 }),
  stack: () => req<StackInfo>("/stack-info", { revalidate: 60 }),
  overview: () => req<OverviewStats>("/stats/overview", { revalidate: 30 }),
  families: (params: FamiliesQuery = {}) =>
    req<DnaFamilyList>(`/dna-families${qstr(params)}`),
  family: (id: string) =>
    req<DnaFamilyDetail>(`/dna-family/${encodeURIComponent(id)}`, {
      revalidate: 20,
    }),
  mutation: (address: string) =>
    req<MutationWithFamily>(`/mutation/${encodeURIComponent(address)}`, {
      revalidate: 30,
    }),
  trending: (limit = 8) =>
    req<TrendingResponse>(`/trending-dna?limit=${limit}`, { revalidate: 20 }),
  social: (query: string, limit = 10) =>
    req<SocialResponse>(
      `/social/search${qstr({ q: query, limit })}`,
      { revalidate: 120 }
    ),
  wallet: (address: string) =>
    req<WalletDna>(
      `/wallet/${encodeURIComponent(address)}/dna`,
      { revalidate: 10 }
    ),
  explorer: (params: {
    q?: string;
    sort?: "newest" | "volume" | "liquidity" | "migrated" | "price";
    limit?: number;
    offset?: number;
    migrated?: boolean;
    fresh_24h?: boolean;
    min_liquidity?: number;
  } = {}) => {
    const qs: Record<string, string | number | undefined> = { ...params } as Record<
      string,
      string | number | undefined
    >;
    if (typeof params.migrated === "boolean")
      qs.migrated = params.migrated ? "true" : "false";
    if (typeof params.fresh_24h === "boolean")
      qs.fresh_24h = params.fresh_24h ? "true" : "false";
    return req<ExplorerResponse>(`/explorer/tokens${qstr(qs)}`, {
      revalidate: 15,
    });
  },
  scanning: () =>
    req<ScanningStats>("/stats/scanning", { revalidate: 5 }),

  /** One-page Lab Report (POST; not cached). */
  labReport: async (body: { mode: "wallet" | "token"; address: string }) => {
    // Backend can wait on DB pool, BSC RPC, DexScreener, and fact-build
    // thread: cap wait so the UI never spins forever without feedback.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 130_000);
    let res: Response;
    try {
      res = await fetch(`${BASE}/lab-report`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new Error(
          "Lab Report timed out (130s). The API may be busy; retry in a minute.",
        );
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      // Surface FastAPI's ``{"detail": "..."}`` as a plain human sentence
      // instead of ``API 404 Not Found – /lab-report {"detail":...}``.
      const raw = await res.text().catch(() => "");
      let detail = raw;
      try {
        const parsed = JSON.parse(raw) as { detail?: unknown };
        if (typeof parsed.detail === "string") detail = parsed.detail;
      } catch {
        // not JSON, keep raw
      }
      throw new Error(detail || `${res.status} ${res.statusText}`);
    }
    return (await res.json()) as LabReportResponse;
  },

  /** Admin: fast LLM-free ingest of the latest blocks (requires admin token). */
  ingestQuick: async (opts: {
    adminToken: string;
    since_hours?: number;
    max_tokens?: number;
    enrich_on_chain?: boolean;
  }) => {
    const { adminToken, ...body } = opts;
    const res = await fetch(`${BASE}/internal/ingest/quick`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "X-Admin-Token": adminToken,
      },
      body: JSON.stringify({
        since_hours: body.since_hours ?? 2,
        max_tokens: body.max_tokens ?? 2000,
        enrich_on_chain: body.enrich_on_chain ?? false,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(
        `API ${res.status} ${res.statusText} – /internal/ingest/quick\n${t.slice(0, 280)}`,
      );
    }
    return (await res.json()) as QuickIngestResponse;
  },
};
