"use client";

import { useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { AddonDto, BillingDto, FeatureName, PlanDto, PlanName, ResourceDto } from "@/lib/api/types.ts";
import { formatLocalDate, formatPrice } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { daysOf } from "@/lib/next-payment.ts";
import { outcomeOf } from "@/lib/plan-outcome.ts";
import { useErrorText } from "@/lib/use-error-text.ts";
import { usePlans } from "@/lib/use-plans.ts";
import { Button, Card, Critical, Warning } from "@/components/ui.tsx";
import { PlanChoice } from "@/components/plan-choice.tsx";
import { likelyToStay, tapped } from "@/components/admin/calendar-choice.ts";

/**
 * The owner choosing their Plan (ADR 0020), where every lock's "See plans"
 * leads. Picking another Plan says what changes and when before anything is
 * pressed; moving to room for fewer calendars asks which stay, right here.
 */
export const PlanChooser = ({
  token,
  businessId,
  billing,
  resources,
  onChanged,
}: {
  token: string;
  businessId: string;
  billing: BillingDto;
  resources: readonly ResourceDto[];
  onChanged: (billing: BillingDto) => void;
}) => {
  const words = useCopy("billing");
  const { language } = useLanguage();
  const errorText = useErrorText();
  const plans = usePlans();
  const current = billing.subscription;
  const [picked, setPicked] = useState<PlanName>(current.plan);
  const [keep, setKeep] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const longDate = (date: string) => formatLocalDate(date, language, { day: "numeric", month: "long" });
  const shortDate = (date: string) => formatLocalDate(date, language, { day: "numeric", month: "numeric" });
  const target = plans.find((plan) => plan.plan === picked);
  const upgradeDaysOwed = billing.moveUpOwed?.find((owed) => owed.plan === picked);
  /** The edition a Catalogue change moves the Plan held onto — its current one. */
  const editionTo = plans.find((plan) => plan.plan === current.plan);
  const outcome = target === undefined ? null : outcomeOf(current, target);
  const onOffer = resources.filter((resource) => resource.active && resource.paused !== true);
  const shrinking = target !== undefined && picked !== current.plan && target.resourceAllowance < onOffer.length;
  const calendars = onOffer.map((resource) => ({ id: resource.id, upcoming: resource.upcomingAppointments ?? 0 }));
  const kept = keep ?? (target === undefined ? [] : likelyToStay(calendars, target.resourceAllowance));
  const pausingNames = resources
    .filter((resource) => resource.pausesOn !== undefined && resource.pausesOn !== null)
    .map((resource) => resource.name);

  const move = async (plan: PlanName, stays?: readonly string[]) => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await api.changeMyPlan(token, businessId, plan, stays));
      setKeep(null);
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {current.scheduledMove !== null && current.scheduledMove.plan === current.plan && (
        // The Catalogue's change to the Plan held (ADR 0020): told, not the
        // owner's to withdraw.
        <div className="pending-move">
          <span>
            {editionTo === undefined || editionTo.priceMinor === current.priceMinor
              ? fillText(words.editionPendingSame, {
                  plan: words.plan[current.plan],
                  date: longDate(current.scheduledMove.effectiveOn),
                })
              : fillText(words.editionPending, {
                  plan: words.plan[current.plan],
                  date: longDate(current.scheduledMove.effectiveOn),
                  to: formatPrice(editionTo.priceMinor, language, "—"),
                  from: formatPrice(current.priceMinor, language, "—"),
                })}
          </span>
        </div>
      )}
      {current.scheduledMove !== null && current.scheduledMove.plan !== current.plan && (
        <div className="pending-move">
          <span>
            {fillText(words.movePending, {
              plan: words.plan[current.scheduledMove.plan],
              date: longDate(current.scheduledMove.effectiveOn),
            })}
            {pausingNames.length > 0 && ` ${fillText(words.willPause, { names: pausingNames.join(", ") })}`}
          </span>
          {/* Choosing the plan already held withdraws the move, and the
              calendars marked to pause with it. */}
          <button type="button" disabled={busy} onClick={() => void move(current.plan)}>
            {words.cancelMove}
          </button>
        </div>
      )}

      <span className="label">{words.plansHeading}</span>
      <PlanChoice
        plans={plans}
        chosen={picked}
        current={current.plan}
        name="my-plan"
        onChoose={(plan) => {
          setPicked(plan);
          setKeep(null);
        }}
      />

      {target !== undefined && outcome !== null && outcome.kind !== "SAME" && (
        <>
          <Difference from={current} to={target} addons={billing.addons ?? []} />
          {shrinking && (
            <>
              <Warning>
                {target.resourceAllowance === 1
                  ? words.keepWhich
                  : fillText(words.keepWhichMany, { n: String(target.resourceAllowance) })}
              </Warning>
              <Card padded={false}>
                {onOffer.map((resource, at) => {
                  const stays = kept.includes(resource.id);
                  return (
                    <label
                      key={resource.id}
                      className={`keep-row${stays ? " chosen" : ""}`}
                      style={at > 0 ? { borderTop: "1px solid var(--line)" } : undefined}
                    >
                      <input
                        type={target.resourceAllowance === 1 ? "radio" : "checkbox"}
                        name="my-calendar-stays"
                        checked={stays}
                        onChange={() => setKeep(tapped(kept, resource.id, target.resourceAllowance))}
                      />
                      <span className="name">
                        {resource.name}
                        {stays && <span className="stays">{words.stays}</span>}
                      </span>
                    </label>
                  );
                })}
              </Card>
            </>
          )}
          {outcome.kind === "UPGRADE_NOW" && upgradeDaysOwed !== undefined && billing.nextPayment !== undefined ? (
            // Moving up again to a Plan left before owes the days already paid for (ADR 0021).
            <p className="note owed" style={{ margin: 0 }}>
              {fillText(words.upgradeAgainHint, {
                plan: words.plan[target.plan],
                owed: formatPrice(upgradeDaysOwed.amountMinor, language, "—"),
                days: String(daysOf(upgradeDaysOwed)),
                from: shortDate(upgradeDaysOwed.from),
                through: shortDate(upgradeDaysOwed.through),
                date: shortDate(billing.nextPayment.on),
                price: formatPrice(target.priceMinor, language, "—"),
              })}
            </p>
          ) : (
            <p className="hint" style={{ margin: 0 }}>
              {outcome.kind === "UPGRADE_NOW"
                ? fillText(words.upgradeHint, { price: formatPrice(target.priceMinor, language, "—") })
                : outcome.kind === "DOWNGRADE_NOW"
                  ? words.downgradeNowHint
                  : fillText(words.downgradeHint, { date: longDate(outcome.on) })}
            </p>
          )}
          <Button
            intent={outcome.kind === "UPGRADE_NOW" ? "primary" : "quiet"}
            busy={busy}
            disabled={shrinking && kept.length === 0}
            onClick={() => void move(target.plan, shrinking ? kept : undefined)}
          >
            {fillText(outcome.kind === "DOWNGRADE_AT" ? words.scheduleTo : words.moveNowTo, {
              plan: words.plan[target.plan],
            })}
          </Button>
        </>
      )}
      {error !== null && <Critical>{error}</Critical>}
    </>
  );
};

