import * as React from "react";
import { cn } from "@/lib/cn";

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  as?: "div" | "article" | "section";
  glow?: boolean;
};

export function Card({ as: Tag = "div", glow, className, ...rest }: CardProps) {
  return (
    <Tag
      className={cn(
        "glass rounded-2xl p-5",
        glow && "ring-helix",
        "transition-colors",
        className
      )}
      {...rest}
    />
  );
}

export function CardHeader({
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mb-4 flex items-start justify-between gap-3", className)}
      {...rest}
    />
  );
}

export function CardTitle({
  className,
  ...rest
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--color-ink-300)]",
        className
      )}
      {...rest}
    />
  );
}
