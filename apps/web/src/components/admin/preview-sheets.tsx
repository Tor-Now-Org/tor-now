"use client";

import { useState } from "react";
import { addDays, daysBetween, MAX_PREVIEW_DAYS, MIN_PREVIEW_DAYS, parseLocalDate } from "@tor-now/domain";
import { api } from "@/lib/api/client.ts";
import type { FeatureViewDto, PlanName } from "@/lib/api/types.ts";
import { formatLocalDate } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { Button, Card, Critical, Note, Sheet } from "@/components/ui.tsx";
import { useSubmit } from "./grant-sheets.tsx";
import { lastDayOf, LengthPicker, type Length } from "./length-picker.tsx";
import { EffectBox } from "./plan-edit-sheet.tsx";

/**
 * Previews from the Features tab (ADR 0020): starting one, carrying one on,
 * and deciding which Plans keep its Feature when it ends.
 */

type Saved = (features: FeatureViewDto[]) => void;

const inRange = (today: string, endsOn: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) return false;
  const days = daysBetween(parseLocalDate(today), parseLocalDate(endsOn));
  return days >= MIN_PREVIEW_DAYS && days <= MAX_PREVIEW_DAYS;
};

const useNames = () => {
  const billing = useCopy("billing");
  const { language } = useLanguage();
  const list = (plans: readonly PlanName[]) =>
    new Intl.ListFormat(language === "he" ? "he-IL" : "en-GB", { type: "conjunction" }).format(
      plans.map((plan) => billing.plan[plan]),
    );
  return { billing, language, list };
};

export const PreviewStartSheet = ({
  view,
  today,
  token,
  onClose,
  onSaved,
}: {
  /** The Feature to preview; null while the sheet is closed. */
  view: FeatureViewDto | null;
  today: string;
  token: string;
  onClose: () => void;
  onSaved: Saved;
}) => {
  const words = useCopy("catalogue");
  const { billing, language, list } = useNames();
  const [length, setLength] = useState<Length>({ kind: "days", days: 60 });
  const { busy, error, submit } = useSubmit();
  if (view === null) return null;

  const endsOn = lastDayOf(length, today);
  const valid = inRange(today, endsOn);
  const feature = billing.featureName[view.feature];
  const lacking = view.plans.filter((plan) => !plan.included).map((plan) => plan.plan);
  const having = view.plans.filter((plan) => plan.included).map((plan) => plan.plan);
  const longDate = (date: string) => formatLocalDate(date, language);

  return (
    <Sheet open onClose={onClose} labelledBy="preview-start-title">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 id="preview-start-title" style={{ fontSize: 19 }}>
          {fillText(words.previewTitle, { feature })}
        </h2>
        <Note>{words.previewNote}</Note>
        <LengthPicker
          id="preview-ends-on"
          label={words.howLong}
          length={length}
          from={today}
          onChange={setLength}
          hint={valid ? fillText(words.extendHint, { date: longDate(endsOn) }) : words.previewMinHint}
        />
        {valid && (
          <EffectBox
            tone="gives"
            title={words.givesTitle}
            lines={[
              fillText(words.previewGives, { plans: list(lacking), feature, date: longDate(endsOn) }),
              ...(having.length === 0 ? [] : [fillText(words.previewAlready, { plans: list(having) })]),
              words.previewTold,
            ]}
          />
        )}
        {error !== null && <Critical>{error}</Critical>}
        <Button
          busy={busy}
          disabled={!valid}
          onClick={() =>
            void submit(async () => {
              onSaved((await api.adminStartPreview(token, view.feature, endsOn)).features);
              onClose();
            })
          }
        >
          {words.previewStart}
        </Button>
      </div>
    </Sheet>
  );
};

