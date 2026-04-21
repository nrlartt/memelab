"use client";

import { useState } from "react";

/**
 * Renders a square token avatar: real image if we have one, otherwise a
 * generated gradient tile with the first three letters of the symbol.
 *
 * - ``src`` is the DexScreener CDN URL ingested into ``tokens.image_url``.
 *   When DexScreener returns a broken/expired URL the browser fires
 *   ``onError`` and we transparently fall back to the letter tile, so a
 *   single bad asset never leaves the UI showing a torn-image icon.
 * - ``size`` controls both width/height and internal font sizing so the
 *   same component works on small list rows (32px) and prominent report
 *   covers (96px+) without the caller having to hand-tune classes.
 */
export function TokenAvatar({
  src,
  symbol,
  size = 44,
  className = "",
  accent,
  rounded = "xl",
}: {
  src?: string | null;
  symbol?: string | null;
  size?: number;
  className?: string;
  /** Accent colour used for the placeholder halo/background. */
  accent?: string;
  rounded?: "md" | "lg" | "xl" | "2xl" | "full";
}) {
  const [failed, setFailed] = useState(false);
  const showImage = !!src && !failed;
  const letters = (symbol || "?").slice(0, 3).toUpperCase();
  const radiusClass = {
    md: "rounded-md",
    lg: "rounded-lg",
    xl: "rounded-xl",
    "2xl": "rounded-2xl",
    full: "rounded-full",
  }[rounded];
  const fontSize = Math.max(10, Math.round(size * 0.26));

  return (
    <div
      className={`relative flex-none overflow-hidden ring-1 ring-white/10 ${radiusClass} ${className}`}
      style={{
        width: size,
        height: size,
        background: accent
          ? `linear-gradient(135deg, ${accent}33, rgba(139,92,246,0.22))`
          : "linear-gradient(135deg, rgba(94,247,209,0.25), rgba(139,92,246,0.22))",
      }}
    >
      {showImage ? (
        <img
          src={src!}
          alt={symbol ? `${symbol} token logo` : "token logo"}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="grid h-full w-full place-items-center text-white">
          <span
            className="absolute inset-0 opacity-60 blur-md"
            style={{ background: accent ?? "var(--color-helix-a)" }}
          />
          <span
            className="relative font-mono font-bold tracking-tight"
            style={{ fontSize }}
          >
            {letters}
          </span>
        </div>
      )}
    </div>
  );
}
