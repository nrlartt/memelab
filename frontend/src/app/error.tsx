"use client";

import { useEffect } from "react";
import Link from "next/link";

/** Catches runtime errors under the root layout so the UI does not go blank/unstyled-looking. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="page-shell flex min-h-[50vh] flex-col items-center justify-center gap-4 py-16 text-center">
      <p className="text-sm font-medium text-[var(--color-bad)]">Something went wrong.</p>
      <p className="max-w-md text-xs text-[var(--color-ink-400)]">
        If the UI looks unstyled, delete <code className="font-mono">frontend/.next</code> and run{" "}
        <code className="font-mono">npm run dev</code> again.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 text-xs font-semibold text-white hover:bg-white/10"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-full bg-gradient-to-r from-[var(--color-helix-a)] to-[var(--color-helix-b)] px-4 py-2 text-xs font-semibold text-[var(--color-ink-950)]"
        >
          Back to Overview
        </Link>
      </div>
    </div>
  );
}