export const PreviewExtendSheet = ({
  view,
  today,
  token,
  onClose,
  onSaved,
}: {
  view: FeatureViewDto | null;
  today: string;
  token: string;
  onClose: () => void;
  onSaved: Saved;
}) => {
  const words = useCopy("catalogue");
  const { billing, language } = useNames();
  const [length, setLength] = useState<Length>({ kind: "days", days: 30 });
  const { busy, error, submit } = useSubmit();
  if (view === null || view.preview === null) return null;

  const current = view.preview.endsOn;
  const endsOn = lastDayOf(length, current);
  const valid = endsOn > current && daysBetween(parseLocalDate(today), parseLocalDate(endsOn)) <= MAX_PREVIEW_DAYS;
  const longDate = (date: string) => formatLocalDate(date, language);

  return (
    <Sheet open onClose={onClose} labelledBy="preview-extend-title">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 id="preview-extend-title" style={{ fontSize: 19 }}>
          {fillText(words.extendPreviewTitle, { feature: billing.featureName[view.feature] })}
        </h2>
        <Card style={{ padding: "12px 14px", display: "flex", gap: 10, alignItems: "center" }}>
          <span className="label" style={{ flex: 1 }}>
            {words.nowUntil}
          </span>
          <strong style={{ fontSize: 14.5 }}>{longDate(current)}</strong>
        </Card>
        <LengthPicker
          id="preview-extend-on"
          label={words.extendBy}
          length={length}
          from={current}
          onChange={setLength}
          hint={valid ? fillText(words.extendHint, { date: longDate(endsOn) }) : words.endsOnProblem}
        />
        {error !== null && <Critical>{error}</Critical>}
        <Button
          busy={busy}
          disabled={!valid}
          onClick={() =>
            void submit(async () => {
              onSaved((await api.adminExtendPreview(token, view.feature, endsOn)).features);
              onClose();
            })
          }
        >
          {fillText(words.extendTo, { date: longDate(endsOn) })}
        </Button>
      </div>
    </Sheet>
  );
};

export const PreviewPlacementSheet = ({
  view,
  today,
  token,
  onClose,
  onSaved,
}: {
  view: FeatureViewDto | null;
  today: string;
  token: string;
  onClose: () => void;
  onSaved: Saved;
}) => {
  const words = useCopy("catalogue");
  const { billing, language, list } = useNames();
  const [keep, setKeep] = useState<readonly PlanName[]>([]);
  const { busy, error, submit } = useSubmit();
  if (view === null || view.preview === null) return null;

  const feature = billing.featureName[view.feature];
  const earliest = addDays(parseLocalDate(today), MIN_PREVIEW_DAYS);
  const endsOn = view.preview.endsOn < earliest ? earliest : view.preview.endsOn;
  const deciding = view.plans.filter((plan) => !plan.included);
  const keeping = deciding.filter((plan) => keep.includes(plan.plan)).map((plan) => plan.plan);
  const losing = deciding.filter((plan) => !keep.includes(plan.plan)).map((plan) => plan.plan);
  const longDate = (date: string) => formatLocalDate(date, language);

  return (
    <Sheet open onClose={onClose} labelledBy="preview-place-title">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 id="preview-place-title" style={{ fontSize: 19 }}>
          {fillText(words.placeTitle, { feature, date: longDate(endsOn) })}
        </h2>
        <span className="label">{words.inEachPlan}</span>
        <Card padded={false}>
          {view.plans.map((plan) => (
            <div key={plan.plan} className="place-row">
              <span className="head">
                <span className={`plan-badge p-${plan.plan}`}>{billing.plan[plan.plan]}</span>
                {plan.included && <span className="hint">{words.alreadyIncluded}</span>}
              </span>
              {!plan.included && (
                <div className="fp-seg" role="group" aria-label={billing.plan[plan.plan]}>
                  {([true, false] as const).map((stays) => (
                    <button
                      key={String(stays)}
                      type="button"
                      aria-pressed={keep.includes(plan.plan) === stays}
                      onClick={() =>
                        setKeep((current) =>
                          stays ? [...current.filter((p) => p !== plan.plan), plan.plan] : current.filter((p) => p !== plan.plan),
                        )
                      }
                    >
                      {stays ? words.stays : words.leaves}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </Card>
        {keeping.length > 0 && (
          <EffectBox tone="gives" title={words.givesTitle} lines={[fillText(words.placeKeep, { plans: list(keeping), feature })]} />
        )}
        {losing.length > 0 && (
          <EffectBox
            tone="takes"
            title={fillText(words.placeLeave, { plans: list(losing), feature, date: longDate(endsOn) })}
            lines={[
              words.placeLeaveTold,
              ...(endsOn === view.preview.endsOn ? [] : [fillText(words.placeMoved, { date: longDate(endsOn) })]),
            ]}
          />
        )}
        <p className="hint" style={{ margin: 0 }}>
          {words.placeFinal}
        </p>
        {error !== null && <Critical>{error}</Critical>}
        <Button
          busy={busy}
          onClick={() =>
            void submit(async () => {
              onSaved((await api.adminPlacePreview(token, view.feature, [...keep])).features);
              onClose();
            })
          }
        >
          {words.placeDo}
        </Button>
      </div>
    </Sheet>
  );
};
