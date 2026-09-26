import { addDays, daysBetween, type LocalDate } from "../time/local-date.ts";
import { graceEndsOn, subscriptionStateOn, type Subscription } from "./subscription.ts";

/**
 * Where a Business stands with the platform, as the administrator sorts and
 * filters by it: exactly one status at a time, and any number of flags beside
 * it asking for a look. One function, so the table, its filters, its counts and
 * the statistics can never disagree about which Business is which.
 */
export const BILLING_STATUSES = ["TRIAL", "PAID", "IN_GRACE", "LAPSED", "DEACTIVATED"] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];

export const BILLING_FLAGS = ["TRIAL_ENDING", "MOVE_PENDING", "OVER_ALLOWANCE"] as const;
export type BillingFlag = (typeof BILLING_FLAGS)[number];

/** How close a Trial's end has to be before it asks for attention. */
export const TRIAL_ENDING_DAYS = 7;

export type Standing = {
  readonly status: BillingStatus;
  /**
   * The date the status turns on: a Trial's last day, the paid-through date,
   * the grace period's last day, or the first day a lapsed Subscription no
   * longer covered. Null for one that never covered a day.
   */
  readonly nextDate: LocalDate | null;
  readonly flags: readonly BillingFlag[];
};

export type StandingInput = {
  readonly subscription: Pick<Subscription, "trialEndsOn" | "paidThrough" | "scheduledMove">;
  readonly businessActive: boolean;
  readonly resourcesOnOffer: number;
  readonly resourceAllowance: number;
  readonly today: LocalDate;
};

const statusAndDate = (input: StandingInput): Pick<Standing, "status" | "nextDate"> => {
  const { trialEndsOn, paidThrough } = input.subscription;
  const state = subscriptionStateOn(input.subscription, input.today);
  if (state === "LAPSED") {
    const lastCovered = paidThrough === null ? trialEndsOn : graceEndsOn({ paidThrough });
    return { status: "LAPSED", nextDate: lastCovered === null ? null : addDays(lastCovered, 1) };
  }
  // Switched off while it owes nothing: an administrator's decision, not a lapse.
  if (!input.businessActive) return { status: "DEACTIVATED", nextDate: paidThrough ?? trialEndsOn };
  if (state === "TRIAL") return { status: "TRIAL", nextDate: trialEndsOn };
  if (state === "IN_GRACE" && paidThrough !== null) {
    return { status: "IN_GRACE", nextDate: graceEndsOn({ paidThrough }) };
  }
  return { status: "PAID", nextDate: paidThrough };
};

export const standingOf = (input: StandingInput): Standing => {
  const { status, nextDate } = statusAndDate(input);
  const flags: BillingFlag[] = [
    ...(status === "TRIAL" && nextDate !== null && daysBetween(input.today, nextDate) <= TRIAL_ENDING_DAYS
      ? (["TRIAL_ENDING"] as const)
      : []),
    ...(input.subscription.scheduledMove === null ? [] : (["MOVE_PENDING"] as const)),
    ...(input.resourcesOnOffer > input.resourceAllowance ? (["OVER_ALLOWANCE"] as const) : []),
  ];
  return { status, nextDate, flags };
};
