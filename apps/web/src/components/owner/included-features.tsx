"use client";

import type { AddonDto, FeatureSourceDto, PlanDto } from "@/lib/api/types.ts";
import { addonTagOf } from "@/lib/addon-tag.ts";
import { formatLocalDate, formatPrice } from "@/lib/format.ts";
import { isEndingSoon } from "@/lib/grant-length.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { Card } from "@/components/ui.tsx";
import { SourceMark, SourceTag, sourceTone } from "@/components/feature-source.tsx";

/**
 * What the owner has, and from where (ADR 0021): the Plan, an Add-on,
 * something given until a day, a Preview — and for what they don't have, the
 * Plan that does.
 * The same list the administrator reads, in the owner's words.
 */
export const IncludedFeatures = ({
  features,
  addons = [],
  plans,
  today,
}: {
  features: readonly FeatureSourceDto[];
  /** What the Business holds on its own, for each Add-on line's price. */
  addons?: readonly AddonDto[];
  plans: readonly PlanDto[];
  /** The Business's own today, as YYYY-MM-DD. */
  today: string;
}) => {
  const words = useCopy("billing");
  const { language } = useLanguage();
  const shortDate = (date: string) => formatLocalDate(date, language, { day: "numeric", month: "numeric" });
  // Cheapest first, so a Feature on both Plans names the one it takes least to reach.
  const cheapest = [...plans].sort((a, b) => a.priceMinor - b.priceMinor);

  const tagOf = (source: FeatureSourceDto): string => {
    switch (source.source) {
      case "PLAN":
        return words.sourcePlan;
      case "ADDON":
        return addonTagOf(source, addons, {
          words,
          money: (minor) => formatPrice(minor, language, "—"),
          shortDate,
        });
      case "GRANT":
        return fillText(words.sourceGrant, { date: shortDate(source.endsOn ?? today) });
      case "PREVIEW":
        return fillText(words.sourcePreview, { date: shortDate(source.endsOn ?? today) });
      case "NONE": {
        const plan = cheapest.find((candidate) => candidate.features.includes(source.feature));
        return plan === undefined ? words.sourceNone : fillText(words.sourceOnPlan, { plan: words.plan[plan.plan] });
      }
    }
  };

  return (
    <>
      <span className="label">{words.included}</span>
      <Card style={{ padding: "6px 16px" }}>
        {features.map((source) => {
          const tone = sourceTone(source.source, source.endsOn !== null && isEndingSoon(today, source.endsOn));
          return (
            <div key={source.feature} className={`feature-row compact ${tone}`}>
              <SourceMark tone={tone} />
              <span className="what">
                <strong>{words.featureName[source.feature]}</strong>
              </span>
              <SourceTag tone={tone}>{tagOf(source)}</SourceTag>
            </div>
          );
        })}
      </Card>
    </>
  );
};
