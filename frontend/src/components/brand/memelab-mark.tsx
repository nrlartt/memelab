/**
 * MemeLab brand mark.
 *
 * Design brief
 * ------------
 * The glyph is an Erlenmeyer flask (universal laboratory icon) holding
 * a gradient "essence" with two bubbles, and a four-pointed sparkle
 * rising from the flask neck. Read literally, it is MemeLab: a
 * laboratory that distills *sparks* - the viral sparks of memes.
 *
 * The flask gives us "lab". The sparkle above it gives us "meme /
 * launch / to the moon". The bubbling liquid ties both together as an
 * ongoing experiment.
 *
 * Variants
 * --------
 * - ``color``     Default. Dark rounded-square badge with a gradient
 *                 flask and liquid. Self-contained.
 * - ``mono``      Single-ink, no badge. Uses ``currentColor`` so it
 *                 inherits from the surrounding text - ideal for
 *                 print, email signatures, and dense monochrome
 *                 surfaces (e.g. the report cover).
 * - ``glyph``     Gradient flask with *no* backdrop - meant to live
 *                 inside a pre-styled outer container (e.g. a nav
 *                 chip that owns the dark fill and glow).
 *
 * Notes
 * -----
 * - All geometry is laid out inside a 64×64 viewBox. Stays legible
 *   down to a 16×16 favicon (tested) because the silhouette is
 *   dominated by the flask; details like bubbles degrade gracefully.
 * - React.useId gives each instance unique gradient ids so multiple
 *   marks on a page don't alias and re-colour each other.
 */

import * as React from "react";

type Variant = "color" | "mono" | "glyph";

interface MemeLabMarkProps {
  /** Visual variant - see file doc. Defaults to ``color``. */
  variant?: Variant;
  /** Side length in pixels. The glyph is square. Defaults to 40. */
  size?: number;
  /** Extra classnames for sizing/layout when ``size`` isn't enough. */
  className?: string;
  /** Accessible label. Set to "" to mark decorative. Defaults to "MemeLab". */
  title?: string;
}

