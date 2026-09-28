import { money, type Money } from "../model/money.ts";
import { compareLocalDate, type LocalDate } from "../time/local-date.ts";
import { priceOn, runsOn, type AddonHolding } from "./addon.ts";
import type { DaysOwedEntry } from "./days-owed.ts";
import type { Feature } from "./feature.ts";
import type { Plan, PlanVersion } from "./plan.ts";
import { renewalOn, type Subscription } from "./subscription.ts";

/**
 * What a Business's next payment comes to. Payments are recorded by hand, so
 * the amount is worked out here: the owner sees it before agreeing to anything,
 * and the administrator records it without doing sums.
 */

export type PaymentLine =
  | { readonly kind: "PLAN"; readonly plan: Plan; readonly amount: Money }
  | { readonly kind: "ADDON"; readonly feature: Feature; readonly amount: Money }
  | { readonly kind: "DAYS"; readonly owed: DaysOwedEntry };

export type NextPayment = {
  /** The day it is owed: the renewal, or today when nothing was ever covered. */
  readonly on: LocalDate;
  readonly lines: readonly PaymentLine[];
  readonly total: Money;
};

/**
 * The next payment, line by line: the Plan as it will be on the day — a move
 * scheduled for it included — each Add-on still held then at its price then,
 * and every day still owed.
 */
export const nextPayment = (input: {
  subscription: Pick<Subscription, "trialEndsOn" | "paidThrough" | "scheduledMove">;
  planVersion: PlanVersion;
  scheduledVersion: PlanVersion | null;
  holdings: readonly AddonHolding[];
  daysOwed: readonly DaysOwedEntry[];
  today: LocalDate;
}): NextPayment => {
  const on = renewalOn(input.subscription) ?? input.today;
  const move = input.subscription.scheduledMove;
  const plan =
    move !== null && input.scheduledVersion !== null && compareLocalDate(move.effectiveOn, on) <= 0
      ? input.scheduledVersion
      : input.planVersion;
  const lines: PaymentLine[] = [
    { kind: "PLAN", plan: plan.plan, amount: plan.terms.price },
    ...input.holdings
      .filter((holding) => runsOn(holding, on) && compareLocalDate(holding.paysFrom, on) <= 0)
      .map((holding): PaymentLine => ({ kind: "ADDON", feature: holding.feature, amount: priceOn(holding, on) })),
    ...input.daysOwed.filter((owed) => owed.paymentId === null).map((owed): PaymentLine => ({ kind: "DAYS", owed })),
  ];
  const total = lines.reduce((sum, line) => sum + (line.kind === "DAYS" ? line.owed.amount : line.amount), 0);
  return { on, lines, total: money(total) };
};
