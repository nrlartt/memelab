import { ShieldCheck, Sparkles } from "lucide-react";
import { MEMELAB_TAGLINE } from "@/lib/brand";
import { DnaHelix } from "./dna-helix";

type LiveStat = { label: string; value: string; hint?: string };

/**
 * Full-bleed hero banner. Touches both viewport edges and stretches to
 * a comfortable screen height. The animation layer has been rewritten:
 *
 *   - Soft aurora (two orbiting radial gradients).
 *   - Animated scanline / grid.
 *   - Rotating double helix on the right (existing component).
 *   - Parallax light spots drifting behind the content.
 */
export function Hero({ liveStats }: { liveStats?: LiveStat[] }) {
  return (
    <section className="full-bleed relative isolate overflow-hidden border-y border-white/5 bg-[var(--color-ink-950)]">
      {/* Aurora backdrop */}
      <div className="pointer-events-none absolute inset-0 -z-20">
        <div className="aurora-blob aurora-a" />
        <div className="aurora-blob aurora-b" />
        <div className="aurora-blob aurora-c" />
      </div>

      {/* Animated grid scanline */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.22]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage:
            "radial-gradient(ellipse 70% 80% at 50% 40%, black 30%, transparent 80%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 70% 80% at 50% 40%, black 30%, transparent 80%)",
        }}
      />

      {/* Helix (rotating, right side) */}
      <div className="pointer-events-none absolute right-0 top-0 -z-10 hidden h-full w-[55%] opacity-80 lg:block">
        <div
          className="absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(60% 60% at 65% 40%, rgba(94,247,209,0.15), transparent 70%), radial-gradient(50% 50% at 85% 55%, rgba(139,92,246,0.18), transparent 70%)",
          }}
        />
        <DnaHelix height={640} />
      </div>

      {/* Content */}
      <div className="relative mx-auto flex min-h-[560px] w-full max-w-[1800px] flex-col justify-center gap-10 px-6 py-16 sm:px-10 sm:py-24 lg:min-h-[640px] lg:px-14 xl:px-20">
        <div className="max-w-2xl">
          <span className="inline-flex animate-[fade-up_0.7s_ease_both] flex-wrap items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] leading-snug text-[var(--color-ink-200)] backdrop-blur sm:gap-2.5">
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-helix-a)] opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-helix-a)]" />
            </span>
            <span className="font-medium text-white">{MEMELAB_TAGLINE}</span>
            <span className="text-[var(--color-ink-500)]">·</span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-ink-400)]">
              Four.Meme · BNB Chain
            </span>
            <Sparkles className="h-3 w-3 shrink-0 text-[var(--color-helix-b)]" aria-hidden />
          </span>

          <h1
            className="mt-6 animate-[fade-up_0.9s_0.08s_ease_both] text-5xl font-semibold leading-[1.02] tracking-tight text-white sm:text-6xl md:text-7xl"
            style={{ textWrap: "balance" }}
          >
            Decoding the <span className="gradient-text">genome</span>
            <br /> of meme tokens.
          </h1>
          <p className="mt-6 max-w-xl animate-[fade-up_1s_0.2s_ease_both] text-base leading-relaxed text-[var(--color-ink-300)] sm:text-lg">
            We run a continuous pipeline: new tokens are discovered, counted, and grouped
            into <span className="text-white">DNA Families</span> tied to real-world
            events. Each family exposes roles such as{" "}
            <span className="text-[var(--color-strain-origin)]">Origin Strain</span>,{" "}
            <span className="text-[var(--color-strain-dominant)]">Dominant Strain</span>,
            and <span className="text-[var(--color-strain-fastest)]">Fastest Mutation</span>,
            with <span className="text-white">AI-assisted</span> labels and narratives on
            top of verifiable on-chain facts.
          </p>

          {liveStats && liveStats.length > 0 && (
            <dl className="mt-10 grid max-w-2xl animate-[fade-up_1.2s_0.4s_ease_both] grid-cols-2 gap-4 sm:grid-cols-4">
              {liveStats.map((s) => (
                <div
                  key={s.label}
                  className="relative overflow-hidden rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3 backdrop-blur"
                >
                  <div className="absolute -left-6 -top-6 h-16 w-16 rounded-full bg-[var(--color-helix-a)]/10 blur-2xl" />
                  <dt className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-400)]">
                    {s.label}
                  </dt>
                  <dd className="mt-1.5 font-mono text-xl font-semibold leading-none text-white">
                    {s.value}
                  </dd>
                  {s.hint && (
                    <dd className="mt-1 truncate text-[10px] text-[var(--color-ink-500)]">
                      {s.hint}
                    </dd>
                  )}
                </div>
              ))}
            </dl>
          )}

          <dl className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-400)] animate-[fade-up_1.3s_0.5s_ease_both]">
            <Badge icon={<ShieldCheck className="h-3 w-3 text-[var(--color-helix-a)]" />}>
              Semantic clustering
            </Badge>
            <Badge>AI-assisted analysis</Badge>
            <Badge>Live BNB Chain data</Badge>
          </dl>
        </div>
      </div>
    </section>
  );
}

function Badge({
  children,
  icon,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.03] px-2.5 py-1 ring-1 ring-white/5 backdrop-blur">
      {icon}
      {children}
    </span>
  );
}
