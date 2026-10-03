import type { BusinessId, PaymentId, PlanVersionId, SubscriptionId, UserId } from "../model/ids.ts";
import type { Money } from "../model/money.ts";
import { addDays, compareLocalDate, type LocalDate } from "../time/local-date.ts";
import { instant, type Instant } from "../time/instant.ts";
import { instantToZoned, type TimeZone, type ZonedDateTime } from "../time/zone.ts";
import { isUpgrade, type PlanVersion } from "./plan.ts";

/**
 * Billing concerns the platform operator and the Business owner — never the
 * customer, who pays the Business directly and outside the system entirely.
 */

/**
 * The interval after a paid Subscription falls due during which the Business
 * continues to operate unaffected. Fourteen days, per docs/billing/CONTEXT.md;
 * a Trial never has one.
 */
export const GRACE_PERIOD_DAYS = 14;

/** The first thirty days of a Subscription, given once per owner. */
export const TRIAL_DAYS = 30;

/** Billing is monthly only (ADR 0020); a month is thirty days. */
export const BILLING_PERIOD_DAYS = 30;

/** How long a change that takes value away waits before reaching anyone. */
export const NOTICE_DAYS = 30;

/** A move to another Plan Version, decided and waiting for its date. */
export type ScheduledMove = {
  readonly planVersionId: PlanVersionId;
  readonly effectiveOn: LocalDate;
};

/**
 * A Business's standing agreement to pay the platform. Every Business has one
 * from the moment it opens.
 */
export type Subscription = {
  readonly id: SubscriptionId;
  readonly businessId: BusinessId;
  readonly planVersionId: PlanVersionId;
  /** The Trial's last day, inclusive; null when the owner had theirs already. */
  readonly trialEndsOn: LocalDate | null;
  /** The date paid up to, inclusive; null until the first Payment. */
  readonly paidThrough: LocalDate | null;
  readonly scheduledMove: ScheduledMove | null;
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

export const SUBSCRIPTION_STATES = ["TRIAL", "CURRENT", "IN_GRACE", "LAPSED"] as const;
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

type Standing = Pick<Subscription, "paidThrough" | "trialEndsOn">;

/** The Trial a newly opened Business gets — none if its owner has had one. */
export const trialEndsOn = (
  openedOn: LocalDate,
  owner: { ownerHadTrial: boolean },
): LocalDate | null => (owner.ownerHadTrial ? null : addDays(openedOn, TRIAL_DAYS - 1));

/** The last date on which a lapsed paid Subscription still operates unaffected. */
export const graceEndsOn = (subscription: { paidThrough: LocalDate }): LocalDate =>
  addDays(subscription.paidThrough, GRACE_PERIOD_DAYS);

/**
 * A Subscription never paid for is in its Trial or lapsed — there is no grace
 * without a first Payment. Once paid, the paid-through date and the Grace
 * Period decide, and the Trial no longer matters.
 */
export const subscriptionStateOn = (subscription: Standing, today: LocalDate): SubscriptionState => {
  const { paidThrough, trialEndsOn: trialEnd } = subscription;
  if (paidThrough === null) {
    return trialEnd !== null && compareLocalDate(today, trialEnd) <= 0 ? "TRIAL" : "LAPSED";
  }
  if (compareLocalDate(today, paidThrough) <= 0) return "CURRENT";
  if (compareLocalDate(today, graceEndsOn({ paidThrough })) <= 0) return "IN_GRACE";
  return "LAPSED";
};

/**
 * The only channel between Billing and Scheduling besides the Entitlement
 * (CONTEXT-MAP.md): a Business whose Subscription lapsed is deactivated.
 */
export const shouldDeactivate = (subscription: Standing, today: LocalDate): boolean =>
  subscriptionStateOn(subscription, today) === "LAPSED";

/**
 * The hour, UTC, of the nightly run that deactivates — the '0 4 * * *' job in
 * supabase/migrations/20260901001300_scheduled_work.sql. Change both together.
 */
export const DEACTIVATION_RUN_UTC_HOUR = 4;

/** When the next nightly run turns a lapsed Business off, on the Business's own clock. */
export const nextDeactivationRun = (now: Instant, zone: TimeZone): ZonedDateTime => {
  const at = new Date(now);
  const run = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), DEACTIVATION_RUN_UTC_HOUR);
  return instantToZoned(instant(run > now ? run : run + 24 * 60 * 60 * 1000), zone);
};

