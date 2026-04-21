import { Crown, Sparkles, Zap } from "lucide-react";
import { Badge } from "./ui/badge";
import { shortAddress } from "@/lib/format";
import type { StrainRef } from "@/lib/types";

type StrainKind = "origin" | "dominant" | "fastest";

const META: Record<StrainKind, { label: string; Icon: typeof Crown }> = {
  origin: { label: "Origin Strain", Icon: Sparkles },
  dominant: { label: "Dominant Strain", Icon: Crown },
  fastest: { label: "Fastest Mutation", Icon: Zap },
};

export function StrainBadge({
  kind,
  strain,
  compact = false,
}: {
  kind: StrainKind;
  strain: StrainRef | null;
  compact?: boolean;
}) {
  const { label, Icon } = META[kind];
  if (!strain) {
    return (
      <Badge variant="muted" className="gap-1">
        <Icon className="h-3 w-3" />
        {compact ? "-" : `${label}: -`}
      </Badge>
    );
  }
  return (
    <Badge variant={kind} className="gap-1.5">
      <Icon className="h-3 w-3" />
      {compact ? (
        <span className="max-w-[10ch] truncate font-mono">{strain.symbol || shortAddress(strain.token)}</span>
      ) : (
        <>
          <span className="opacity-70">{label}:</span>
          <span className="max-w-[14ch] truncate font-mono">{strain.symbol || shortAddress(strain.token)}</span>
        </>
      )}
    </Badge>
  );
}
