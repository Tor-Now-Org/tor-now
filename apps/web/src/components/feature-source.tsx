import type { FeatureSourceKind } from "@/lib/api/types.ts";
import { BILLING_ICONS } from "@/components/billing-icons.tsx";

/**
 * Where a Feature comes from, drawn the same for the administrator and the
 * owner (ADR 0021): the Plan a grey check, a Grant a gift — warm once it ends
 * within the week — a Preview a spark, and nothing a dashed lock.
 */
export type SourceTone = "plan" | "grant" | "ending" | "preview" | "none";

export const sourceTone = (source: FeatureSourceKind, endingSoon: boolean): SourceTone => {
  switch (source) {
    case "PLAN":
      return "plan";
    case "GRANT":
      return endingSoon ? "ending" : "grant";
    case "PREVIEW":
      return "preview";
    case "NONE":
      return "none";
  }
};

const ICON: Readonly<Record<SourceTone, keyof typeof BILLING_ICONS>> = {
  plan: "check",
  grant: "gift",
  ending: "gift",
  preview: "spark",
  none: "lock",
};

export const SourceMark = ({ tone }: { tone: SourceTone }) => (
  <span className={`source-mark ${tone}`} aria-hidden="true">
    {BILLING_ICONS[ICON[tone]]}
  </span>
);

export const SourceTag = ({ tone, children }: { tone: SourceTone; children: string }) => (
  <span className={`source-tag ${tone}`}>{children}</span>
);
