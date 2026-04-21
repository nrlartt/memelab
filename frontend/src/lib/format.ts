export function formatUsd(n: number | null | undefined, opts: { compact?: boolean } = {}): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "$0";
  if (opts.compact) {
    if (v !== 0 && Math.abs(v) < 1) {
      return `$${v.toPrecision(2)}`;
    }
    return new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
      style: "currency",
      currency: "USD",
    }).format(v);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: v < 10 ? 4 : 0,
  }).format(v);
}

/**
 * Meme-token-grade price formatter. A lot of Four.Meme tokens trade at
 * 6-to-10 significant-digit sub-cent prices, so a fixed ``maximumFractionDigits``
 * will always round them to "$0.00". This keeps 4 significant figures instead
 * and ALWAYS shows something meaningful (e.g. $0.00000358).
 */
export function formatPrice(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v === 0) return "$0";
  if (Math.abs(v) >= 1) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(v);
  }
  // Sub-dollar: keep 4 significant digits (0.0000037540 → $0.000003754).
  const abs = Math.abs(v);
  const leadingZeros = Math.floor(-Math.log10(abs));
  const digits = Math.min(12, leadingZeros + 4);
  return `$${v.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "")}`;
}

export function formatNumber(n: number | null | undefined, digits = 0): string {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
  }).format(v);
}

export function shortAddress(addr: string | null | undefined, head = 6, tail = 4): string {
  if (!addr) return "";
  if (addr.length <= head + tail + 2) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return iso ?? "-";
  const diff = Date.now() - d;
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  const mo = Math.floor(days / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export function formatConfidence(c: number | null | undefined): string {
  const v = Math.max(0, Math.min(1, Number(c ?? 0)));
  return `${Math.round(v * 100)}%`;
}
