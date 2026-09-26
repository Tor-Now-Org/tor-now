"use client";

import type { FeatureName, PlanDto } from "@/lib/api/types.ts";
import { cheapestRoomierThan, cheapestWith } from "@/lib/entitlement.ts";
import { formatPrice } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { usePlans } from "@/lib/use-plans.ts";
import { Button } from "@/components/ui.tsx";

const LockIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" stroke="currentColor" strokeWidth="2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/**
 * What stands where a Feature the plan lacks would start (ADR 0019): what is
 * missing, the Plan that includes it and what it costs, and one way on. It
 * takes the place of the control it locks — never sits beside it — so there is
 * never a button that can only fail.
 */
export const Locked = ({
  title,
  body,
  action,
  onAction,
}: {
  title: string;
  body: string | null;
  /**
   * The one way on — to the plans. Left out for someone who cannot change the
   * plan (a manager has no billing tab), who is told what is missing and no more.
   */
  action?: string;
  onAction?: () => void;
}) => (
  <div className="locked" role="group" aria-label={title}>
    <div className="locked-head">
      <span className="locked-icon"><LockIcon /></span>
      <span className="locked-title">
        <strong>{title}</strong>
        {body !== null && <span>{body}</span>}
      </span>
    </div>
    {action !== undefined && onAction !== undefined && (
      <Button intent="quiet" onClick={onAction}>{action}</Button>
    )}
  </div>
);

/** The small padlock a locked chip carries in front of its word. */
export const SmallLock = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ marginInlineEnd: 5 }}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" stroke="currentColor" strokeWidth="2.2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

type LockText = { readonly title: string; readonly body: string | null };

/**
 * The words for each lock, naming whichever Plan the Catalogue puts the thing
 * in today — so moving a Feature between Plans moves its locks with it.
 */
export const useLockText = () => {
  const copy = useCopy("billing");
  const { language } = useLanguage();
  const plans = usePlans();

  const named = (plan: PlanDto | null, title: string, body: string): LockText =>
    plan === null
      ? { title: copy.notIncluded, body: null }
      : {
          title: fillText(title, { plan: copy.plan[plan.plan] }),
          body: fillText(body, {
            plan: copy.plan[plan.plan],
            n: String(plan.resourceAllowance),
            price: formatPrice(plan.priceMinor, language, "—"),
          }),
        };

  return {
    calendar: (allowance: number): LockText =>
      named(cheapestRoomierThan(plans, allowance), copy.lockCalendarTitle, copy.lockCalendarBody),
    feature: (feature: Extract<FeatureName, "TEAM_ROLES" | "CUSTOMER_HISTORY">): LockText =>
      feature === "TEAM_ROLES"
        ? named(cheapestWith(plans, feature), copy.lockTeamTitle, copy.lockTeamBody)
        : named(cheapestWith(plans, feature), copy.lockHistoryTitle, copy.lockHistoryBody),
  };
};
