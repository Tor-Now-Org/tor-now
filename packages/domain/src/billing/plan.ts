import type { PlanVersionId } from "../model/ids.ts";
import type { Money } from "../model/money.ts";
import { validationFailed } from "../shared/errors.ts";
import { FEATURES, parseFeature, type Feature } from "./feature.ts";

/**
 * A named offering a Subscription is on. Every Plan is paid; the Trial takes
 * the place of a free one.
 */
export const PLANS = ["SOLO", "TEAM"] as const;
export type Plan = (typeof PLANS)[number];

/** What a Plan Version gives and costs. */
export type PlanTerms = {
  /** Each Feature once, in the order FEATURES lists them. */
  readonly features: readonly Feature[];
  /** How many Resources a Business may keep on offer. */
  readonly resourceAllowance: number;
  /** Per billing period. */
  readonly price: Money;
};

/**
 * One fixed edition of a Plan's terms (ADR 0020). A Subscription stays on the
 * edition it joined until it is moved; only additions are ever carried onto an
 * edition after the fact.
 */
export type PlanVersion = {
  readonly id: PlanVersionId;
  readonly plan: Plan;
  /** 1, 2, 3… within its Plan, so an administrator can say "Solo v2". */
  readonly number: number;
  readonly terms: PlanTerms;
};

const inCatalogueOrder = (features: readonly Feature[]): readonly Feature[] => {
  const held = new Set(features.map(parseFeature));
  return FEATURES.filter((feature) => held.has(feature));
};

export const planTerms = (input: {
  features: readonly Feature[];
  resourceAllowance: number;
  price: Money;
}): PlanTerms => {
  if (!Number.isInteger(input.resourceAllowance) || input.resourceAllowance < 1) {
    throw validationFailed("A plan must allow at least one calendar", {
      resourceAllowance: input.resourceAllowance,
    });
  }
  return {
    features: inCatalogueOrder(input.features),
    resourceAllowance: input.resourceAllowance,
    price: input.price,
  };
};

/**
 * Everything that differs between two sets of terms, from the point of view of
 * the Business holding the first. What the Notice says is read from this.
 */
export type TermsChange = {
  readonly featuresAdded: readonly Feature[];
  readonly featuresRemoved: readonly Feature[];
  readonly allowance: { readonly from: number; readonly to: number } | null;
  readonly price: { readonly from: Money; readonly to: Money } | null;
};

export const compareTerms = (from: PlanTerms, to: PlanTerms): TermsChange => ({
  featuresAdded: to.features.filter((feature) => !from.features.includes(feature)),
  featuresRemoved: from.features.filter((feature) => !to.features.includes(feature)),
  allowance:
    from.resourceAllowance === to.resourceAllowance
      ? null
      : { from: from.resourceAllowance, to: to.resourceAllowance },
  price: from.price === to.price ? null : { from: from.price, to: to.price },
});

export const givesValue = (change: TermsChange): boolean =>
  change.featuresAdded.length > 0 ||
  (change.allowance !== null && change.allowance.to > change.allowance.from) ||
  (change.price !== null && change.price.to < change.price.from);

/**
 * Whether the change needs thirty days' Notice before it reaches an existing
 * Subscription. A change that both gives and takes counts as taking: the part
 * that takes is what the owner needs warning of.
 */
export const takesValueAway = (change: TermsChange): boolean =>
  change.featuresRemoved.length > 0 ||
  (change.allowance !== null && change.allowance.to < change.allowance.from) ||
  (change.price !== null && change.price.to > change.price.from);

/**
 * Whether moving between Plans puts more in the owner's hands, price aside.
 * An owner choosing Team over Solo is upgrading although it costs more; the
 * price is what they agreed to by choosing, not something taken from them.
 */
export const isUpgrade = (from: PlanTerms, to: PlanTerms): boolean => {
  const change = compareTerms(from, to);
  const shrinks =
    change.featuresRemoved.length > 0 ||
    (change.allowance !== null && change.allowance.to < change.allowance.from);
  const grows =
    change.featuresAdded.length > 0 ||
    (change.allowance !== null && change.allowance.to > change.allowance.from);
  return grows && !shrinks;
};

/**
 * Carries only what a change gives onto an older edition of the same Plan:
 * additions apply to everyone on the Plan at once (ADR 0020), while whatever it
 * takes waits for the Subscription's own move.
 */
export const extendTerms = (older: PlanTerms, change: TermsChange): PlanTerms =>
  planTerms({
    features: [...older.features, ...change.featuresAdded],
    resourceAllowance:
      change.allowance === null
        ? older.resourceAllowance
        : Math.max(older.resourceAllowance, change.allowance.to),
    price:
      change.price !== null && change.price.to < older.price ? change.price.to : older.price,
  });

/**
 * The cheapest current edition with room for this many calendars, for an owner
 * who opened a Business without naming a Plan. Null when none has room.
 */
export const planThatFits = (
  current: readonly PlanVersion[],
  calendars: number,
): PlanVersion | null =>
  [...current]
    .filter((version) => version.terms.resourceAllowance >= calendars)
    .sort((a, b) => a.terms.price - b.terms.price)[0] ?? null;
