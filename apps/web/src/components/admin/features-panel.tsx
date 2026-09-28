"use client";

import { useEffect, useState } from "react";
import { addDays, parseLocalDate } from "@tor-now/domain";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { DirectoryFilter, FeatureName, FeatureViewDto, PlanName } from "@/lib/api/types.ts";
import { formatLocalDate } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { Critical, Note, Spinner } from "@/components/ui.tsx";
import { BILLING_ICONS } from "@/components/billing-icons.tsx";
import { localDateOf } from "@/components/owner/day-filter.ts";
import { PreviewExtendSheet, PreviewPlacementSheet, PreviewStartSheet } from "./preview-sheets.tsx";

/** The Catalogue is the platform's, so its day is Israel's. */
const PLATFORM_ZONE = "Asia/Jerusalem";

/** How long before a Preview's end it has to be decided, so the Plans losing it hear in time. */
const DECIDE_DAYS_BEFORE = 30;

type Opened = { readonly sheet: "start" | "extend" | "place"; readonly feature: FeatureName } | null;

/**
 * Every Feature (ADR 0020, ADR 0021): where it is sold, a Preview of it, and
 * who has it — each count a way into the Businesses list — and from here,
 * starting a Preview, extending one, and deciding where its Feature goes.
 */
export const FeaturesPanel = ({
  token,
  onShowBusinesses,
  onPlans,
}: {
  token: string;
  onShowBusinesses: (filter: Partial<DirectoryFilter>) => void;
  onPlans: () => void;
}) => {
  const words = useCopy("catalogue");
  const errorText = useErrorText();
  const [features, setFeatures] = useState<FeatureViewDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<Opened>(null);
  const today = localDateOf(new Date().toISOString(), PLATFORM_ZONE);

  useEffect(() => {
    api
      .adminFeatures(token)
      .then((result) => setFeatures(result.features))
      .catch((cause: unknown) => setError(errorText(isApiError(cause) ? cause.code : "INTERNAL")));
  }, [token, errorText]);

  if (error !== null) return <Critical>{error}</Critical>;
  if (features === null) return <Spinner />;

  const viewFor = (sheet: NonNullable<Opened>["sheet"]) =>
    opened?.sheet === sheet ? (features.find((view) => view.feature === opened.feature) ?? null) : null;
  const sheetProps = { today, token, onClose: () => setOpened(null), onSaved: setFeatures };

  return (
    <>
      <Note>{words.featuresNote}</Note>
      {features.map((view) => (
        <FeatureCard
          key={view.feature}
          view={view}
          today={today}
          onOpen={(sheet) => setOpened({ sheet, feature: view.feature })}
          onShowBusinesses={(featureSource) => onShowBusinesses({ feature: view.feature, featureSource })}
          onPlans={onPlans}
        />
      ))}
      <PreviewStartSheet key={`start-${opened?.feature ?? ""}`} view={viewFor("start")} {...sheetProps} />
      <PreviewExtendSheet key={`extend-${opened?.feature ?? ""}`} view={viewFor("extend")} {...sheetProps} />
      <PreviewPlacementSheet key={`place-${opened?.feature ?? ""}`} view={viewFor("place")} {...sheetProps} />
    </>
  );
};

const FeatureCard = ({
  view,
  today,
  onOpen,
  onShowBusinesses,
  onPlans,
}: {
  view: FeatureViewDto;
  today: string;
  onOpen: (sheet: NonNullable<Opened>["sheet"]) => void;
  onShowBusinesses: (from: "PLAN" | "GRANT" | "PREVIEW") => void;
  onPlans: () => void;
}) => {
  const words = useCopy("catalogue");
  const billing = useCopy("billing");
  const { language } = useLanguage();
  const shortDate = (date: string) => formatLocalDate(date, language, { day: "numeric", month: "numeric" });
  const plansList = (plans: readonly PlanName[]) =>
    new Intl.ListFormat(language === "he" ? "he-IL" : "en-GB", { type: "conjunction" }).format(
      plans.map((plan) => billing.plan[plan]),
    );
  const { preview, counts } = view;
  const anyone = counts.PLAN + counts.GRANT + counts.PREVIEW > 0;
  const lacking = view.plans.filter((plan) => !plan.included).map((plan) => plan.plan);

  const note = (): string | null => {
    if (preview === null) return null;
    if (preview.keepOn === null) {
      return fillText(words.decideBy, {
        end: shortDate(preview.endsOn),
        by: shortDate(addDays(parseLocalDate(preview.endsOn), -DECIDE_DAYS_BEFORE)),
      });
    }
    const keeping = lacking.filter((plan) => preview.keepOn?.includes(plan));
    const leaving = lacking.filter((plan) => !preview.keepOn?.includes(plan));
    return fillText(words.decided, {
      keep: keeping.length === 0 ? words.decidedKeepNone : fillText(words.decidedKeep, { plans: plansList(keeping) }),
      leave: leaving.length === 0 ? "" : fillText(words.decidedLeave, { plans: plansList(leaving), date: shortDate(preview.endsOn) }),
    });
  };

  const said = note();
  return (
    <div className="card feature-card">
      <div className="what">
        <strong>{billing.featureName[view.feature]}</strong>
        <span className="hint">{words.featureWhat[view.feature]}</span>
      </div>
      <div className="part">
        <span className="label">{words.whereItIs}</span>
        <div className="tags">
          {preview !== null && (
            <span className="where preview">
              {BILLING_ICONS.spark}
              {fillText(words.previewEverywhere, { date: shortDate(preview.endsOn) })}
            </span>
          )}
          {view.plans.map((plan) =>
            plan.included ? (
              <span key={plan.plan} className="where plan">
                {BILLING_ICONS.check}
                {billing.plan[plan.plan]} v{plan.number}
              </span>
            ) : preview === null ? (
              <span key={plan.plan} className="where none">
                {fillText(words.notOnPlan, { plan: billing.plan[plan.plan] })}
              </span>
            ) : null,
          )}
        </div>
      </div>
      <div className="part">
        <span className="label">{words.whoHasIt}</span>
        {anyone ? (
          <div className="tags">
            {(["PLAN", "GRANT", "PREVIEW"] as const)
              .filter((from) => counts[from] > 0)
              .map((from) => (
                <button key={from} type="button" className="count" onClick={() => onShowBusinesses(from)}>
                  <b className="tab">{counts[from]}</b>
                  {from === "PLAN" ? words.countPlan : from === "GRANT" ? words.countGrant : words.countPreview}
                </button>
              ))}
          </div>
        ) : (
          <span className="hint">{words.nobodyHasIt}</span>
        )}
      </div>
      {said !== null && <p className="note" style={{ margin: 0 }}>{said}</p>}
      <div className="actions">
        {view.canPreview && (
          <button type="button" onClick={() => onOpen("start")}>
            {words.startPreview}
          </button>
        )}
        {preview !== null && preview.keepOn === null && (
          <button type="button" onClick={() => onOpen("place")}>
            {words.placePreview}
          </button>
        )}
        {preview !== null && preview.endsOn >= today && (
          <button type="button" onClick={() => onOpen("extend")}>
            {words.extendPreview}
          </button>
        )}
        <button type="button" onClick={onPlans}>
          {words.toPlans}
        </button>
      </div>
    </div>
  );
};
