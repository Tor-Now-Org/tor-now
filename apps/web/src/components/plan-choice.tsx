"use client";

import type { PlanDto, PlanName } from "@/lib/api/types.ts";
import { formatPrice } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";

/**
 * The Plans as a choice — the wizard's "Change" sheet and the owner's billing
 * tab draw the same cards, so a Plan reads the same wherever it is chosen.
 */
export const PlanChoice = ({
  plans,
  chosen,
  current,
  name,
  onChoose,
}: {
  plans: readonly PlanDto[];
  chosen: PlanName | null;
  /** The Plan already held, marked as such; none in the wizard. */
  current?: PlanName;
  /** One radio group per page: two choices on one screen must not share it. */
  name: string;
  onChoose: (plan: PlanName) => void;
}) => {
  const words = useCopy("billing");
  const pricing = useCopy("pricing");
  const { language } = useLanguage();
  return (
    <div role="radiogroup" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {plans.map((plan) => {
        const on = chosen === plan.plan;
        return (
          <label key={plan.plan} className={`plan-choice${on ? " on" : ""}`}>
            <input type="radio" name={name} checked={on} onChange={() => onChoose(plan.plan)} />
            <span className="what">
              <strong>
                {words.plan[plan.plan]}
                {current === plan.plan && <span className="yours">{words.yourPlan}</span>}
              </strong>
              <span>{plan.plan === "SOLO" ? pricing.soloHint : pricing.teamHint}</span>
              <span>
                {plan.resourceAllowance === 1
                  ? words.oneCalendar
                  : fillText(words.upToCalendars, { n: String(plan.resourceAllowance) })}
              </span>
            </span>
            <span className="cost tab">
              {formatPrice(plan.priceMinor, language, "—")}
              <small>{pricing.perMonth}</small>
            </span>
          </label>
        );
      })}
    </div>
  );
};
