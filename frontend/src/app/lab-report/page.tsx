"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  Check,
  Clipboard,
  Copy,
  FileText,
  FlaskConical,
  Link2,
  Loader2,
  Printer,
  RefreshCw,
  Share2,
  Sparkles,
  User,
  Wallet,
} from "lucide-react";
import { api } from "@/lib/api";
import { buildLabReportFullShareText } from "@/lib/lab-share";
import type {
  ExplorerToken,
  LabReportResponse,
  OverviewStats,
  ScanningStats,
  StackInfo,
} from "@/lib/types";
import { Card } from "@/components/ui/card";
import {
  LabReportSocialCards,
  LabReportSocialSummary,
  LabReportTimelineRail,
  LabReportVisualBlock,
} from "@/components/lab-report-viz";
import {
  LabAIStackPanel,
  LabAnalyzeSuggestions,
  LabGenerationProgress,
  LabIntelligenceHero,
  LabReasoningPipeline,
  LabReportAttribution,
  LabReportPrintCover,
  LabReportRunningHead,
} from "@/components/lab-report-showcase";
import { TokenAvatar } from "@/components/token-avatar";
import { useWalletAddress } from "@/hooks/use-wallet-address";
import { WalletAiScanAnimation } from "@/components/lab-report/wallet-ai-scan";

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const ADMIN_LS_KEY = "memedna:adminToken";

/** Session flag: first visit per wallet shows the AI intro animation. */
function labWalletIntroKey(addr: string): string {
  return `memedna:lab-wallet-intro:${addr.toLowerCase()}`;
}

function getStoredAdmin(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(ADMIN_LS_KEY) ?? "";
}

function promptAndStoreAdmin(): string | null {
  if (typeof window === "undefined") return null;
  const current = getStoredAdmin();
  const input = window.prompt(
    "Paste MEMEDNA_ADMIN_TOKEN (from your .env). Used only by this browser to trigger ingest.",
    current,
  );
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  window.localStorage.setItem(ADMIN_LS_KEY, trimmed);
  return trimmed;
}

/** Wallet mode: use typed address if valid; otherwise fall back to the connected wallet (field may stay empty). */
function resolveLabAddress(
  mode: "wallet" | "token",
  address: string,
  walletAddress: string | null,
): string {
  const t = address.trim();
  if (mode === "wallet" && walletAddress) {
    if (ADDR_RE.test(t)) return t;
    return walletAddress;
  }
  return t;
}

