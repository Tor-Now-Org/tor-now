"use client";

import { useState } from "react";
import { FEATURES } from "@tor-now/domain";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { FeatureName, PlanCatalogueDto, PlanViewDto } from "@/lib/api/types.ts";
import { formatLocalDate, formatPrice } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { effectOf, priceMinorOf } from "@/lib/plan-edit.ts";
import { useErrorText } from "@/lib/use-error-text.ts";
import { Button, Card, Critical, Field, Sheet, Warning } from "@/components/ui.tsx";
import { EffectBox } from "@/components/effect-box.tsx";

/**
 * Editing one Plan (ADR 0020, ADR 0021): its price, calendars and Features,
 * and under them what saving will do — worked out by the domain's own rule as
 * the administrator types, so the button always says what really happens.
 */
export const PlanEditSheet = ({
  view,
  previews,
  onClose,
  token,
  onSaved,
}: {
  /** The Plan being edited; null while the sheet is closed. */
  view: PlanViewDto | null;
  previews: PlanCatalogueDto["previews"];
  onClose: () => void;
  token: string;
  onSaved: (catalogue: PlanCatalogueDto) => void;
}) => {
  const words = useCopy("catalogue");
  const billing = useCopy("billing");
  const { language } = useLanguage();
  const errorText = useErrorText();
  const current = view?.current;
  const [price, setPrice] = useState(current === undefined ? "" : String(current.priceMinor / 100));
  const [calendars, setCalendars] = useState(current?.resourceAllowance ?? 1);
  const [features, setFeatures] = useState<readonly FeatureName[]>(current?.features ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (view === null || current === undefined) return null;

  const priceMinor = priceMinorOf(price);
  const effect = effectOf(current, { priceMinor, resourceAllowance: calendars, features });
  const inPreview = new Set(previews.map((preview) => preview.feature));
  const businesses = view.editions.reduce((sum, edition) => sum + edition.businesses, 0);
  const planName = billing.plan[view.plan];
  const money = (minor: number) => formatPrice(minor, language, "—");
  const shortDate = (date: string) => formatLocalDate(date, language, { day: "numeric", month: "numeric" });
  const next = Math.max(current.number, ...view.editions.map((edition) => edition.number)) + 1;
  const blocked = effect.kind === "TAKES" && view.pending !== null;

  const changeLines = (): string[] => {
    if (effect.kind === "INVALID" || effect.kind === "NONE") return [];
    const { change } = effect;
    const names = (list: readonly FeatureName[]) =>
      new Intl.ListFormat(language === "he" ? "he-IL" : "en-GB", { type: "conjunction" }).format(
        list.map((feature) => billing.featureName[feature]),
      );
    return [
      ...(change.price === null
        ? []
        : [
            fillText(change.price.to > change.price.from ? words.linePriceUp : words.linePriceDown, {
              from: money(change.price.from),
              to: money(change.price.to),
            }),
          ]),
      ...(change.allowance === null
        ? []
        : [fillText(words.lineCalendars, { from: String(change.allowance.from), to: String(change.allowance.to) })]),
      ...(change.featuresRemoved.length === 0 ? [] : [fillText(words.lineLost, { list: names(change.featuresRemoved) })]),
      ...(change.featuresAdded.length === 0 ? [] : [fillText(words.lineGained, { list: names(change.featuresAdded) })]),
    ];
  };

  const takesLines = () => [
    ...changeLines(),
    fillText(words.lineNewJoin, { n: String(next) }),
    view.ifTakenToday === null
      ? words.lineNoneMove
      : fillText(words.lineMove, {
          n: String(view.ifTakenToday.businesses),
          plan: planName,
          first: shortDate(view.ifTakenToday.firstMoveOn),
          last: shortDate(view.ifTakenToday.lastMoveOn),
        }),
    ...(view.ifTakenToday === null
      ? []
      : [words.lineTold, fillText(words.lineCancelUntil, { date: shortDate(view.ifTakenToday.firstMoveOn) })]),
  ];

  const givesLines = () => [
    ...changeLines(),
    fillText(words.lineAllNow, { n: String(businesses), plan: planName }),
    ...(effect.kind === "GIVES" && effect.change.allowance !== null ? [words.lineResume] : []),
    words.lineToldApp,
  ];

  const save = async () => {
    if (priceMinor === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.adminEditPlan(token, view.plan, { priceMinor, resourceAllowance: calendars, features: [...features] });
      onSaved(result);
      onClose();
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (feature: FeatureName) =>
    setFeatures((list) => (list.includes(feature) ? list.filter((f) => f !== feature) : [...list, feature]));

  return (
    <Sheet open onClose={onClose} labelledBy="plan-edit-title">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 id="plan-edit-title" style={{ fontSize: 19 }}>
          {fillText(words.editTitle, { plan: planName })}{" "}
          <small className="hint">· {fillText(words.editNow, { n: String(current.number) })}</small>
        </h2>
        <Field
          id="plan-price"
          label={words.pricePerMonth}
          hint={fillText(words.priceNow, { price: money(current.priceMinor) })}
          inputMode="numeric"
          dir="ltr"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
        <div className="stepper">
          <span className="label">{words.calendars}</span>
          <button type="button" className="quiet" aria-label="−" disabled={calendars <= 1} onClick={() => setCalendars((n) => n - 1)}>
            −
          </button>
          <b className="tab" aria-live="polite">
            {calendars}
          </b>
          <button type="button" className="quiet" aria-label="+" onClick={() => setCalendars((n) => n + 1)}>
            +
          </button>
        </div>
        {calendars !== current.resourceAllowance && (
          <span className="hint" style={{ marginTop: -8 }}>
            {fillText(words.calendarsNow, { n: String(current.resourceAllowance) })}
          </span>
        )}
        <span className="label">{words.included}</span>
        <Card padded={false} style={{ overflow: "hidden" }}>
          <div className="check-list">
            {FEATURES.map((feature) => {
              const previewing = inPreview.has(feature);
              const on = features.includes(feature);
              return (
                <label key={feature} className={`check-row${on ? " on" : ""}${previewing ? " off" : ""}`}>
                  <input type="checkbox" checked={on} disabled={previewing} onChange={() => toggle(feature)} />
                  <span>{billing.featureName[feature]}</span>
                  {previewing && <small>{words.inPreviewNote}</small>}
                </label>
              );
            })}
          </div>
        </Card>

        {effect.kind === "TAKES" && (
          <EffectBox tone="takes" title={fillText(words.takesTitle, { n: String(next) })} lines={takesLines()} />
        )}
        {effect.kind === "GIVES" && <EffectBox tone="gives" title={words.givesTitle} lines={givesLines()} />}
        {blocked && <Warning>{fillText(words.pendingBlocks, { plan: planName })}</Warning>}
        {error !== null && <Critical>{error}</Critical>}
        <Button
          busy={busy}
          disabled={effect.kind === "INVALID" || effect.kind === "NONE" || blocked}
          onClick={() => void save()}
        >
          {effect.kind === "TAKES"
            ? view.ifTakenToday === null
              ? fillText(words.publishAlone, { n: String(next) })
              : fillText(words.publish, { n: String(next), count: String(view.ifTakenToday.businesses) })
            : effect.kind === "GIVES"
              ? words.saveNow
              : words.noChange}
        </Button>
      </div>
    </Sheet>
  );
};
