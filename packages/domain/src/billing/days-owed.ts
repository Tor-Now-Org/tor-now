import type { BusinessId, DaysOwedId, PaymentId } from "../model/ids.ts";
import { money, type Money } from "../model/money.ts";
import { compareLocalDate, daysBetween, type LocalDate } from "../time/local-date.ts";
import type { Feature } from "./feature.ts";
import { isUpgrade, type Plan, type PlanVersion } from "./plan.ts";
import { BILLING_PERIOD_DAYS, type Subscription } from "./subscription.ts";

/**
 * What a Business owes beyond its monthly price: the days before its next
 * payment, when it adds back an Add-on or moves up again to a Plan it left.
 */

export const OWED_KINDS = ["ADDON_DAYS", "PLAN_DAYS"] as const;
export type OwedKind = (typeof OWED_KINDS)[number];

/** Days of something owed, by thirtieths of its monthly price. */
export type DaysOwed = {
  readonly amount: Money;
  readonly from: LocalDate;
  readonly through: LocalDate;
};

/**
 * Days owed before the next payment: an Add-on added back, or a Plan moved up
 * to again. Settled by the payment it is part of.
 */
export type DaysOwedEntry = DaysOwed & {
  readonly id: DaysOwedId;
  readonly businessId: BusinessId;
  readonly kind: OwedKind;
  /** The Add-on's Feature, or the Plan moved up to. */
  readonly subject: Feature | Plan;
  /** The payment that settled it; null while owed. */
  readonly paymentId: PaymentId | null;
};

/** `from` to `through`, both included; nothing when no day is left or it rounds to nothing. */
export const daysOwed = (monthly: Money, from: LocalDate, through: LocalDate): DaysOwed | null => {
  if (compareLocalDate(from, through) > 0) return null;
  const days = daysBetween(from, through) + 1;
  const amount = Math.round((monthly * days) / BILLING_PERIOD_DAYS);
  return amount === 0 ? null : { amount: money(amount), from, through };
};

/**
 * Moving up again to a Plan the Business left: it applies at once, as every
 * upgrade does, but the difference for the days already paid for is owed. The
 * first move up to a Plan is paid from the next renewal, as before.
 */
export const upgradeDaysOwed = (input: {
  from: PlanVersion;
  to: PlanVersion;
  subscription: Pick<Subscription, "paidThrough">;
  /** Every Plan the Business held while paying, or moved up to. */
  plansHeld: readonly Plan[];
  today: LocalDate;
}): DaysOwed | null => {
  const { from, to, today } = input;
  const { paidThrough } = input.subscription;
  if (from.plan === to.plan || !isUpgrade(from.terms, to.terms) || !input.plansHeld.includes(to.plan)) return null;
  if (paidThrough === null || to.terms.price <= from.terms.price) return null;
  return daysOwed(money(to.terms.price - from.terms.price), today, paidThrough);
};