export default function LabReportPage() {
  const walletAddress = useWalletAddress();
  const [mode, setMode] = useState<"wallet" | "token">("token");
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [report, setReport] = useState<LabReportResponse | null>(null);
  const [scan, setScan] = useState<ScanningStats | null>(null);
  const [stack, setStack] = useState<StackInfo | null>(null);
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [suggestions, setSuggestions] = useState<ExplorerToken[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [activeLabel, setActiveLabel] = useState<string>("");
  /** null = not yet read from session (client only); avoids sessionStorage during SSR/render. */
  const [labIntroPending, setLabIntroPending] = useState<boolean | null>(null);

  const loadScan = useCallback(async () => {
    try {
      const s = await api.scanning();
      setScan(s);
    } catch {
      /* non-blocking */
    }
  }, []);

  const loadMeta = useCallback(async () => {
    try {
      const [s, o] = await Promise.all([api.stack(), api.overview()]);
      setStack(s);
      setOverview(o);
    } catch {
      /* non-blocking */
    }
  }, []);

  const loadSuggestions = useCallback(async () => {
    setSuggestionsLoading(true);
    try {
      const res = await api.explorer({
        sort: "volume",
        limit: 6,
        min_liquidity: 1000,
      });
      setSuggestions(res.items);
    } catch {
      setSuggestions([]);
    } finally {
      setSuggestionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadScan();
    void loadMeta();
    void loadSuggestions();
    const id = setInterval(() => {
      void loadScan();
    }, 30_000);
    return () => clearInterval(id);
  }, [loadScan, loadMeta, loadSuggestions]);

  /** Deep links from mutation/explorer: /lab-report?mode=token&address=0x… */
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const p = new URLSearchParams(window.location.search);
      const addr = p.get("address");
      const modeRaw = p.get("mode");
      if (addr && ADDR_RE.test(addr.trim())) {
        setAddress(addr.trim());
        setMode(modeRaw === "wallet" ? "wallet" : "token");
      }
    } catch {
      /* ignore */
    }
  }, []);

  const generateFor = useCallback(
    async (m: "wallet" | "token", rawAddr: string, label?: string) => {
      const a = rawAddr.trim();
      if (!ADDR_RE.test(a)) {
        setErr("Enter a valid 0x… address (42 characters).");
        return;
      }
      setErr(null);
      setLoading(true);
      setReport(null);
      setActiveLabel(label || `${m === "wallet" ? "wallet" : "token"} ${a.slice(0, 10)}…`);
      try {
        const r = await api.labReport({ mode: m, address: a.toLowerCase() });
        setReport(r);
        if (r.mode === "wallet" || r.mode === "token") setMode(r.mode);
      } catch (e) {
        setErr((e as Error).message || "Request failed");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useLayoutEffect(() => {
    if (!walletAddress) {
      setLabIntroPending(false);
      return;
    }
    try {
      const seen = sessionStorage.getItem(labWalletIntroKey(walletAddress));
      setLabIntroPending(!seen);
    } catch {
      setLabIntroPending(false);
    }
  }, [walletAddress]);

  /* First visit per wallet: show intro animation only — keep Token mode default; no auto API call. */
  useEffect(() => {
    if (!walletAddress || typeof window === "undefined") return;
    const key = labWalletIntroKey(walletAddress);
    if (window.sessionStorage.getItem(key)) return;
    const t = window.setTimeout(() => {
      window.sessionStorage.setItem(key, "1");
      setLabIntroPending(false);
    }, 1800);
    return () => window.clearTimeout(t);
  }, [walletAddress]);

  const generate = useCallback(() => {
    void generateFor(
      mode,
      resolveLabAddress(mode, address, walletAddress),
    );
  }, [generateFor, mode, address, walletAddress]);

  const pickSuggestion = useCallback(
    (t: { mode: "wallet" | "token"; address: string; label: string }) => {
      setMode(t.mode);
      setAddress(t.address);
      void generateFor(t.mode, t.address, t.label);
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    [generateFor],
  );

  const pasteFromClipboard = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      const txt = (await navigator.clipboard.readText()).trim();
      if (txt) setAddress(txt);
    } catch {
      /* ignore permissions */
    }
  }, []);

  const refreshIngest = useCallback(async () => {
    setRefreshMsg(null);
    setErr(null);
    let token = getStoredAdmin();
    if (!token) {
      const entered = promptAndStoreAdmin();
      if (!entered) return;
      token = entered;
    }
    setRefreshing(true);
    try {
      const resp = await api.ingestQuick({
        adminToken: token,
        since_hours: 2,
        max_tokens: 1500,
        enrich_on_chain: false,
      });
      const gapNote =
        resp.gap_blocks > 0
          ? ` · gap ${resp.gap_blocks.toLocaleString("en-US")} blocks (need archive RPC)`
          : "";
      setRefreshMsg(
        `Ingest OK · head ${resp.head_inserted}/${resp.head_events} new · inserted ${resp.inserted} · last 1h ${resp.new_1h} · ${resp.duration_s}s${gapNote}`,
      );
      await loadScan();
      if (report) {
        const addrForRefresh = resolveLabAddress(mode, address, walletAddress);
        if (ADDR_RE.test(addrForRefresh.trim())) {
          await generateFor(mode, addrForRefresh.trim());
        }
      }
    } catch (e) {
      const msg = (e as Error).message || "Request failed";
      if (msg.includes("401")) {
        window.localStorage.removeItem(ADMIN_LS_KEY);
        setRefreshMsg("Admin token rejected; will re-prompt on next click.");
      } else {
        setRefreshMsg(msg);
      }
    } finally {
      setRefreshing(false);
    }
  }, [address, generateFor, loadScan, mode, report, walletAddress]);

  // ``"text"`` / ``"link"`` reset after ~1.6s so the button label flashes
  // "Copied!" then returns to its normal state (clearer feedback)
  // than a silent clipboard write.
  const [copied, setCopied] = useState<"none" | "text" | "link" | "image">(
    "none",
  );

  /** Premium X-ready copy: four.meme + $TICKER (token) + MemeLab tag; URL added by intent. */
  const shareText = useMemo(() => {
    if (!report) return "";
    return buildLabReportFullShareText(report);
  }, [report]);

  // Use the current page URL so the share always deep-links back to the
  // exact report the reader is viewing. Computed lazily at click time
  // in case the user navigates via history.replaceState.
  const getShareUrl = useCallback(() => {
    if (typeof window === "undefined") return "";
    return window.location.href;
  }, []);

  const copyShareText = useCallback(async () => {
    if (!shareText) return;
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied("text");
      window.setTimeout(() => setCopied("none"), 1600);
    } catch {
      /* clipboard blocked (http, permissions): silent */
    }
  }, [shareText]);

  const copyShareLink = useCallback(async () => {
    const url = getShareUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied("link");
      window.setTimeout(() => setCopied("none"), 1600);
    } catch {
      /* silent */
    }
  }, [getShareUrl]);

  const shareOn = useCallback(
    (platform: "x" | "telegram" | "whatsapp") => {
      const url = getShareUrl();
      const encText = encodeURIComponent(shareText);
      const encUrl = encodeURIComponent(url);
      let target = "";
      if (platform === "x") {
        target = `https://x.com/intent/tweet?text=${encText}&url=${encUrl}`;
      } else if (platform === "telegram") {
        target = `https://t.me/share/url?url=${encUrl}&text=${encText}`;
      } else if (platform === "whatsapp") {
        target = `https://api.whatsapp.com/send?text=${encodeURIComponent(
          `${shareText} ${url}`,
        )}`;
      }
      if (target) window.open(target, "_blank", "noopener,noreferrer");
    },
    [shareText, getShareUrl],
  );

  // Mobile browsers expose a proper share sheet via Web Share API; desktop
  // falls back to the individual platform buttons.
  const nativeShare = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.share) return;
    try {
      await navigator.share({
        title: report?.narrative.headline ?? "MemeLab AI Lab Report",
        text: `${shareText}\n${getShareUrl()}`,
      });
    } catch {
      /* user cancelled: silent */
    }
  }, [report, shareText, getShareUrl]);

  /** Copy token image to clipboard for pasting into X (when CDN allows CORS). */
  const copyShareImage = useCallback(async () => {
    if (!report || report.mode !== "token") return;
    const imageUrl = (
      report.facts as { token_image_url?: string | null } | null
    )?.token_image_url;
    if (!imageUrl || typeof navigator.clipboard?.write !== "function") return;
    try {
      const res = await fetch(imageUrl, { mode: "cors" });
      const blob = await res.blob();
      if (!blob.type.startsWith("image/")) return;
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
      setCopied("image");
      window.setTimeout(() => setCopied("none"), 2000);
    } catch {
      window.open(imageUrl, "_blank", "noopener,noreferrer");
    }
  }, [report]);

  const doPrint = useCallback(() => {
    window.print();
  }, []);

  if (labIntroPending === null && walletAddress) {
    return (
      <div className="page-shell space-y-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-300)] hover:text-white print:hidden"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to Overview
        </Link>
        <div className="flex min-h-[240px] flex-col items-center justify-center rounded-3xl border border-white/10 bg-[var(--color-ink-900)]/60 p-12">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--color-helix-a)]" aria-hidden />
          <p className="mt-4 text-sm text-[var(--color-ink-400)]">Preparing Lab Report…</p>
        </div>
      </div>
    );
  }

  if (labIntroPending && walletAddress) {
    return (
      <div className="page-shell space-y-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-300)] hover:text-white print:hidden"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to Overview
        </Link>
        <WalletAiScanAnimation address={walletAddress} />
      </div>
    );
  }

  return (
    <div className="page-shell space-y-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-300)] hover:text-white print:hidden"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to Overview
      </Link>

      <div className="print:hidden">
        <LabIntelligenceHero stack={stack} overview={overview} scanning={scan} />
      </div>

      {/* =================================================================
          INTELLIGENCE CONSOLE: the input panel
          ============================================================== */}
      <Card className="relative overflow-hidden border-white/10 bg-[var(--color-ink-900)]/80 p-6 print:hidden sm:p-7">
        <div className="pointer-events-none absolute -left-20 -top-20 h-60 w-60 rounded-full bg-[var(--color-helix-a)]/10 blur-[120px]" />
        <div className="pointer-events-none absolute -right-16 bottom-0 h-52 w-52 rounded-full bg-[var(--color-helix-b)]/10 blur-[120px]" />

        <div className="relative">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-[var(--color-helix-a)]">
                <FlaskConical className="mr-1.5 inline h-3 w-3" />
                Intelligence console
              </p>
              <h2 className="mt-1 text-lg font-semibold text-white sm:text-xl">
                Compose an AI report
              </h2>
            </div>
            <button
              type="button"
              onClick={() => void refreshIngest()}
              disabled={refreshing}
              title="Pull the latest Four.Meme tokens right now (admin only)"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-[11px] font-medium text-[var(--color-ink-200)] hover:bg-black/50 disabled:opacity-50"
            >
              {refreshing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Refresh ingest
            </button>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch">
            {/* Mode toggle: segmented with icons */}
            <div
              role="tablist"
              aria-label="Analysis target"
              className="inline-flex rounded-xl border border-white/10 bg-black/40 p-1"
            >
              <ModeTab
                active={mode === "token"}
                onClick={() => setMode("token")}
                icon={<Sparkles className="h-3.5 w-3.5" />}
                label="Token"
              />
              <ModeTab
                active={mode === "wallet"}
                onClick={() => setMode("wallet")}
                icon={<Wallet className="h-3.5 w-3.5" />}
                label="Wallet"
              />
            </div>

            {/* Address input + prefix icon + paste shortcut */}
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-400)]">
                {mode === "wallet" ? (
                  <User className="h-4 w-4" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
              </span>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") generate();
                }}
                placeholder={
                  mode === "wallet"
                    ? walletAddress
                      ? "Optional: other 0x… — empty uses connected wallet"
                      : "0x… deployer wallet address"
                    : "0x… token contract address"
                }
                className="w-full rounded-xl border border-white/10 bg-black/40 py-3 pl-10 pr-24 font-mono text-sm text-white placeholder:text-[var(--color-ink-500)] focus:border-[var(--color-helix-a)]/50 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void pasteFromClipboard()}
                className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-[10px] font-medium text-[var(--color-ink-300)] hover:border-white/20 hover:text-white"
                title="Paste address from clipboard"
              >
                <Clipboard className="h-3 w-3" />
                Paste
              </button>
            </div>

            {/* Primary CTA */}
            <button
              type="button"
              onClick={() => generate()}
              disabled={loading}
              className="group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-[var(--color-helix-a)] via-[var(--color-helix-b)] to-[var(--color-helix-c)] px-6 py-3 text-sm font-semibold text-[var(--color-ink-950)] shadow-[0_10px_40px_-10px_rgba(94,247,209,0.5)] transition-transform hover:scale-[1.02] disabled:opacity-60"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Bot className="h-4 w-4" />
              )}
              {loading ? "Running analysis…" : "Run AI analysis"}
            </button>
          </div>

          {/* Scan / status strip */}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--color-ink-400)]">
            {scan ? (
              <>
                <span>
                  <span className="text-[var(--color-ink-500)]">Cursor</span>{" "}
                  <span className="font-mono text-white">
                    {scan.cursor.last_block.toLocaleString("en-US")}
                  </span>
                </span>
                {typeof scan.chain_head === "number" ? (
                  <span>
                    <span className="text-[var(--color-ink-500)]">Head</span>{" "}
                    <span className="font-mono text-white">
                      {scan.chain_head.toLocaleString("en-US")}
                    </span>
                  </span>
                ) : null}
                {typeof scan.lag_blocks === "number" ? (
                  <span
                    className={
                      scan.stale
                        ? "text-[var(--color-bad)]"
                        : "text-[var(--color-ink-300)]"
                    }
                  >
                    <span className="text-[var(--color-ink-500)]">Lag</span>{" "}
                    <span className="font-mono">{scan.lag_blocks.toLocaleString("en-US")}</span>{" "}
                    blocks
                  </span>
                ) : null}
                <span>
                  <span className="text-[var(--color-ink-500)]">New 1h / 24h</span>{" "}
                  <span className="font-mono text-white">
                    {scan.new_tokens_1h}/{scan.new_tokens_24h}
                  </span>
                </span>
                <span>
                  <span className="text-[var(--color-ink-500)]">Scheduler</span>{" "}
                  <span
                    className={
                      scan.scheduler ? "text-[var(--color-good)]" : "text-[var(--color-bad)]"
                    }
                  >
                    {scan.scheduler ? "on" : "off"}
                  </span>
                </span>
              </>
            ) : null}
            {refreshMsg ? (
              <span className="text-[var(--color-good)]">{refreshMsg}</span>
            ) : null}
          </div>

          {err && (
            <p className="mt-4 whitespace-pre-wrap text-sm text-[var(--color-bad)]">{err}</p>
          )}
        </div>
      </Card>

      {/* =================================================================
          GENERATION PROGRESS: stepped panel while /lab-report is in
          flight. Only shown when loading and no stale report is visible.
          ============================================================== */}
      {loading ? (
        <div className="print:hidden">
          <LabGenerationProgress label={activeLabel || "Analyzing…"} />
        </div>
      ) : null}

      {/* =================================================================
          PRE-REPORT SHOWCASE: only visible when no report yet.
          Three columns: AI stack · Reasoning pipeline · Live picks.
          ============================================================== */}
      {!report && !loading ? (
        <section className="grid gap-4 print:hidden lg:grid-cols-3">
          <LabAIStackPanel stack={stack} />
          <LabReasoningPipeline />
          <LabAnalyzeSuggestions
            tokens={suggestions}
            onPick={pickSuggestion}
            loading={suggestionsLoading}
          />
        </section>
      ) : null}

      {/* =================================================================
          REPORT OUTPUT
          ============================================================== */}
      {report && (
        <div className="space-y-4">
          {/* =============================================================
              SHARE BAR: prominent panel so readers can export the report
              to X / Telegram / WhatsApp, copy a tweet-ready blurb, copy a
              deep link, or save a PDF without hunting for tiny icons.
              Primary CTA is the printed PDF (emerald gradient); social
              platforms use their own brand colours so they read as real
              share targets, not generic buttons.
              ========================================================== */}
          <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] p-4 shadow-[0_20px_60px_-30px_rgba(16,185,129,0.25)] print:hidden">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-400/15 ring-1 ring-emerald-300/30">
                  <Share2 className="h-3.5 w-3.5 text-emerald-300" />
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-emerald-200/80">
                    Share this report
                  </div>
                  <div className="text-xs text-white/55">
                    Share copy names four.meme and $TICKER; optional: paste token art
                    into X.
                  </div>
                </div>
              </div>
              {/* Mobile-first: the native share sheet wraps everything. */}
              <button
                type="button"
                onClick={() => void nativeShare()}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-white/10 sm:hidden"
                aria-label="Open native share sheet"
              >
                <Share2 className="h-3.5 w-3.5" />
                Share…
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Primary export: emerald gradient, matches the premium feel. */}
              <button
                type="button"
                onClick={doPrint}
                className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 px-5 py-2.5 text-sm font-semibold text-neutral-950 shadow-[0_10px_30px_-10px_rgba(45,212,191,0.55)] transition hover:from-emerald-300 hover:via-teal-200 hover:to-cyan-300"
              >
                <Printer className="h-4 w-4" />
                Print / Save as PDF
              </button>

              {/* X / Twitter */}
              <button
                type="button"
                onClick={() => shareOn("x")}
                className="inline-flex items-center gap-2 rounded-full bg-black px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-white/20 transition hover:bg-neutral-900"
                aria-label="Share on X (formerly Twitter)"
              >
                <XBrandIcon className="h-3.5 w-3.5" />
                Share on X
              </button>

              {report.mode === "token" &&
              (report.facts as { token_image_url?: string | null } | null)
                ?.token_image_url ? (
                <button
                  type="button"
                  onClick={() => void copyShareImage()}
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
                  title="Copy token image — paste into X composer (same tab)"
                >
                  {copied === "image" ? (
                    <Check className="h-4 w-4 text-emerald-300" />
                  ) : (
                    <Sparkles className="h-4 w-4 text-amber-200/90" />
                  )}
                  {copied === "image" ? "Image copied!" : "Copy image for X"}
                </button>
              ) : null}

              {/* Telegram */}
              <button
                type="button"
                onClick={() => shareOn("telegram")}
                className="inline-flex items-center gap-2 rounded-full bg-[#229ED9] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1c8bbe]"
                aria-label="Share on Telegram"
              >
                <TelegramBrandIcon className="h-4 w-4" />
                Telegram
              </button>

              {/* WhatsApp */}
              <button
                type="button"
                onClick={() => shareOn("whatsapp")}
                className="inline-flex items-center gap-2 rounded-full bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-neutral-900 transition hover:bg-[#20bd5a]"
                aria-label="Share on WhatsApp"
              >
                <WhatsAppBrandIcon className="h-4 w-4" />
                WhatsApp
              </button>

              <span
                aria-hidden
                className="mx-1 hidden h-6 w-px bg-white/10 sm:inline-block"
              />

              {/* Copy share text: flash "Copied!" for ~1.6s */}
              <button
                type="button"
                onClick={() => void copyShareText()}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                {copied === "text" ? (
                  <Check className="h-4 w-4 text-emerald-300" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copied === "text" ? "Copied!" : "Copy share text"}
              </button>

              {/* Copy link */}
              <button
                type="button"
                onClick={() => void copyShareLink()}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                {copied === "link" ? (
                  <Check className="h-4 w-4 text-emerald-300" />
                ) : (
                  <Link2 className="h-4 w-4" />
                )}
                {copied === "link" ? "Link copied!" : "Copy link"}
              </button>
            </div>

            {/* Preview of exactly what will be posted: lets users tweak
                before brand buttons; reinforces AI-crafted copy. */}
            {shareText ? (
              <div className="mt-3 rounded-xl border border-white/10 bg-black/30 p-3">
                <div className="mb-1 text-[10px] uppercase tracking-[0.22em] text-white/40">
                  Post preview (link appended by X)
                </div>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-white/80">
                  {shareText}
                </p>
              </div>
            ) : null}
          </div>

          <article className="lab-report-print-root rounded-3xl border border-white/10 bg-[var(--color-ink-900)] p-8 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.8)] print:border-0 print:shadow-none sm:p-12">
            {/* Print-only: cover page (display:none on screen, block on print).
                Ships with its own break-after: page so content starts fresh. */}
            <LabReportPrintCover report={report} stack={stack} />

            {/* Print-only: subtle running header on every content page. */}
            <LabReportRunningHead report={report} />

            {/* On-screen header: hidden in print because the cover
                already carries the same information in a formal layout.
                For token reports we show the real DexScreener logo next
                to the headline so the page *feels* like a report about
                that token, not a generic analysis. */}
            <header className="lab-report-screen-head flex items-start gap-4 border-b border-white/10 pb-6">
              {report.mode === "token" ? (
                <TokenAvatar
                  src={
                    (report.facts as { token_image_url?: string | null } | null)
                      ?.token_image_url ?? null
                  }
                  symbol={
                    (report.facts as { token_symbol?: string } | null)
                      ?.token_symbol ?? ""
                  }
                  size={64}
                  rounded="2xl"
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-ink-400)]">
                  MemeLab · BNB Chain · {report.mode === "wallet" ? "Wallet" : "Token"}
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">
                  {report.narrative.headline}
                </h2>
                <p className="mt-1 truncate font-mono text-xs text-[var(--color-ink-400)]">
                  {report.address} · {new Date(report.generated_at).toLocaleString("en-US")}
                </p>
              </div>
            </header>

            <LabReportAttribution report={report} stack={stack} />

            <section className="mt-8 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-helix-a)] print:text-neutral-800">
                Summary
              </h3>
              <p className="text-sm leading-relaxed text-[var(--color-ink-200)] print:text-neutral-800">
                {report.narrative.summary}
              </p>
            </section>

            <LabReportVisualBlock report={report} />

            <section className="mt-8 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-helix-b)] print:text-neutral-800">
                Archetypes
              </h3>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-ink-200)] print:text-neutral-800">
                {report.narrative.archetype_section}
              </p>
            </section>

            <section className="mt-8 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-helix-c)] print:text-neutral-800">
                DNA families
              </h3>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-ink-200)] print:text-neutral-800">
                {report.narrative.families_section}
              </p>
            </section>

            <section className="mt-8 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-helix-a)] print:text-neutral-800">
                On-chain research
              </h3>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-ink-200)] print:text-neutral-800">
                {report.narrative.research_section}
              </p>
            </section>

            {report.narrative.behavior_section ? (
              <section className="mt-8 space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-helix-b)] print:text-neutral-800">
                  Deployer behaviour
                </h3>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-ink-200)] print:text-neutral-800">
                  {report.narrative.behavior_section}
                </p>
              </section>
            ) : null}

            <section className="mt-8 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-300)] print:text-neutral-800">
                Social &amp; web context
              </h3>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-ink-200)] print:text-neutral-800">
                {report.narrative.social_section}
              </p>
            </section>

            <LabReportSocialSummary facts={report.facts} />
            <LabReportSocialCards facts={report.facts} />

            <section className="mt-8 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-300)] print:text-neutral-800">
                Timeline
              </h3>
              <LabReportTimelineRail facts={report.facts} />
              <p className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-ink-200)] print:text-neutral-800">
                {report.narrative.timeline_section}
              </p>
            </section>

            <footer className="mt-10 border-t border-white/10 pt-6 text-[11px] text-[var(--color-ink-500)] print:border-neutral-300 print:text-neutral-600">
              Educational only. Not investment advice. Data reflects MemeLab&apos;s indexed
              Four.Meme universe.
            </footer>
          </article>

          <div className="rounded-2xl border border-white/5 bg-black/20 p-4 print:hidden">
            <p className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-ink-500)]">
              Share blurb
            </p>
            <p className="mt-2 break-words font-mono text-xs text-[var(--color-ink-300)]">
              {report.narrative.share_blurb}
            </p>
          </div>

          {/* Follow-up CTA: nudges back to showcase grid without refresh */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/5 bg-black/20 p-4 print:hidden">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-400)]">
                Continue the analysis
              </p>
              <p className="mt-1 text-sm text-white">
                Analyze another wallet or token; the AI stack is still warm.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setReport(null);
                setAddress("");
                setActiveLabel("");
                if (typeof window !== "undefined") {
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }
              }}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--color-helix-a)]/40 bg-[var(--color-helix-a)]/10 px-4 py-2 text-xs font-medium text-[var(--color-helix-a)] hover:bg-[var(--color-helix-a)]/15"
            >
              <FileText className="h-3.5 w-3.5" />
              New report
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-gradient-to-r from-[var(--color-helix-a)] to-[var(--color-helix-c)] text-[var(--color-ink-950)] shadow-[0_6px_20px_-8px_rgba(94,247,209,0.6)]"
          : "text-[var(--color-ink-300)] hover:text-white"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Brand icons for the share bar. Inline SVGs keep us independent of icon
