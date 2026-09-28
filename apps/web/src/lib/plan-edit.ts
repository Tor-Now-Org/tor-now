import { classifyChange, money, planTerms, type ChangeKind, type TermsChange } from "@tor-now/domain";
import type { FeatureName, PlanEditionDto } from "@/lib/api/types.ts";

/**
 * What an edit to a Plan will do, worked out as the administrator types — by
 * the domain's own rule, so the sheet never says one thing and the server does
 * another (ADR 0020).
 */
export type PlanEditInput = { priceMinor: number | null; resourceAllowance: number; features: readonly FeatureName[] };

export type PlanEditEffect =
  | { readonly kind: "INVALID" }
  | { readonly kind: ChangeKind; readonly change: TermsChange };

const termsOf = (edition: PlanEditionDto) =>
  planTerms({ features: edition.features, resourceAllowance: edition.resourceAllowance, price: money(edition.priceMinor) });

export const effectOf = (current: PlanEditionDto, input: PlanEditInput): PlanEditEffect => {
  if (input.priceMinor === null || !Number.isInteger(input.resourceAllowance) || input.resourceAllowance < 1) {
    return { kind: "INVALID" };
  }
  const next = planTerms({ features: input.features, resourceAllowance: input.resourceAllowance, price: money(input.priceMinor) });
  return classifyChange(termsOf(current), next);
};

/** A price typed in whole shekels, as agorot; null for anything else. */
export const priceMinorOf = (typed: string): number | null => {
  const trimmed = typed.trim();
  if (!/^\d{1,5}$/.test(trimmed)) return null;
  return Number(trimmed) * 100;
};
