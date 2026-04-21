export default function Loading() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="flex flex-col items-center gap-3 text-xs text-[var(--color-ink-400)]">
        <div className="relative h-10 w-10">
          <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-[var(--color-helix-a)] border-r-[var(--color-helix-c)]" />
          <div
            className="absolute inset-1 animate-spin rounded-full border-2 border-transparent border-t-[var(--color-helix-b)]"
            style={{ animationDirection: "reverse", animationDuration: "1.6s" }}
          />
        </div>
        Sequencing DNA…
      </div>
    </div>
  );
}
