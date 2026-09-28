import { describe, expect, it } from "vitest";
import { asId } from "../model/ids.ts";
import { money } from "../model/money.ts";
import { parseLocalDate } from "../time/local-date.ts";
import type { AddonHolding } from "./addon.ts";
import { daysOwed, upgradeDaysOwed, type DaysOwedEntry } from "./days-owed.ts";
import { nextPayment } from "./next-payment.ts";
import { planTerms, type PlanVersion } from "./plan.ts";

const day = parseLocalDate;

const solo: PlanVersion = {
  id: asId("solo-1"),
  plan: "SOLO",
  number: 1,
  terms: planTerms({ features: ["REMINDERS"], resourceAllowance: 1, price: money(4900) }),
};
const team: PlanVersion = {
  id: asId("team-1"),
  plan: "TEAM",
  number: 1,
  terms: planTerms({
    features: ["REMINDERS", "CUSTOMER_HISTORY", "CUSTOMER_BLOCKING", "TEAM_ROLES"],
    resourceAllowance: 5,
    price: money(8900),
  }),
};

/** Paid through 26 November: the next payment is on the 27th. */
const paid = { trialEndsOn: null, paidThrough: day("2026-11-26"), scheduledMove: null };

const holding = (overrides: Partial<AddonHolding> = {}): AddonHolding => ({
  id: asId("h1"),
  businessId: asId("b1"),
  feature: "CUSTOMER_HISTORY",
  addedOn: day("2026-10-02"),
  paysFrom: day("2026-11-27"),
  price: money(1900),
  nextPrice: null,
  endsOn: null,
  ending: null,
  ...overrides,
});

describe("daysOwed", () => {
  it("counts the days by thirtieths of the monthly price, both ends included", () => {
    expect(daysOwed(money(1900), day("2026-11-12"), day("2026-11-26"))).toEqual({
      amount: 950,
      from: "2026-11-12",
      through: "2026-11-26",
    });
  });

  it("is nothing when no day is left, or it rounds to nothing", () => {
    expect(daysOwed(money(1900), day("2026-11-27"), day("2026-11-26"))).toBeNull();
    expect(daysOwed(money(1), day("2026-11-26"), day("2026-11-26"))).toBeNull();
  });
});

describe("upgradeDaysOwed", () => {
  const today = day("2026-11-12");

  it("is nothing the first time a Business moves up to a Plan", () => {
    expect(upgradeDaysOwed({ from: solo, to: team, subscription: paid, plansHeld: ["SOLO"], today })).toBeNull();
  });

  it("daysOwed the difference for the days already paid for, moving up again to a Plan it left", () => {
    expect(upgradeDaysOwed({ from: solo, to: team, subscription: paid, plansHeld: ["SOLO", "TEAM"], today })).toEqual({
      amount: 2000,
      from: "2026-11-12",
      through: "2026-11-26",
    });
  });

  it("is nothing moving down, within a Plan, or with nothing paid yet", () => {
    const held = ["SOLO", "TEAM"] as const;
    expect(upgradeDaysOwed({ from: team, to: solo, subscription: paid, plansHeld: held, today })).toBeNull();
    expect(upgradeDaysOwed({ from: solo, to: solo, subscription: paid, plansHeld: held, today })).toBeNull();
    const trial = { trialEndsOn: day("2026-11-30"), paidThrough: null, scheduledMove: null };
    expect(upgradeDaysOwed({ from: solo, to: team, subscription: trial, plansHeld: held, today })).toBeNull();
  });
});

describe("nextPayment", () => {
  const today = day("2026-11-12");

  it("adds up the Plan and every Add-on still held on the day it is owed", () => {
    const payment = nextPayment({
      subscription: paid,
      planVersion: solo,
      scheduledVersion: null,
      holdings: [holding(), holding({ id: asId("h2"), feature: "CUSTOMER_BLOCKING", price: money(900), endsOn: day("2026-11-26"), ending: "CANCELLED" })],
      daysOwed: [],
      today,
    });
    expect(payment).toEqual({
      on: "2026-11-27",
      lines: [
        { kind: "PLAN", plan: "SOLO", amount: 4900 },
        { kind: "ADDON", feature: "CUSTOMER_HISTORY", amount: 1900 },
      ],
      total: 6800,
    });
  });

  it("takes the price that applies on the day, a scheduled move's and a rise's", () => {
    const payment = nextPayment({
      subscription: { ...paid, scheduledMove: { planVersionId: team.id, effectiveOn: day("2026-11-27") } },
      planVersion: solo,
      scheduledVersion: team,
      holdings: [holding({ feature: "WAITING_LIST", nextPrice: { price: money(2400), effectiveOn: day("2026-11-27") } })],
      daysOwed: [],
      today,
    });
    expect(payment.lines).toEqual([
      { kind: "PLAN", plan: "TEAM", amount: 8900 },
      { kind: "ADDON", feature: "WAITING_LIST", amount: 2400 },
    ]);
  });

  it("leaves out an Add-on not yet paid for, and adds the days owed", () => {
    const owed: DaysOwedEntry = {
      id: asId("c1"),
      businessId: asId("b1"),
      kind: "ADDON_DAYS",
      subject: "CUSTOMER_HISTORY",
      amount: money(950),
      from: day("2026-11-12"),
      through: day("2026-11-26"),
      paymentId: null,
    };
    const payment = nextPayment({
      subscription: paid,
      planVersion: solo,
      scheduledVersion: null,
      holdings: [holding({ paysFrom: day("2026-12-27") })],
      daysOwed: [owed],
      today,
    });
    expect(payment.lines).toEqual([
      { kind: "PLAN", plan: "SOLO", amount: 4900 },
      { kind: "DAYS", owed },
    ]);
    expect(payment.total).toBe(5850);
  });

  it("is owed at the end of a Trial, and today when nothing was ever covered", () => {
    const trial = { trialEndsOn: day("2026-11-30"), paidThrough: null, scheduledMove: null };
    expect(nextPayment({ subscription: trial, planVersion: solo, scheduledVersion: null, holdings: [], daysOwed: [], today }).on).toBe(
      "2026-12-01",
    );
    const never = { trialEndsOn: null, paidThrough: null, scheduledMove: null };
    expect(nextPayment({ subscription: never, planVersion: solo, scheduledVersion: null, holdings: [], daysOwed: [], today }).on).toBe(
      "2026-11-12",
    );
  });
});
