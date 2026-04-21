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

/** JSON routes are mounted under this path on FastAPI (see ``main.py``). */
export const API_PREFIX = "/api";

/**
 * Host-only base, e.g. ``http://127.0.0.1:8000`` or empty string for same-origin
 * (Docker / Railway: nginx + Next + API on one public host).
 */
function getApiBase(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE;
  if (raw === "") return "";
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.replace(/\/$/, "");
  }
  return "http://127.0.0.1:8000";
}

/** Full URL for JSON endpoints (under ``/api``). */
function jsonUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const b = getApiBase();
  if (!b) return `${API_PREFIX}${p}`;
  return `${b}${API_PREFIX}${p}`;
}

/** Root-level API helpers (health probes stay outside ``/api``). */
function rootUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const b = getApiBase();
  if (!b) return p;
  return `${b}${p}`;
}

function apiRootLabel(): string {
  const b = getApiBase();
  return b ? `${b}${API_PREFIX}` : API_PREFIX;
}

// Next 15 App Router: `revalidate` on the fetch = per-request ISR window.
type ReqOpts = { revalidate?: number; signal?: AbortSignal };

async function rootReq<T>(path: string, opts: ReqOpts = {}): Promise<T> {
  const { revalidate = 30, signal } = opts;
  const res = await fetch(rootUrl(path), {
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

async function req<T>(path: string, opts: ReqOpts = {}): Promise<T> {
  const { revalidate = 30, signal } = opts;
  const res = await fetch(jsonUrl(path), {
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
  /** Logical JSON API root (for UI hints): e.g. ``/api`` or ``http://127.0.0.1:8000/api``. */
  base: apiRootLabel(),
  ready: () => rootReq<ReadyResponse>("/readyz", { revalidate: 10 }),
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

  labReport: async (body: { mode: "wallet" | "token"; address: string }) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 130_000);
    let res: Response;
    try {
      res = await fetch(jsonUrl("/lab-report"), {
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
          "Lab Report timed out (130s). The API may be busy; retry in a minute."
        );
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      let detail = raw;
      try {
        const parsed = JSON.parse(raw) as { detail?: unknown };
        if (typeof parsed.detail === "string") detail = parsed.detail;
      } catch {
        /* keep raw */
      }
      throw new Error(detail || `${res.status} ${res.statusText}`);
    }
    return (await res.json()) as LabReportResponse;
  },

  ingestQuick: async (opts: {
    adminToken: string;
    since_hours?: number;
    max_tokens?: number;
    enrich_on_chain?: boolean;
  }) => {
    const { adminToken, ...body } = opts;
    const res = await fetch(jsonUrl("/internal/ingest/quick"), {
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
        `API ${res.status} ${res.statusText} – /internal/ingest/quick\n${t.slice(0, 280)}`
      );
    }
    return (await res.json()) as QuickIngestResponse;
  },
};
