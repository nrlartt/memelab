"use client";

import * as React from "react";
import Link from "next/link";
import { Crown, Flame, Sparkle } from "lucide-react";
import type { Mutation } from "@/lib/types";
import { formatUsd, shortAddress, timeAgo } from "@/lib/format";

/**
 * "Where in the family genome am I?" viewer.
 *
 * Takes the current mutation's address + the family's full mutations list
 * and renders the top-N by volume as a ranking bar chart. The current
 * mutation is always highlighted and, if not already in the top-N, is
 * pinned to the bottom so the user sees their own position.
 */
export function FamilyRank({
  currentAddress,
  familyId,
  familyTitle,
  mutations,
  topN = 6,
}: {
  currentAddress: string;
  familyId: string;
  familyTitle: string;
  mutations: Mutation[];
  topN?: number;
}) {
  const addr = currentAddress.toLowerCase();

  // Deduplicate and sort by volume desc.
  const byAddr = new Map<string, Mutation>();
  for (const m of mutations) {
    byAddr.set(m.token_address.toLowerCase(), m);
  }
  const sorted = Array.from(byAddr.values()).sort(
    (a, b) => (b.trading?.volume_24h_usd ?? 0) - (a.trading?.volume_24h_usd ?? 0)
  );
  const selfIdx = sorted.findIndex((m) => m.token_address.toLowerCase() === addr);

  const head = sorted.slice(0, topN);
  let rows = head;
  if (selfIdx >= topN) {
    rows = [...head, sorted[selfIdx]];
  }

  const maxVol = Math.max(1, ...sorted.map((m) => m.trading?.volume_24h_usd ?? 0));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[11px]">
        <span className="uppercase tracking-[0.18em] text-[var(--color-ink-400)]">
          Family positioning · rank
          <span className="ml-1.5 font-mono text-white">
            #{selfIdx === -1 ? "?" : selfIdx + 1}
          </span>
          <span className="text-[var(--color-ink-500)]">
            {" "}of {sorted.length}
          </span>
        </span>
        <Link
          href={`/family/${familyId}`}
          className="truncate text-[var(--color-ink-300)] hover:text-white"
        >
          {familyTitle} →
        </Link>
      </div>
      <div className="space-y-1.5">
        {rows.map((m, i) => {
          const isMe = m.token_address.toLowerCase() === addr;
          const vol = m.trading?.volume_24h_usd ?? 0;
          const pct = Math.max(1.5, (vol / maxVol) * 100);
          const displayRank =
            i < topN ? i + 1 : selfIdx + 1;
          const kind = kindOf(m);
          return (
            <Link
              key={m.token_address}
              href={`/mutation/${m.token_address}`}
              className={[
                "group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors",
                isMe
                  ? "bg-[var(--color-helix-a)]/10 ring-1 ring-[var(--color-helix-a)]/30"
                  : "hover:bg-white/[0.03]",
              ].join(" ")}
            >
              <span className="w-6 text-right font-mono text-[10px] text-[var(--color-ink-400)]">
                #{displayRank}
              </span>
              <KindIcon kind={kind} />
              <div className="w-16 truncate font-mono text-[11px] text-white">
                {m.symbol || shortAddress(m.token_address, 4, 4)}
              </div>
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/5">
                <div
                  className={[
                    "absolute inset-y-0 left-0 rounded-full",
                    kind === "dominant"
                      ? "bg-[var(--color-strain-dominant)]"
                      : kind === "fastest"
                        ? "bg-[var(--color-strain-fastest)]"
                        : kind === "origin"
                          ? "bg-[var(--color-strain-origin)]"
                          : "bg-gradient-to-r from-[var(--color-helix-a)] to-[var(--color-helix-c)]",
                  ].join(" ")}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="w-20 text-right font-mono text-[11px] text-[var(--color-ink-200)]">
                {formatUsd(vol, { compact: true })}
              </div>
              <div className="hidden w-14 text-right text-[10px] text-[var(--color-ink-500)] sm:block">
                {timeAgo(m.created_at)}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function kindOf(
  m: Mutation
): "origin" | "dominant" | "fastest" | "vanilla" {
  if (m.is_dominant_strain) return "dominant";
  if (m.is_fastest_mutation) return "fastest";
  if (m.is_origin_strain) return "origin";
  return "vanilla";
}

function KindIcon({
  kind,
}: {
  kind: "origin" | "dominant" | "fastest" | "vanilla";
}) {
  if (kind === "dominant")
    return (
      <Crown className="h-3 w-3 flex-none text-[var(--color-strain-dominant)]" />
    );
  if (kind === "fastest")
    return (
      <Flame className="h-3 w-3 flex-none text-[var(--color-strain-fastest)]" />
    );
  if (kind === "origin")
    return (
      <Sparkle className="h-3 w-3 flex-none text-[var(--color-strain-origin)]" />
    );
  return (
    <span className="inline-block h-1.5 w-1.5 flex-none rounded-full bg-white/20" />
  );
}
