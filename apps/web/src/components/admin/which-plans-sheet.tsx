"use client";

import { useState } from "react";
import { api } from "@/lib/api/client.ts";
import type { FeatureViewDto, PlanName, PlanViewDto } from "@/lib/api/types.ts";
import { everyPlanWould, placementChanges, type PlacementChange } from "@/lib/addon-catalogue.ts";
import { formatLocalDate } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useSubmit } from "@/lib/use-submit.ts";
import { Button, Critical, Sheet, Spinner, Warning } from "@/components/ui.tsx";
import { EffectBox } from "@/components/effect-box.tsx";
import { usePlanCatalogue } from "./use-plan-catalogue.ts";

/**
 * Which Plans include a Feature, from its own card (ADR 0021): one row per
 * Plan, included or not — the same control as a Preview's end — and under it
 * what each change does, by exactly the rule a Plan's editor follows. Including
 * it gives, and applies now; leaving it out takes, and is a new edition with
 * thirty days' Notice.
 */
export const WhichPlansSheet = ({
  view,
  token,
  onClose,
  onSaved,
}: {
  view: FeatureViewDto | null;
  token: string;
  onClose: () => void;
  onSaved: (features: FeatureViewDto[]) => void;
}) => {
  const words = useCopy("catalogue");
  const billing = useCopy("billing");
  const [include, setInclude] = useState<readonly PlanName[]>(
    view?.plans.filter((plan) => plan.included).map((plan) => plan.plan) ?? [],
  );
  const { catalogue, error: loadError, viewOf, businessesOn } = usePlanCatalogue(token, view !== null);
  const { busy, error, submit } = useSubmit();
  if (view === null) return null;

  const feature = billing.featureName[view.feature];
  const changes = placementChanges(view, include);
  const takes = changes.filter((change) => !change.include);
  // One change that takes value waits at a time, as in the Plan's own editor.
  const waiting = takes.filter((change) => (viewOf(change.plan)?.pending ?? null) !== null);
  const blocked = waiting.length > 0;
  const onlyTake = takes.length === 1 && changes.length === 1 ? takes[0] : undefined;
  const onlyTakeView = onlyTake === undefined ? null : viewOf(onlyTake.plan);

  const choose = (plan: PlanName, included: boolean) =>
    setInclude((current) => (included ? [...current.filter((p) => p !== plan), plan] : current.filter((p) => p !== plan)));

  const label = (): string => {
    if (changes.length === 0) return words.noChange;
    if (takes.length === 0) return words.saveNow;
    if (onlyTakeView === null) return words.whichApply;
    const next = nextEditionOf(onlyTakeView);
    return onlyTakeView.ifTakenToday === null
      ? fillText(words.publishAlone, { n: String(next) })
      : fillText(words.publish, { n: String(next), count: String(onlyTakeView.ifTakenToday.businesses) });
  };

  return (
    <Sheet open onClose={onClose} labelledBy="which-plans-title">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 id="which-plans-title" style={{ fontSize: 19 }}>
          {fillText(words.whichTitle, { feature })}
        </h2>
        {catalogue === null ? (
          loadError === null ? <Spinner /> : <Critical>{loadError}</Critical>
        ) : (
          <>
            <span className="label">{words.inEachPlan}</span>
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {view.plans.map((plan) => {
                const on = include.includes(plan.plan);
                const changed = on !== plan.included;
                return (
                  <div key={plan.plan} className={`place-row${changed ? " changed" : ""}`}>
                    <span className="head">
                      <span className={`plan-badge p-${plan.plan}`}>{billing.plan[plan.plan]}</span>
                      <span className="hint">
                        {fillText(words.businessesN, { n: String(businessesOn(plan.plan)) })}
                        {changed && ` · ${plan.included ? words.whichNowIncluded : words.whichNowNotIncluded}`}
                      </span>
                    </span>
                    <div className="fp-seg" role="group" aria-label={billing.plan[plan.plan]}>
                      {([true, false] as const).map((included) => (
                        <button key={String(included)} type="button" aria-pressed={on === included} onClick={() => choose(plan.plan, included)}>
                          {included ? words.whichIncluded : words.whichNotIncluded}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            {changes.map((change) => (
              <ChangeEffect
                key={change.plan}
                change={change}
                view={view}
                plan={viewOf(change.plan)}
                businesses={businessesOn(change.plan)}
                allWould={everyPlanWould(view, include)}
              />
            ))}
            {waiting.map((change) => (
              <Warning key={change.plan}>{fillText(words.pendingBlocks, { plan: billing.plan[change.plan] })}</Warning>
            ))}
            <p className="hint" style={{ margin: 0 }}>
              {takes.length > 0 && view.addon === null ? `${words.whichSame} ${words.whichSellHint}` : words.whichSame}
            </p>
          </>
        )}
        {error !== null && <Critical>{error}</Critical>}
        <Button
          busy={busy}
          disabled={catalogue === null || changes.length === 0 || blocked}
          onClick={() =>
            void submit(async () => {
              onSaved((await api.adminFeaturePlans(token, view.feature, [...include])).features);
              onClose();
            })
          }
        >
          {label()}
        </Button>
      </div>
    </Sheet>
  );
};

/** The number the next edition of a Plan takes. */
const nextEditionOf = (plan: PlanViewDto): number =>
  Math.max(plan.current.number, ...plan.editions.map((edition) => edition.number)) + 1;

/** What one Plan's change does, in the words the Plan editor uses. */
const ChangeEffect = ({
  change,
  view,
  plan,
  businesses,
  allWould,
}: {
  change: PlacementChange;
  view: FeatureViewDto;
  plan: PlanViewDto | null;
  businesses: number;
  allWould: boolean;
}) => {
  const words = useCopy("catalogue");
  const billing = useCopy("billing");
  const { language } = useLanguage();
  const shortDate = (date: string) => formatLocalDate(date, language, { day: "numeric", month: "numeric" });
  const planName = billing.plan[change.plan];
  const feature = billing.featureName[view.feature];
  const holders = view.counts.ADDON ?? 0;

  if (change.include) {
    return (
      <EffectBox
        tone="gives"
        title={fillText(words.whichGivesTitle, { plan: planName })}
        lines={[
          fillText(words.lineGained, { list: feature }),
          fillText(words.lineAllNow, { n: String(businesses), plan: planName }),
          ...(allWould && holders > 0 ? [fillText(words.lineAddonEnds, { n: String(holders) })] : []),
          ...(allWould && view.addon !== null && view.addon !== undefined ? [words.lineSaleStops] : []),
          words.lineToldApp,
        ]}
      />
    );
  }

  const next = plan === null ? 2 : nextEditionOf(plan);
  const moving = plan?.ifTakenToday ?? null;
  return (
    <EffectBox
      tone="takes"
      title={fillText(words.whichTakesTitle, { plan: planName, n: String(next) })}
      lines={[
        fillText(words.lineLost, { list: feature }),
        fillText(words.lineNewJoin, { n: String(next) }),
        moving === null
          ? words.lineNoneMove
          : fillText(words.lineMove, {
              n: String(moving.businesses),
              plan: planName,
              first: shortDate(moving.firstMoveOn),
              last: shortDate(moving.lastMoveOn),
            }),
        ...(moving === null ? [] : [words.lineTold, fillText(words.lineCancelUntil, { date: shortDate(moving.firstMoveOn) })]),
      ]}
    />
  );
};
