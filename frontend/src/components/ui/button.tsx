import * as React from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "ghost" | "outline";

const styles: Record<Variant, string> = {
  primary:
    "bg-gradient-to-br from-[var(--color-helix-a)] to-[var(--color-helix-b)] text-[var(--color-ink-950)] shadow-[0_6px_30px_-10px_rgba(139,92,246,0.6)] hover:brightness-110",
  ghost:
    "text-[var(--color-ink-200)] hover:bg-white/5",
  outline:
    "ring-1 ring-white/10 text-[var(--color-ink-100)] hover:bg-white/5",
};

export function Button({
  className,
  variant = "primary",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-helix-a)]/40",
        styles[variant],
        className
      )}
      {...rest}
    />
  );
}
