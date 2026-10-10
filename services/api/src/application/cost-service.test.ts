import { beforeEach, describe, expect, it } from "vitest";
import { money, parseLocalDate } from "@tor-now/domain";
import {
  AGORA,
  anAdministrator,
  AUTHENTICATION,
  aShop,
  costHarness,
  holding,
  IN_SEPTEMBER,
  neverPaid,
  paidThrough,
  sent,
  SMS_PART,
  WHATSAPP,
} from "../infrastructure/testing/cost-fixtures.ts";
import { signIn, type Harness } from "../infrastructure/testing/harness.ts";

/**
 * A month's costs (ADR 0023), worked out from the Usage Records whenever an
 * administrator looks. The harness's today is 20 September 2026.
 */
describe("what a month cost", () => {
  let test: Harness;

  beforeEach(() => {
    test = costHarness();
  });

  const aMonthOfBusinesses = async () => {
    const ran = await aShop(test, "מספרת רן", "SOLO");
    const dana = await aShop(test, "סלון דנה", "SOLO");
    const noa = await aShop(test, "סטודיו נועה", "TEAM");
    const fresh = await aShop(test, "חדשים", "TEAM");
    const gone = await aShop(test, "סגור", "SOLO");
    paidThrough(test, ran.business.id, "2026-10-10");
    // Paid through a day in the past: in its Grace Period, still paying.
    paidThrough(test, dana.business.id, "2026-09-18");
    paidThrough(test, noa.business.id, "2026-10-01");
    neverPaid(test, gone.business.id);
    holding(test, noa.business.id, "WAITING_LIST", 1_900, "2026-09-01");

    sent(test, ran.business.id, "BOOKING", "WHATSAPP_UTILITY", IN_SEPTEMBER, 100);
    sent(test, ran.business.id, "REMINDERS", "SMS_SEGMENT", IN_SEPTEMBER, 2, 2);
    sent(test, dana.business.id, "BOOKING", "WHATSAPP_UTILITY", IN_SEPTEMBER, 10);
    sent(test, noa.business.id, "WAITING_LIST", "SMS_SEGMENT", IN_SEPTEMBER, 15, 2);
    sent(test, noa.business.id, "BOOKING", "WHATSAPP_UTILITY", IN_SEPTEMBER, 300);
    sent(test, fresh.business.id, "BOOKING", "WHATSAPP_UTILITY", IN_SEPTEMBER, 40);
    sent(test, gone.business.id, "REMINDERS", "WHATSAPP_UTILITY", IN_SEPTEMBER, 5);
    sent(test, null, "SIGN_IN", "WHATSAPP_AUTHENTICATION", IN_SEPTEMBER, 50);
    return { ran, dana, noa, fresh, gone };
  };

  it("is the administrators' alone", async () => {
    const owner = await signIn(test, "+972500000009");
    await expect(test.services.costs.month(owner.actor, null)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("counts each Plan's paying Businesses — paid or in grace — against what they pay", async () => {
    const { ran, noa } = await aMonthOfBusinesses();
    const month = await test.services.costs.month(await anAdministrator(test), null);

    expect(month.span).toEqual({ first: "2026-09-01", through: "2026-09-20", current: true });
    const solo = month.stats.plans.find((plan) => plan.plan === "SOLO");
    const ranCost = 100 * WHATSAPP + 4 * SMS_PART;
    const danaCost = 10 * WHATSAPP;
    expect(solo).toMatchObject({
      paying: 2,
      revenue: 9_800,
      cost: ranCost + danaCost,
      averageCost: Math.round((ranCost + danaCost) / 2),
      priciest: { businessId: ran.business.id, name: "מספרת רן", cost: ranCost },
    });
    const team = month.stats.plans.find((plan) => plan.plan === "TEAM");
    // Team's price and the waiting-list Add-on it holds.
    expect(team).toMatchObject({ paying: 1, revenue: 8_900 + 1_900 });
    expect(team?.priciest?.businessId).toBe(noa.business.id);
    expect(team?.bySource).toEqual({ BOOKING: 300 * WHATSAPP, WAITING_LIST: 30 * SMS_PART });
    expect(month.stats.paying).toBe(3);
  });

  it("keeps the Trial and those not paying apart, with what they cost", async () => {
    await aMonthOfBusinesses();
    const month = await test.services.costs.month(await anAdministrator(test), null);
    expect(month.stats.trials).toEqual({ count: 1, cost: 40 * WHATSAPP, averageCost: 40 * WHATSAPP });
    expect(month.stats.notPaying).toEqual({ count: 1, cost: 5 * WHATSAPP, averageCost: 5 * WHATSAPP });
  });

  it("adds sign-in codes to every running cost as the Platform Cost, and shares it over the paying", async () => {
    await aMonthOfBusinesses();
    const admin = await anAdministrator(test);
    await test.services.costs.addRunningCost(admin, {
      name: "Supabase",
      amount: { effectiveFrom: parseLocalDate("2026-09-01"), amount: money(9_250), source: "invoice August" },
    });
    await test.services.costs.addRunningCost(admin, {
      name: "Domain",
      amount: { effectiveFrom: parseLocalDate("2026-10-01"), amount: money(500), source: "₪60 a year" },
    });

    const month = await test.services.costs.month(admin, null);

    expect(month.platform.signIn).toEqual({ codes: 50, cost: 50 * AUTHENTICATION, unpricedUnits: 0 });
    // The domain is not due until October, so September does not count it.
    expect(month.platform.running.map((line) => line.name)).toEqual(["Supabase"]);
    const total = 50 * AUTHENTICATION + 9_250 * AGORA;
    expect(month.platform.total).toBe(total);
    expect(month.platform.perPaying).toBe(Math.round(total / 3));
    const solo = month.stats.plans.find((plan) => plan.plan === "SOLO");
    expect(solo?.marginAfterShare).toBeCloseTo(
      (9_800 * AGORA - (100 * WHATSAPP + 4 * SMS_PART + 10 * WHATSAPP) - 2 * Math.round(total / 3)) / (9_800 * AGORA),
      10,
    );
  });

  it("names the Businesses over a Fair Use Limit this month, worked out now", async () => {
    const { noa } = await aMonthOfBusinesses();
    const month = await test.services.costs.month(await anAdministrator(test), null);
    // Thirty SMS parts on the waiting list is ₪28.58, over its ₪10.
    expect(month.overLimit).toEqual([noa.business.id]);
  });

  it("reports usage no rate covers as unpriced, never as free", async () => {
    const ran = await aShop(test, "מספרת רן", "SOLO");
    paidThrough(test, ran.business.id, "2026-10-10");
    test.store.unitRates = test.store.unitRates.filter((rate) => rate.unit !== "SMS_SEGMENT");
    sent(test, ran.business.id, "BOOKING", "SMS_SEGMENT", IN_SEPTEMBER, 3, 2);

    const month = await test.services.costs.month(await anAdministrator(test), null);

    expect(month.unpriced).toEqual([{ unit: "SMS_SEGMENT", units: 6, messages: 3, from: "2026-09-10" }]);
    expect(month.stats.plans.find((plan) => plan.plan === "SOLO")?.cost).toBe(0);
  });

  it("reads an earlier month to its last day, with each Business standing as it did then", async () => {
    const dana = await aShop(test, "סלון דנה", "SOLO");
    // Paid through 29 August: in grace on 31 August, still paying for August.
    paidThrough(test, dana.business.id, "2026-08-29");
    test.store.unitRates = test.store.unitRates.map((rate) => ({ ...rate, effectiveFrom: parseLocalDate("2026-08-01") }));
    sent(test, dana.business.id, "BOOKING", "WHATSAPP_UTILITY", "2026-08-31T20:00:00.000Z", 7);
    sent(test, dana.business.id, "BOOKING", "WHATSAPP_UTILITY", "2026-09-01T00:00:00.000Z", 100);

    const august = await test.services.costs.month(await anAdministrator(test), parseLocalDate("2026-08-01"));

    expect(august.span).toEqual({ first: "2026-08-01", through: "2026-08-31", current: false });
    expect(august.stats.plans.find((plan) => plan.plan === "SOLO")).toMatchObject({ paying: 1, cost: 7 * WHATSAPP });
  });

  it("starts a month at midnight in Israel, not in UTC", async () => {
    const dana = await aShop(test, "סלון דנה", "SOLO");
    paidThrough(test, dana.business.id, "2026-10-10");
    // Rates from August, so the only question is which month the usage belongs to.
    test.store.unitRates = test.store.unitRates.map((rate) => ({ ...rate, effectiveFrom: parseLocalDate("2026-08-01") }));
    // 23:30 UTC on 31 August is 02:30 on 1 September in Israel: September's.
    sent(test, dana.business.id, "BOOKING", "WHATSAPP_UTILITY", "2026-08-31T23:30:00.000Z", 3);
    // 20:59 UTC on 31 August is 23:59 in Israel: still August's.
    sent(test, dana.business.id, "BOOKING", "WHATSAPP_UTILITY", "2026-08-31T20:59:00.000Z", 100);
    const month = await test.services.costs.month(await anAdministrator(test), null);
    expect(month.stats.plans.find((plan) => plan.plan === "SOLO")?.cost).toBe(3 * WHATSAPP);
  });

  it("takes any day of a month as that month", async () => {
    const month = await test.services.costs.month(await anAdministrator(test), parseLocalDate("2026-09-17"));
    expect(month.span.first).toBe("2026-09-01");
  });

  it("refuses a month that has not started", async () => {
    await expect(
      test.services.costs.month(await anAdministrator(test), parseLocalDate("2026-10-01")),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { field: "month" } });
  });

  it("has nothing to share and no margin when nobody pays, without dividing by nobody", async () => {
    await aShop(test, "חדשים", "TEAM");
    sent(test, null, "SIGN_IN", "WHATSAPP_AUTHENTICATION", IN_SEPTEMBER, 3);
    const month = await test.services.costs.month(await anAdministrator(test), null);
    expect(month.platform.perPaying).toBeNull();
    expect(month.stats.plans.every((plan) => plan.margin === null && plan.averageCost === null)).toBe(true);
    expect(month.stats.trials.count).toBe(1);
  });
});
