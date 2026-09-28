import type { FeatureViewDto, PlanName } from "@/lib/api/types.ts";

/**
 * What the Features tab's sheets decide before anything is saved (ADR 0021):
 * which Plans a "which plans" choice changes, and whether a new Add-on price
 * gives or takes. The server applies the same rules; these only let a sheet
 * say what will happen.
 */

export type PlacementChange = { readonly plan: PlanName; readonly include: boolean };

/** The Plans whose answer changes: each is a change of its own, by the Plan editor's rule. */
export const placementChanges = (view: Pick<FeatureViewDto, "plans">, include: readonly PlanName[]): readonly PlacementChange[] =>
  view.plans
    .filter((plan) => plan.included !== include.includes(plan.plan))
    .map((plan) => ({ plan: plan.plan, include: include.includes(plan.plan) }));

/** Every Plan would have it: nobody needs to buy it on its own any more. */
export const everyPlanWould = (view: Pick<FeatureViewDto, "plans">, include: readonly PlanName[]): boolean =>
  view.plans.every((plan) => include.includes(plan.plan));

export type PriceChange = "RISE" | "DROP" | "SAME" | "INVALID";

/** A rise takes (Notice, at each holder's renewal); a drop gives (now). */
export const priceChange = (currentMinor: number, nextMinor: number | null): PriceChange => {
  if (nextMinor === null || nextMinor <= 0) return "INVALID";
  if (nextMinor === currentMinor) return "SAME";
  return nextMinor > currentMinor ? "RISE" : "DROP";
};

type Rise = NonNullable<NonNullable<FeatureViewDto["addon"]>["rise"]>;

/** A rise still on its way to someone: a second one waits for it. */
export const risePending = (rise: Rise | null, today: string): boolean => rise !== null && today < rise.lastOn;

/** A rise nobody pays yet: it can still be withdrawn. */
export const riseCancellable = (rise: Rise | null, today: string): boolean => rise !== null && today < rise.firstOn;
