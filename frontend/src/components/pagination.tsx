import Link from "next/link";
import { formatNumber } from "@/lib/format";

/**
 * Compact paginator used by every list page (Families, Explorer, …).
 *
 *   « prev   1 … 3 4 [5] 6 7 … 42   next »
 *
 * The window keeps the first / last / current ±2 pages visible so users
 * can both jump to extremes and scrub locally without an unbounded
 * number of buttons.
 */
export type PaginationProps = {
  total: number;
  limit: number;
  page: number;
  buildUrl: (p: number) => string;
  unit?: string; // "tokens", "families", …
};

export function Pagination({
  total,
  limit,
  page,
  buildUrl,
  unit = "items",
}: PaginationProps) {
  const maxPage = Math.max(1, Math.ceil(total / limit));
  if (maxPage <= 1) return null;

  const pages: (number | "ellipsis")[] = [];
  const push = (v: number | "ellipsis") => {
    if (v !== "ellipsis" || pages[pages.length - 1] !== "ellipsis") pages.push(v);
  };
  for (let p = 1; p <= maxPage; p++) {
    if (p === 1 || p === maxPage || (p >= page - 2 && p <= page + 2)) {
      push(p);
    } else {
      push("ellipsis");
    }
  }

  const baseChip =
    "grid h-9 min-w-9 place-items-center rounded-full px-3 text-xs transition-colors";
  const idleChip =
    "border border-white/10 bg-white/[0.03] text-[var(--color-ink-200)] hover:bg-white/[0.08] hover:text-white";
  const activeChip =
    "bg-gradient-to-r from-[var(--color-helix-a)] to-[var(--color-helix-c)] font-semibold text-[var(--color-ink-950)] shadow-[0_8px_28px_-12px_rgba(94,247,209,0.55)]";

  return (
    <div className="flex flex-col items-center justify-between gap-3 text-xs text-[var(--color-ink-300)] sm:flex-row">
      <span>
        page {page} / {maxPage} · {formatNumber(total)} {unit}
      </span>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {page > 1 && (
          <Link href={buildUrl(page - 1)} className={`${baseChip} ${idleChip}`}>
            ← prev
          </Link>
        )}
        {pages.map((p, i) =>
          p === "ellipsis" ? (
            <span
              key={`gap-${i}`}
              className="px-1 text-[var(--color-ink-500)]"
            >
              …
            </span>
          ) : (
            <Link
              key={p}
              href={buildUrl(p)}
              aria-current={p === page ? "page" : undefined}
              className={`${baseChip} ${p === page ? activeChip : idleChip}`}
            >
              {p}
            </Link>
          )
        )}
        {page < maxPage && (
          <Link href={buildUrl(page + 1)} className={`${baseChip} ${idleChip}`}>
            next →
          </Link>
        )}
      </div>
    </div>
  );
}