// library version drift (lucide doesn't ship X/Telegram/WhatsApp marks) and
// match the button's own ``currentColor``, so they tint correctly on each
// brand background.
// ---------------------------------------------------------------------------

function XBrandIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
      fill="currentColor"
      className={className}
    >
      <path d="M18.244 2H21l-6.52 7.452L22 22h-6.828l-4.77-6.238L4.8 22H2.04l6.97-7.967L2 2h7.01l4.312 5.697L18.244 2Zm-2.4 18h1.884L8.24 4H6.24l9.604 16Z" />
    </svg>
  );
}

function TelegramBrandIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
      fill="currentColor"
      className={className}
    >
      <path d="M9.78 15.27 9.6 19.1c.27 0 .39-.12.53-.25l1.27-1.22 2.64 1.93c.49.27.84.13.97-.45l1.76-8.28c.17-.75-.27-1.05-.74-.88L5.3 13.32c-.73.28-.72.69-.13.87l2.54.79 5.9-3.72c.28-.18.53-.08.33.11L9.78 15.27Z" />
    </svg>
  );
}

function WhatsAppBrandIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
      fill="currentColor"
      className={className}
    >
      <path d="M20.52 3.48A11.93 11.93 0 0 0 12 0C5.37 0 .02 5.35.02 11.98c0 2.11.55 4.17 1.6 5.99L0 24l6.17-1.62a11.96 11.96 0 0 0 5.83 1.49h.01c6.63 0 11.98-5.35 11.98-11.98 0-3.2-1.25-6.21-3.47-8.41ZM12 21.8h-.01a9.8 9.8 0 0 1-5-1.37l-.36-.21-3.66.96.98-3.57-.24-.37a9.8 9.8 0 1 1 18.12-5.25c0 5.4-4.4 9.81-9.83 9.81Zm5.38-7.35c-.3-.15-1.77-.87-2.05-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.27-.47-2.43-1.5-.9-.8-1.5-1.79-1.68-2.09-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51l-.57-.01c-.2 0-.52.07-.79.37-.27.3-1.03 1-1.03 2.45s1.05 2.84 1.2 3.04c.15.2 2.08 3.17 5.04 4.45.7.3 1.25.48 1.68.62.71.23 1.35.2 1.86.12.57-.08 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.12-.27-.2-.57-.35Z" />
    </svg>
  );
}
