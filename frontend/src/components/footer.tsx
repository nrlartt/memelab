import Link from "next/link";
import { FlaskConical, Github } from "lucide-react";
import { MemeLabMark } from "./brand/memelab-mark";
import { MEMELAB_TAGLINE } from "@/lib/brand";

const X_URL = "https://x.com/nrlartt";

function githubHref(): string {
  const u = process.env.NEXT_PUBLIC_GITHUB_URL?.trim();
  return u && u.startsWith("http") ? u : "https://github.com/";
}

export function Footer() {
  return (
    <footer className="border-t border-white/5 bg-[var(--color-ink-950)]/60">
      <div className="page-shell flex flex-col gap-6 py-8 text-xs text-[var(--color-ink-400)]">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex max-w-md flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
            <div className="flex items-center gap-2">
              <MemeLabMark size={22} className="h-[22px] w-[22px] opacity-95" />
              <span className="font-medium tracking-wider text-[var(--color-ink-200)]">
                MemeLab
              </span>
            </div>
            <p className="text-sm leading-snug text-[var(--color-ink-400)]">
              {MEMELAB_TAGLINE}
            </p>
          </div>
          <nav
            className="flex flex-wrap items-center gap-x-5 gap-y-2"
            aria-label="Footer"
          >
            <Link href="/about" className="hover:text-white">
              About
            </Link>
            <Link href="/docs" className="hover:text-white">
              Docs &amp; API
            </Link>
            <Link
              href="/lab-report"
              className="inline-flex items-center gap-1.5 font-medium text-[var(--color-helix-a)] hover:text-[var(--color-helix-c)]"
            >
              <FlaskConical className="h-3.5 w-3.5" aria-hidden />
              Try Lab Report
            </Link>
            <a
              href="https://four-meme.gitbook.io/four.meme"
              target="_blank"
              rel="noreferrer"
              className="hover:text-white"
            >
              Four.Meme
            </a>
            <a
              href={X_URL}
              target="_blank"
              rel="noreferrer"
              className="hover:text-white"
            >
              X
            </a>
            <a
              href={githubHref()}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-white"
              title="Repository (set NEXT_PUBLIC_GITHUB_URL to your repo)"
            >
              <Github className="h-3.5 w-3.5" aria-hidden />
              GitHub
            </a>
          </nav>
        </div>
        <p className="text-[11px] text-[var(--color-ink-500)]">
          BNB Smart Chain · chain id 56 · Not financial advice.
        </p>
      </div>
    </footer>
  );
}
