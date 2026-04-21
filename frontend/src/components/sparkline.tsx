/**
 * Tiny inline SVG sparkline used on family cards. No dependencies and no
 * hover state - this is intentionally a *glanceable* trajectory cue, not a
 * chart. Renders nothing if < 2 points, so the layout doesn't jump when a
 * family is too young to have timepoints yet.
 */
export function Sparkline({
  points,
  width = 72,
  height = 22,
  className = "",
}: {
  points: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (!points || points.length < 2) {
    return (
      <div
        className={`flex h-[${height}px] items-center text-[9px] uppercase tracking-[0.18em] text-[var(--color-ink-500)] ${className}`}
        style={{ width, height }}
      >
        -
      </div>
    );
  }
  const max = Math.max(1, ...points);
  const min = 0;
  const span = Math.max(1, max - min);
  const stepX = width / (points.length - 1);
  const pad = 2;
  const y = (v: number) =>
    height - pad - ((v - min) / span) * (height - pad * 2);

  const d = points
    .map((p, i) => {
      const xi = i * stepX;
      return `${i === 0 ? "M" : "L"} ${xi.toFixed(1)} ${y(p).toFixed(1)}`;
    })
    .join(" ");
  const area = `${d} L ${width.toFixed(1)} ${height - pad} L 0 ${height - pad} Z`;
  const last = points[points.length - 1];
  const prev = points[points.length - 2] ?? last;
  const up = last >= prev;
  const color = up ? "var(--color-helix-a)" : "var(--color-strain-origin)";
  const gradId = up ? "spark-up" : "spark-down";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={Math.round((points.length - 1) * stepX * 100) / 100}
        cy={Math.round(y(last) * 100) / 100}
        r={2}
        fill={color}
      />
    </svg>
  );
}
