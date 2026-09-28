"use client";

import { useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { AddonDto, FeatureName, FeatureSourceDto, PlanDto } from "@/lib/api/types.ts";
import { addonTagOf } from "@/lib/addon-tag.ts";
import { formatLocalDate, formatPrice } from "@/lib/format.ts";
import { daysLeft, isEndingSoon } from "@/lib/grant-length.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { Card, Critical } from "@/components/ui.tsx";
import { SourceMark, SourceTag, sourceTone } from "@/components/feature-source.tsx";
import { ExtendSheet, GrantSheet } from "./grant-sheets.tsx";

/**
 * A Business's Features in the administrator's Business sheet (ADR 0021): all
 * of them in one list, each saying where it comes from, with Extend and End on
 * every Grant — and one button that grants several at once.
 */
export const FeaturesCard = ({
  token,
  businessId,
  businessName,
  features,
  addons = [],
  plans,
  today,
  onChanged,
}: {
  token: string;
  businessId: string;
  businessName: string;
  features: readonly FeatureSourceDto[];
  /** What the Business holds on its own, for each Add-on line's price. */
  addons?: readonly AddonDto[];
  plans: readonly PlanDto[];
  /** The Business's own today, as YYYY-MM-DD. */
  today: string;
  onChanged: (features: FeatureSourceDto[]) => void;
}) => {
  const words = useCopy("catalogue");
  const billing = useCopy("billing");
  const { language } = useLanguage();
  const errorText = useErrorText();
  const [granting, setGranting] = useState(false);
  const [extending, setExtending] = useState<FeatureSourceDto | null>(null);
  const [ending, setEnding] = useState<FeatureName | null>(null);
  const [error, setError] = useState<string | null>(null);
  const longDate = (date: string) => formatLocalDate(date, language);
  const granted = features.filter((source) => source.source === "GRANT").length;
  const cheapest = [...plans].sort((a, b) => a.priceMinor - b.priceMinor);

  const end = async (source: FeatureSourceDto) => {
    if (source.grant === null) return;
    setError(null);
    try {
      onChanged((await api.adminEndGrant(token, businessId, source.grant.id)).features);
      setEnding(null);
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    }
  };

  const tagOf = (source: FeatureSourceDto, soon: boolean): string => {
    switch (source.source) {
      case "PLAN":
        return words.tagPlan;
      case "ADDON":
        return addonTagOf(source, addons, {
          words: billing,
          money: (minor) => formatPrice(minor, language, "—"),
          shortDate: (date) => formatLocalDate(date, language, { day: "numeric", month: "numeric" }),
        });
      case "PREVIEW":
        return words.tagPreview;
      case "NONE":
        return words.tagNone;
      case "GRANT": {
        if (!soon || source.endsOn === null) return words.tagGranted;
        const left = daysLeft(today, source.endsOn);
        return left === 0 ? words.tagEndingToday : fillText(words.tagEndingIn, { n: String(left) });
      }
    }
  };

  const detailOf = (source: FeatureSourceDto): string | null => {
    if (source.source === "GRANT" && source.grant !== null && source.endsOn !== null) {
      return fillText(words.grantDetail, {
        date: longDate(source.endsOn),
        reason: source.grant.reason,
        by: source.grant.grantedBy ?? "—",
      });
    }
    if (source.source === "PREVIEW" && source.endsOn !== null) {
      return fillText(words.previewDetail, { date: longDate(source.endsOn) });
    }
    if (source.source === "NONE") {
      const plan = cheapest.find((candidate) => candidate.features.includes(source.feature));
      return plan === undefined ? null : fillText(words.onPlan, { plan: billing.plan[plan.plan] });
    }
    return null;
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="label" style={{ flex: 1 }}>
          {granted === 0 ? words.features : fillText(words.grantedCount, { n: String(granted) })}
        </span>
        <button
          type="button"
          onClick={() => setGranting(true)}
          style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)", minHeight: 36 }}
        >
          {words.grantFeatures}
        </button>
      </div>
      <Card padded={false}>
        {features.map((source) => {
          const soon = source.source === "GRANT" && source.endsOn !== null && isEndingSoon(today, source.endsOn);
          const tone = sourceTone(source.source, soon);
          const detail = detailOf(source);
          return (
            <div key={source.feature} className={`feature-row ${tone}`}>
              <SourceMark tone={tone} />
              <span className="what">
                <span className="name">
                  <strong>{billing.featureName[source.feature]}</strong>
                  <SourceTag tone={tone}>{tagOf(source, soon)}</SourceTag>
                </span>
                {detail !== null && <span className="hint">{detail}</span>}
              </span>
              {source.source === "GRANT" && source.grant !== null && (
                <span className="actions">
                  {ending === source.feature ? (
                    <>
                      <span className="hint">{words.endConfirm}</span>
                      <button type="button" className="end" onClick={() => void end(source)}>
                        {words.endYes}
                      </button>
                      <button type="button" className="no" onClick={() => setEnding(null)}>
                        {words.endNo}
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => setExtending(source)}>
                        {words.extend}
                      </button>
                      <button type="button" className="end" onClick={() => setEnding(source.feature)}>
                        {words.end}
                      </button>
                    </>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </Card>
      {error !== null && <Critical>{error}</Critical>}

      <GrantSheet
        open={granting}
        onClose={() => setGranting(false)}
        token={token}
        businessId={businessId}
        businessName={businessName}
        features={features}
        today={today}
        onGranted={onChanged}
      />
      <ExtendSheet
        key={extending?.feature ?? "none"}
        source={extending}
        onClose={() => setExtending(null)}
        token={token}
        businessId={businessId}
        today={today}
        onExtended={onChanged}
      />
    </>
  );
};
