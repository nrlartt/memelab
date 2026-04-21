"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Dna,
  Activity,
  Flame,
  Compass,
  BookOpen,
  FlaskConical,
  Search as SearchIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { SearchBar } from "./search-bar";
import { ConnectWallet } from "./connect-wallet";
import { MemeLabMark } from "./brand/memelab-mark";

const nav = [
  { href: "/", label: "Overview", icon: Activity },
  { href: "/families", label: "DNA Families", icon: Dna },
  { href: "/explorer", label: "Explorer", icon: Compass },
  { href: "/lab-report", label: "Lab Report", icon: FlaskConical },
  { href: "/trending", label: "Trending", icon: Flame },
  { href: "/docs", label: "Docs", icon: BookOpen },
];

export function Nav() {
  const pathname = usePathname();
  return (
    // 3-column grid - logo pins to the left edge, primary nav centers,
    // search+wallet pin to the right edge. Container is now full-bleed
    // (no inner max-w) so the corner controls really do sit at the edge.
    <header className="sticky top-0 z-40 border-b border-white/5 bg-[var(--color-ink-950)]/75 backdrop-blur-xl">
      <div className="grid h-16 w-full grid-cols-[auto_1fr_auto] items-center gap-4 px-4 sm:px-6 lg:px-8 xl:px-10">
        {/* LEFT - brand. The mark is self-contained (has its own dark
            badge + gradient ring) so we just add a subtle hover glow
            at the outer edge instead of a second ring. */}
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="relative inline-flex h-9 w-9 items-center justify-center">
            <span
              aria-hidden
              className="absolute inset-[-3px] rounded-[14px] bg-gradient-to-br from-[var(--color-helix-a)]/35 via-[var(--color-helix-b)]/25 to-[var(--color-helix-c)]/35 opacity-0 blur-md transition-opacity duration-300 group-hover:opacity-100"
            />
            <MemeLabMark size={36} className="relative h-9 w-9" />
          </span>
          <div className="hidden flex-col leading-tight sm:flex">
            <span className="text-sm font-semibold tracking-tight text-white">
              MemeLab
            </span>
            <span className="text-[10px] uppercase tracking-[0.24em] text-[var(--color-ink-400)]">
              DNA · meme lab
            </span>
          </div>
        </Link>

        {/* CENTER - primary nav */}
        <nav className="hidden items-center justify-center gap-1 md:flex">
          <div className="flex items-center gap-1 rounded-full border border-white/5 bg-white/[0.02] p-1 shadow-[0_10px_40px_-20px_rgba(139,92,246,0.35)]">
            {nav.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "group relative rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                    active
                      ? "text-[var(--color-ink-950)]"
                      : "text-[var(--color-ink-300)] hover:text-white"
                  )}
                >
                  {active && (
                    <span className="absolute inset-0 -z-0 rounded-full bg-gradient-to-r from-[var(--color-helix-a)] to-[var(--color-helix-c)]" />
                  )}
                  <span className="relative z-10 inline-flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5 opacity-80" />
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>

        {/* RIGHT - search + wallet */}
        <div className="flex items-center justify-end gap-2 sm:gap-3">
          <div className="hidden sm:block">
            <SearchBar />
          </div>
          <Link
            href="/lab-report"
            className="hidden shrink-0 items-center gap-1.5 rounded-full border border-[var(--color-helix-a)]/35 bg-[var(--color-helix-a)]/[0.08] px-3 py-1.5 text-[12px] font-semibold text-[var(--color-helix-a)] transition hover:border-[var(--color-helix-a)]/55 hover:bg-[var(--color-helix-a)]/15 md:inline-flex"
          >
            <FlaskConical className="h-3.5 w-3.5" aria-hidden />
            Try Lab Report
          </Link>
          <ConnectWallet />
        </div>
      </div>
    </header>
  );
}

export { SearchIcon };
