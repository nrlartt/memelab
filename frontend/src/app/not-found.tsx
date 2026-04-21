import Link from "next/link";
import { MemeLabMark } from "@/components/brand/memelab-mark";

export default function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center text-center">
      <div>
        <MemeLabMark size={64} className="mx-auto h-16 w-16" />
        <h1 className="mt-5 text-4xl font-semibold text-white">Mutation lost</h1>
        <p className="mt-2 text-sm text-[var(--color-ink-400)]">
          This DNA fragment doesn&apos;t exist in the current genome.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-full bg-white/[0.06] px-4 py-2 text-sm text-white ring-1 ring-white/10 hover:bg-white/[0.1]"
        >
          Return to genome
        </Link>
      </div>
    </div>
  );
}