export function MemeLabMark({
  variant = "color",
  size = 40,
  className,
  title = "MemeLab",
}: MemeLabMarkProps) {
  const decorative = title === "";
  // Stable, SSR-safe unique ids so two marks on the same page don't
  // share gradient definitions.
  const uid = React.useId().replace(/[:#]/g, "");
  const gStroke = `ml-stroke-${uid}`;
  const gLiquid = `ml-liquid-${uid}`;

  const isMono = variant === "mono";
  const strokeColor = isMono ? "currentColor" : `url(#${gStroke})`;
  const liquidFill = isMono ? "currentColor" : `url(#${gLiquid})`;
  const liquidOpacity = isMono ? 0.22 : 1;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role={decorative ? "presentation" : "img"}
      aria-label={decorative ? undefined : title}
      aria-hidden={decorative || undefined}
      className={className}
    >
      {!isMono ? (
        <defs>
          {/* Brand gradient - teal → violet → pink (bottom-left → top-right).
              Used for the flask outline and the rising sparkle so the glyph
              carries a single diagonal colour run. */}
          <linearGradient id={gStroke} x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#5EF7D1" />
            <stop offset="50%" stopColor="#8B5CF6" />
            <stop offset="100%" stopColor="#F0ABFC" />
          </linearGradient>
          {/* Vertical liquid gradient - more violet at top, pinker at bottom.
              Works like a heavy reagent settling in the flask. */}
          <linearGradient id={gLiquid} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#F0ABFC" stopOpacity="0.85" />
          </linearGradient>
        </defs>
      ) : null}

      {/* Backdrop - only for the self-contained ``color`` variant. */}
      {variant === "color" ? (
        <>
          <rect width="64" height="64" rx="15" fill="#0A0E17" />
          <rect
            x="0.75"
            y="0.75"
            width="62.5"
            height="62.5"
            rx="14.25"
            fill="none"
            stroke={`url(#${gStroke})`}
            strokeWidth="1"
            opacity="0.35"
          />
        </>
      ) : null}

      {/* ------- LIQUID FILL -------
          Drawn first so the flask stroke overlays it cleanly. The top
          edge has a subtle concave meniscus (control point dips DOWN
          in SVG space, which visually reads as a gentle U-curve). */}
      <path
        d="M 20 39.5 Q 32 41.5 44 39.5 L 48 52 L 16 52 Z"
        fill={liquidFill}
        opacity={liquidOpacity}
      />

      {/* ------- BUBBLES inside the liquid -------
          Two only; three tends to look cluttered at favicon scale. */}
      <circle
        cx="25"
        cy="45"
        r="1.5"
        fill={isMono ? "currentColor" : "#5EF7D1"}
        opacity={isMono ? 0.5 : 0.9}
      />
      <circle
        cx="38"
        cy="48"
        r="1.1"
        fill={isMono ? "currentColor" : "#F0ABFC"}
        opacity={isMono ? 0.5 : 0.85}
      />

      {/* ------- FLASK OUTLINE -------
          Drawn as a single path: the wide rim sits above a narrower
          neck, shoulders flare outward, and the conical body closes
          on a slightly-rounded base. Widened rim ("lip") gives the
          silhouette a clearly-erlenmeyer profile instead of a
          generic triangle. */}
      <path
        d="M 23 13 L 41 13 L 41 15 L 38 15 L 38 25 L 49 52 Q 49.5 54.5 47 54.5 L 17 54.5 Q 14.5 54.5 15 52 L 26 25 L 26 15 L 23 15 Z"
        fill="none"
        stroke={strokeColor}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* ------- RISING SPARKLE -------
          Four-pointed star above the flask neck. Reads as the "meme"
          that the lab is distilling - the viral spark. Its long
          vertical axis implies upward motion ("to the moon") without
          resorting to the crypto-rocket cliché. */}
      <path
        d="M 32 2 L 33.3 6.5 L 37.5 7.2 L 33.3 7.9 L 32 12 L 30.7 7.9 L 26.5 7.2 L 30.7 6.5 Z"
        fill={isMono ? "currentColor" : `url(#${gStroke})`}
      />

      {/* Tiny satellite sparkle - pushes the "distilling sparks" read
          and adds a micro-narrative (one spark plus a smaller one
          falling back). Scales out of view at favicon size, which is
          fine. */}
      <path
        d="M 44 19 L 44.6 20.8 L 46.4 21.4 L 44.6 22 L 44 23.8 L 43.4 22 L 41.6 21.4 L 43.4 20.8 Z"
        fill={isMono ? "currentColor" : "#F0ABFC"}
        opacity={isMono ? 0.6 : 0.85}
      />
    </svg>
  );
}

/**
 * Horizontal brand lockup: mark + wordmark + optional tagline.
 *
 * Sits as a drop-in for the repeated ``<img /> + <span>MemeLab</span>``
 * pattern in the nav and footer.
 */
export function MemeLabLockup({
  size = 36,
  className,
  tagline = "Meme Lab",
  markVariant = "color",
}: {
  size?: number;
  className?: string;
  /** Small uppercase subtitle below the wordmark. Set to "" to hide. */
  tagline?: string;
  markVariant?: Variant;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <MemeLabMark variant={markVariant} size={size} />
      <span className="flex flex-col leading-tight">
        <span
          className="font-semibold tracking-tight"
          style={{ fontSize: size * 0.39 }}
        >
          MemeLab
        </span>
        {tagline ? (
          <span
            className="uppercase tracking-[0.24em] text-[var(--color-ink-400)]"
            style={{ fontSize: size * 0.26 }}
          >
            {tagline}
          </span>
        ) : null}
      </span>
    </span>
  );
}