/**
 * What moving between two Plans gives and takes, in the owner's words — and
 * which Add-ons end because the new Plan includes them.
 */
const Difference = ({ from, to, addons }: { from: BillingDto["subscription"]; to: PlanDto; addons: readonly AddonDto[] }) => {
  const words = useCopy("billing");
  const { language } = useLanguage();
  const line = (feature: string) => words.featureLine[feature as FeatureName];
  // What is held as an Add-on is not gained; it ends, and stops being paid for.
  const held = addons.filter((addon) => addon.holding !== null);
  const ending = held.filter((addon) => to.features.includes(addon.feature));
  const gained = to.features
    .filter((feature) => !from.features.includes(feature) && !held.some((addon) => addon.feature === feature))
    .map(line);
  const lost = from.features.filter((feature) => !to.features.includes(feature)).map(line);
  const calendars =
    to.resourceAllowance === from.resourceAllowance
      ? null
      : to.resourceAllowance === 1
        ? words.oneCalendar
        : fillText(words.upToCalendars, { n: String(to.resourceAllowance) });
  const growing = to.resourceAllowance > from.resourceAllowance;
  const more = [...(calendars !== null && growing ? [calendars] : []), ...gained];
  return (
    <div className="difference">
      {more.length > 0 && (
        <span><b>{words.youGain}</b> {more.join(", ")}</span>
      )}
      {lost.length > 0 && (
        <span><b>{words.youLose}</b> {lost.join(", ")}</span>
      )}
      {calendars !== null && !growing && (
        <span><b>{words.calendarsLine}</b> {calendars}</span>
      )}
      {ending.map((addon) => (
        <span key={addon.feature}>
          <b>{words.addonEnds}</b>{" "}
          {fillText(words.addonEndsLine, {
            feature: words.featureName[addon.feature],
            plan: words.plan[to.plan],
            price: formatPrice(addon.priceMinor, language, "—"),
          })}
        </span>
      ))}
    </div>
  );
};
