import { describe, expect, it } from "vitest";
import { asId } from "../model/ids.ts";
import { money } from "../model/money.ts";
import { parseLocalDate } from "../time/local-date.ts";
import { microShekels, type CostSource, type UnitRate } from "./cost.ts";
import { costStats, isPaying, usageOrNothing, type CostedBusiness } from "./cost-stats.ts";
import type { Plan } from "./plan.ts";
import type { BillingStatus } from "./standing.ts";
import { costOfUsage, NO_USAGE_COST } from "./usage-cost.ts";

const RATES: UnitRate[] = [
  { unit: "WHATSAPP_UTILITY", effectiveFrom: parseLocalDate("2026-09-01"), perUnit: microShekels(10_000), source: "card" },
];
/** `agorot` agorot of `source`, at one agora a message. */
const usage = (parts: Partial<Record<CostSource, number>>) =>
  costOfUsage(
    Object.entries(parts).map(([source, count]) => ({
      businessId: null,
      source: source as CostSource,
      unit: "WHATSAPP_UTILITY" as const,
      day: parseLocalDate("2026-09-10"),
      quantity: count,
      messages: count,
    })),
    RATES,
  );
const business = (
  name: string,
  plan: Plan,
  status: BillingStatus,
  priceMinor: number,
  parts: Partial<Record<CostSource, number>>,
): CostedBusiness => ({
  businessId: asId<"Business">(name),
  name,
  plan,
  status,
  monthlyPrice: money(priceMinor),
  usage: Object.keys(parts).length === 0 ? NO_USAGE_COST : usage(parts),
});
const AGORA = 10_000;

describe("who pays", () => {
  it("is paid time, running or in grace", () => {
    expect(["PAID", "IN_GRACE"].every((status) => isPaying(status as BillingStatus))).toBe(true);
    expect(["TRIAL", "LAPSED", "DEACTIVATED"].some((status) => isPaying(status as BillingStatus))).toBe(false);
  });
});

describe("costStats", () => {
  const rows = [
    business("ran", "SOLO", "PAID", 4_900, { BOOKING: 600, REMINDERS: 400 }),
    business("dana", "SOLO", "IN_GRACE", 4_900, { BOOKING: 200 }),
    business("noa", "TEAM", "PAID", 8_900 + 1_900, { BOOKING: 3_000, WAITING_LIST: 3_400 }),
    business("new", "TEAM", "TRIAL", 8_900, { BOOKING: 500 }),
    business("gone", "SOLO", "LAPSED", 4_900, { REMINDERS: 100 }),
    business("quiet", "SOLO", "DEACTIVATED", 4_900, {}),
  ];

  it("counts only the paying on each Plan, with what they pay against what they cost", () => {
    const stats = costStats(rows, null);
    const solo = stats.plans.find((plan) => plan.plan === "SOLO");
    expect(solo).toMatchObject({
      paying: 2,
      revenue: 9_800,
      cost: 1_200 * AGORA,
      averageCost: 600 * AGORA,
      priciest: { businessId: "ran", name: "ran", cost: 1_000 * AGORA },
      bySource: { BOOKING: 800 * AGORA, REMINDERS: 400 * AGORA },
    });
    expect(solo?.margin).toBeCloseTo((9_800 - 1_200) / 9_800, 10);
    expect(solo?.marginAfterShare).toBeNull();
    expect(stats.paying).toBe(3);
  });

  it("counts an Add-on's price as what the Business pays", () => {
    const team = costStats(rows, null).plans.find((plan) => plan.plan === "TEAM");
    expect(team?.revenue).toBe(10_800);
    expect(team?.margin).toBeCloseTo((10_800 - 6_400) / 10_800, 10);
  });

  it("takes each paying Business's share of the Platform Cost off the margin", () => {
    const team = costStats(rows, microShekels(1_000 * AGORA)).plans.find((plan) => plan.plan === "TEAM");
    expect(team?.marginAfterShare).toBeCloseTo((10_800 - 6_400 - 1_000) / 10_800, 10);
  });

  it("keeps Trials and those not paying apart, with what they cost", () => {
    const stats = costStats(rows, null);
    expect(stats.trials).toEqual({ count: 1, cost: 500 * AGORA, averageCost: 500 * AGORA });
    expect(stats.notPaying).toEqual({ count: 2, cost: 100 * AGORA, averageCost: 50 * AGORA });
  });

  it("gives a Plan nobody pays for no average, no margin and no priciest — never a division by zero", () => {
    const stats = costStats([business("new", "SOLO", "TRIAL", 4_900, { BOOKING: 1 })], microShekels(5));
    for (const plan of stats.plans) {
      expect(plan).toMatchObject({ paying: 0, revenue: 0, cost: 0, averageCost: null, margin: null, priciest: null });
      expect(plan.marginAfterShare).toBeNull();
    }
    expect(stats.notPaying).toEqual({ count: 0, cost: 0, averageCost: null });
  });

  it("names nobody the priciest when every paying Business cost nothing", () => {
    const stats = costStats([business("idle", "SOLO", "PAID", 4_900, {})], null);
    expect(stats.plans[0]?.priciest).toBeNull();
    expect(stats.plans[0]?.margin).toBe(1);
  });

  it("shows a margin below zero when a Business costs more than it pays", () => {
    const stats = costStats([business("loud", "SOLO", "PAID", 4_900, { BOOKING: 9_800 })], null);
    expect(stats.plans[0]?.margin).toBeCloseTo(-1, 10);
  });

  it("lists every Plan, in order, even with no Business at all", () => {
    expect(costStats([], null).plans.map((plan) => plan.plan)).toEqual(["SOLO", "TEAM"]);
  });

  it("treats a Business that used nothing as having used nothing", () => {
    expect(usageOrNothing(undefined)).toEqual(NO_USAGE_COST);
  });
});
