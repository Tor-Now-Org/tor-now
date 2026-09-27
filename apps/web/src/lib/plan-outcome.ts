import {
  isFeature,
  isUpgrade,
  money,
  parseLocalDate,
  planTerms,
  renewalOn,
  type LocalDate,
  type PlanTerms,
} from "@tor-now/domain";
import type { PlanDto, SubscriptionDto } from "@/lib/api/types.ts";

/**
 * What moving a Business to another Plan will do, worked out before the
 * button is pressed — by the same domain rules the server applies (ADR 0020),
 * so the sentence under the button cannot disagree with what happens.
 */
export type PlanChangeOutcome =
  | { readonly kind: "SAME" }
  | { readonly kind: "UPGRADE_NOW" }
  | { readonly kind: "DOWNGRADE_NOW" }
  | { readonly kind: "DOWNGRADE_AT"; readonly on: LocalDate };

const termsOf = (plan: {
  features: readonly string[];
  resourceAllowance: number;
  priceMinor: number;
}): PlanTerms =>
  planTerms({
    features: plan.features.filter(isFeature),
    resourceAllowance: plan.resourceAllowance,
    price: money(plan.priceMinor),
  });

export const outcomeOf = (current: SubscriptionDto, target: PlanDto): PlanChangeOutcome => {
  if (current.plan === target.plan) return { kind: "SAME" };
  if (isUpgrade(termsOf(current), termsOf(target))) return { kind: "UPGRADE_NOW" };
  const renewal =
    current.paidThrough === null
      ? null
      : renewalOn({ paidThrough: parseLocalDate(current.paidThrough), trialEndsOn: null });
  return renewal === null ? { kind: "DOWNGRADE_NOW" } : { kind: "DOWNGRADE_AT", on: renewal };
};