/** The date the next period is owed from; null when nothing was ever covered. */
export const renewalOn = (subscription: Standing): LocalDate | null => {
  const coveredThrough = subscription.paidThrough ?? subscription.trialEndsOn;
  return coveredThrough === null ? null : addDays(coveredThrough, 1);
};

/**
 * Recording a Payment extends cover by one period, from whichever is later:
 * what is already covered — paid time or the rest of the Trial — or the
 * payment date. Paying late is not credited for the lapse; paying early keeps
 * the time already bought.
 */
export const paidThroughAfter = (subscription: Standing, paidOn: LocalDate): LocalDate => {
  const covered = subscription.paidThrough ?? subscription.trialEndsOn;
  const from = covered !== null && compareLocalDate(covered, paidOn) > 0 ? covered : paidOn;
  return addDays(from, BILLING_PERIOD_DAYS);
};

export const applyPayment = (subscription: Subscription, paidOn: LocalDate): Subscription => ({
  ...subscription,
  paidThrough: paidThroughAfter(subscription, paidOn),
});

/**
 * A move the Catalogue forces takes effect at the first renewal at least
 * NOTICE_DAYS after the Notice — never mid-period, never without warning.
 */
export const moveTakesEffectOn = (subscription: Standing, noticedOn: LocalDate): LocalDate => {
  const earliest = addDays(noticedOn, NOTICE_DAYS);
  const first = renewalOn(subscription);
  if (first === null) return earliest;
  let renewal = first;
  while (compareLocalDate(renewal, earliest) < 0) renewal = addDays(renewal, BILLING_PERIOD_DAYS);
  return renewal;
};

export const scheduleMove = (
  subscription: Subscription,
  planVersionId: PlanVersionId,
  noticedOn: LocalDate,
): Subscription => ({
  ...subscription,
  scheduledMove: { planVersionId, effectiveOn: moveTakesEffectOn(subscription, noticedOn) },
});

/**
 * The owner choosing a Plan. An upgrade applies at once; a downgrade waits for
 * the renewal so the owner keeps what was paid for, unless nothing was.
 *
 * Choosing the Plan already held withdraws a pending move of the owner's own
 * and nothing else — even when a newer edition of that Plan exists. Moving a
 * Business onto a newer edition is the Catalogue's to do, behind a Notice
 * (ADR 0020), never a side effect of a tap — so a move the Catalogue
 * scheduled, onto a new edition of the Plan held, is not the owner's to
 * withdraw, and stands.
 */
export const changePlan = (
  subscription: Subscription,
  versions: { from: PlanVersion; to: PlanVersion; scheduled?: PlanVersion | null },
): Subscription => {
  const { from, to } = versions;
  if (from.plan === to.plan) {
    const catalogueMove = versions.scheduled !== undefined && versions.scheduled !== null && versions.scheduled.plan === from.plan;
    return catalogueMove ? subscription : { ...subscription, scheduledMove: null };
  }
  const renewal = subscription.paidThrough === null ? null : renewalOn(subscription);
  if (isUpgrade(from.terms, to.terms) || renewal === null) {
    return { ...subscription, planVersionId: to.id, scheduledMove: null };
  }
  return { ...subscription, scheduledMove: { planVersionId: to.id, effectiveOn: renewal } };
};

/** Carries out a scheduled move once its date has come. */
export const applyDueMove = (subscription: Subscription, today: LocalDate): Subscription => {
  const move = subscription.scheduledMove;
  if (move === null || compareLocalDate(today, move.effectiveOn) < 0) return subscription;
  return { ...subscription, planVersionId: move.planVersionId, scheduledMove: null };
};
