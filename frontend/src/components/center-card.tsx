import { Globe2, MapPin, MessageSquare, User2, type LucideIcon } from "lucide-react";
import { Card, CardHeader, CardTitle } from "./ui/card";

type CenterKind = "source" | "entity" | "geo" | "community";

const META: Record<
  CenterKind,
  { label: string; Icon: LucideIcon; accent: string }
> = {
  source: {
    label: "Source Center",
    Icon: Globe2,
    accent: "text-[var(--color-helix-a)]",
  },
  entity: {
    label: "Entity Center",
    Icon: User2,
    accent: "text-[var(--color-helix-b)]",
  },
  geo: {
    label: "Geo Center",
    Icon: MapPin,
    accent: "text-[var(--color-helix-d)]",
  },
  community: {
    label: "Community Center",
    Icon: MessageSquare,
    accent: "text-[var(--color-helix-c)]",
  },
};

export function CenterCard({
  kind,
  value,
  url,
  description,
}: {
  kind: CenterKind;
  value: string | null;
  url?: string | null;
  description?: string;
}) {
  const { label, Icon, accent } = META[kind];
  const content = (
    <>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Icon className={`h-3.5 w-3.5 ${accent}`} />
          <CardTitle>{label}</CardTitle>
        </div>
      </CardHeader>
      <div className="space-y-2">
        {value ? (
          <div className="text-sm font-medium leading-snug text-white">
            {value}
          </div>
        ) : (
          <div className="text-xs italic text-[var(--color-ink-400)]">
            Not enough signal in this cluster yet.
          </div>
        )}
        {description && (
          <p className="text-[11px] leading-relaxed text-[var(--color-ink-400)]">
            {description}
          </p>
        )}
      </div>
    </>
  );

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="block transition-colors hover:ring-1 hover:ring-white/10"
      >
        <Card>{content}</Card>
      </a>
    );
  }
  return <Card>{content}</Card>;
}
