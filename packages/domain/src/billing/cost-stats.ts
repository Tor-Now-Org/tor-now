import type { BusinessId } from "../model/ids.ts";
import { money, type Money } from "../model/money.ts";
import { MICRO_SHEKELS_PER_AGORA, microShekels, type CostSource, type MicroShekels } from "./cost.ts";
import { PLANS, type Plan } from "./plan.ts";
import type { BillingStatus } from "./standing.ts";
import { NO_USAGE_COST, type UsageCost } from "./usage-cost.ts";

/**
 * What each Plan costs the platform: the four figures an administrator sets a
 * price from — the average cost of a paying Business, the margin on what they
 * pay, what the cost is made of, and the most expensive one. A Business in its
 * Trial has no price to measure against, so it is counted apart.
 */

/** One Business in the span: what it is on, where it stands, what it pays and what it cost. */
export type CostedBusiness = {
  readonly businessId: BusinessId;
  readonly name: string;
  readonly plan: Plan;
  readonly status: BillingStatus;
  /** Its Plan's price and its running Add-ons, per month. */
  readonly monthlyPrice: Money;
  readonly usage: UsageCost;
};

/** Paid time — running or in grace — is what pays; the rest is counted apart. */
export const isPaying = (status: BillingStatus): boolean => status === "PAID" || status === "IN_GRACE";

export type PlanCostStats = {
  readonly plan: Plan;
  readonly paying: number;
  /** What they pay in a month, together. */
  readonly revenue: Money;
  readonly cost: MicroShekels;
  readonly averageCost: MicroShekels | null;
  /** (What they pay − what they cost) ÷ what they pay. Null with nobody paying. */
  readonly margin: number | null;
  /** The same, once each carries its share of the Platform Cost. */
  readonly marginAfterShare: number | null;
  readonly bySource: Readonly<Partial<Record<CostSource, MicroShekels>>>;
  readonly priciest: { readonly businessId: BusinessId; readonly name: string; readonly cost: MicroShekels } | null;
};

export type GroupCost = {
  readonly count: number;
  readonly cost: MicroShekels;
  readonly averageCost: MicroShekels | null;
};

export type CostStats = {
  readonly plans: readonly PlanCostStats[];
  readonly paying: number;
  readonly trials: GroupCost;
  /** Lapsed or switched off: not paying, and still able to send a reminder. */
  readonly notPaying: GroupCost;
};

const inMicro = (amount: Money): number => amount * MICRO_SHEKELS_PER_AGORA;

const marginOf = (revenue: number, cost: number): number | null =>
  revenue === 0 ? null : (revenue - cost) / revenue;

const group = (businesses: readonly CostedBusiness[]): GroupCost => {
  const cost = businesses.reduce((sum, business) => sum + business.usage.total, 0);
  return {
    count: businesses.length,
    cost: microShekels(cost),
    averageCost: businesses.length === 0 ? null : microShekels(Math.round(cost / businesses.length)),
  };
};

const bySourceOf = (businesses: readonly CostedBusiness[]): Partial<Record<CostSource, MicroShekels>> => {
  const sums: Partial<Record<CostSource, number>> = {};
  for (const business of businesses) {
    for (const [source, cost] of Object.entries(business.usage.bySource) as [CostSource, { cost: number }][]) {
      sums[source] = (sums[source] ?? 0) + cost.cost;
    }
  }
  return Object.fromEntries(
    Object.entries(sums).map(([source, cost]) => [source, microShekels(cost)]),
  );
};

const planStats = (plan: Plan, paying: readonly CostedBusiness[], share: MicroShekels | null): PlanCostStats => {
  const revenue = paying.reduce((sum, business) => sum + business.monthlyPrice, 0);
  const cost = paying.reduce((sum, business) => sum + business.usage.total, 0);
  const priciest = paying.reduce<CostedBusiness | null>(
    (top, business) => (top === null || business.usage.total > top.usage.total ? business : top),
    null,
  );
  return {
    plan,
    paying: paying.length,
    revenue: money(revenue),
    cost: microShekels(cost),
    averageCost: paying.length === 0 ? null : microShekels(Math.round(cost / paying.length)),
    margin: marginOf(inMicro(money(revenue)), cost),
    marginAfterShare: share === null ? null : marginOf(inMicro(money(revenue)), cost + share * paying.length),
    bySource: bySourceOf(paying),
    priciest:
      priciest === null || priciest.usage.total === 0
        ? null
        : { businessId: priciest.businessId, name: priciest.name, cost: priciest.usage.total },
  };
};

/**
 * Every Plan's figures for a span. `share` is the Platform Cost per paying
 * Business; every paying Business carries it once.
 */
export const costStats = (businesses: readonly CostedBusiness[], share: MicroShekels | null): CostStats => {
  const paying = businesses.filter((business) => isPaying(business.status));
  return {
    plans: PLANS.map((plan) => planStats(plan, paying.filter((business) => business.plan === plan), share)),
    paying: paying.length,
    trials: group(businesses.filter((business) => business.status === "TRIAL")),
    notPaying: group(
      businesses.filter((business) => !isPaying(business.status) && business.status !== "TRIAL"),
    ),
  };
};

/** A Business that used nothing in the span still counts, at nothing. */
export const usageOrNothing = (usage: UsageCost | undefined): UsageCost => usage ?? NO_USAGE_COST;
