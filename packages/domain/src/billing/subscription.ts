import type { BusinessId, PaymentId, SubscriptionId, UserId } from "../model/ids.ts";
import type { Money } from "../model/money.ts";
import { addDays, compareLocalDate, type LocalDate } from "../time/local-date.ts";
import type { Instant } from "../time/instant.ts";
import { validationFailed } from "../shared/errors.ts";

/**
 * Billing concerns the platform operator and the Business owner — never the
 * customer, who pays the Business directly and outside the system entirely.
 */

/**
 * The interval after a Subscription falls due during which the Business
 * continues to operate unaffected. Fourteen days, per docs/billing/CONTEXT.md;
 * deactivation follows only once it elapses.
 */
export const GRACE_PERIOD_DAYS = 14;

export const BILLING_PERIODS = ["MONTHLY", "YEARLY"] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

export const PLANS = ["FREE", "STANDARD"] as const;
export type Plan = (typeof PLANS)[number];

/**
 * A Business's standing agreement to pay the platform. Every Business has one,
 * including those on a free plan.
 */
export type Subscription = {
  readonly id: SubscriptionId;
  readonly businessId: BusinessId;
  readonly plan: Plan;
  readonly amount: Money;
  readonly billingPeriod: BillingPeriod;
  /** The date the Business is paid up to, inclusive. */
  readonly paidThrough: LocalDate;
};

/**
 * A recorded receipt of money from a Business to the platform, entered by an
 * administrator. The platform moves no money itself.
 */
export type Payment = {
  readonly id: PaymentId;
  readonly subscriptionId: SubscriptionId;
  readonly businessId: BusinessId;
  readonly amount: Money;
  readonly paidOn: LocalDate;
  /** The administrator who entered it; every Payment has a named author. */
  readonly recordedBy: UserId;
  readonly note: string | null;
  readonly recordedAt: Instant;
};

export const SUBSCRIPTION_STATES = ["CURRENT", "IN_GRACE", "LAPSED"] as const;
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

/** The last date on which a lapsed Subscription still operates unaffected. */
export const graceEndsOn = (subscription: Pick<Subscription, "paidThrough">): LocalDate =>
  addDays(subscription.paidThrough, GRACE_PERIOD_DAYS);

/**
 * A free plan is never overdue — it has nothing to pay — so it is always
 * current regardless of the date it is nominally paid through.
 */
export const subscriptionStateOn = (
  subscription: Pick<Subscription, "paidThrough" | "plan">,
  today: LocalDate,
): SubscriptionState => {
  if (subscription.plan === "FREE") return "CURRENT";
  if (compareLocalDate(today, subscription.paidThrough) <= 0) return "CURRENT";
  if (compareLocalDate(today, graceEndsOn(subscription)) <= 0) return "IN_GRACE";
  return "LAPSED";
};

/**
 * The single channel between Billing and Scheduling (CONTEXT-MAP.md): Billing
 * deactivates a Business whose Subscription lapsed beyond its Grace Period, and
 * knows nothing of Appointments, Services or Resources.
 */
export const shouldDeactivate = (
  subscription: Pick<Subscription, "paidThrough" | "plan">,
  today: LocalDate,
): boolean => subscriptionStateOn(subscription, today) === "LAPSED";

/**
 * Recording a Payment extends the paid-through date by one billing period.
 * Extension runs from whichever is later — the current paid-through date or the
 * payment date — so a Business that pays late is not credited for the lapse,
 * and one that pays early keeps the time it already bought.
 */
export const applyPayment = (
  subscription: Subscription,
  paidOn: LocalDate,
): Subscription => {
  const from =
    compareLocalDate(paidOn, subscription.paidThrough) > 0
      ? paidOn
      : subscription.paidThrough;
  return { ...subscription, paidThrough: advanceOnePeriod(from, subscription.billingPeriod) };
};

const DAYS_IN_PERIOD: Readonly<Record<BillingPeriod, number>> = Object.freeze({
  MONTHLY: 30,
  YEARLY: 365,
});

const advanceOnePeriod = (from: LocalDate, period: BillingPeriod): LocalDate => {
  const days = DAYS_IN_PERIOD[period];
  /* istanbul ignore next -- BillingPeriod is closed over the map above */
  if (days === undefined) {
    throw validationFailed(`Unknown billing period "${period}"`);
  }
  return addDays(from, days);
};
