import type { LabReportResponse } from "./types";

/** Footer line appended to social posts (brand + four.meme). */
export const LAB_SHARE_TAG =
  "\n\nMemeLab · four.meme · BNB Chain · AI meme DNA intelligence";

const MAX_MAIN = 210;

function sanitizeTicker(symbol: string): string {
  const s = symbol.trim().replace(/^\$+/, "");
  return s ? `$${s}` : "";
}

/**
 * Premium, tweet-sized copy: always mentions four.meme; token mode uses $TICKER.
 * Does not include LAB_SHARE_TAG — append at compose time.
 */
export function buildLabReportShareBody(report: LabReportResponse): string {
  const mode = report.mode;
  const facts = report.facts as {
    token_symbol?: string | null;
  } | null;

  const headline = report.narrative.headline?.trim() ?? "";
  const sumFirst =
    report.narrative.summary?.trim().split(/(?<=[.!?])\s+/)[0] ?? "";
  const detail = (headline || sumFirst).replace(/\s+/g, " ").trim();

  if (mode === "token") {
    const ticker = facts?.token_symbol
      ? sanitizeTicker(String(facts.token_symbol))
      : "";
    const lead = ticker
      ? `${ticker} · Meme DNA Lab Report · four.meme launch on BNB Chain.`
      : `Meme DNA Lab Report · four.meme · BNB Chain.`;
    if (!detail) return lead.slice(0, MAX_MAIN);
    const rest = detail.slice(0, 110);
    return `${lead}\n\n${rest}`.slice(0, MAX_MAIN);
  }

  const lead =
    "Wallet Meme DNA Lab Report · four.meme ecosystem · BNB Chain.";
  if (!detail) return lead.slice(0, MAX_MAIN);
  return `${lead}\n\n${detail.slice(0, 110)}`.slice(0, MAX_MAIN);
}

/** Full post text for preview / clipboard (body + tag), capped for X + URL. */
export function buildLabReportFullShareText(report: LabReportResponse): string {
  const body = buildLabReportShareBody(report);
  return `${body}${LAB_SHARE_TAG}`.slice(0, 275);
}
