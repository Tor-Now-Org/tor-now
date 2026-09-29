import { describe, expect, it } from "vitest";
import { asId, type BusinessId } from "../model/ids.ts";
import { money } from "../model/money.ts";
import { parseLocalDate } from "../time/local-date.ts";
import { microShekels, type CostSource, type CostUnit, type UnitRate } from "./cost.ts";
import {
  checkBusinessLimit,
  checkSignInLimit,
  FAIR_USE_SOURCES,
  isFairUseSource,
  MAX_BUSINESS_LIMIT_MINOR,
  overLimits,
  readingsOf,
  signInOver,
  type FairUseLimits,
} from "./fair-use.ts";
import { costOfUsage, NO_USAGE_COST } from "./usage-cost.ts";

const shop = asId<"Business">("shop") as BusinessId;
const RATES: UnitRate[] = [
  { unit: "WHATSAPP_UTILITY", effectiveFrom: parseLocalDate("2026-09-01"), perUnit: microShekels(10_000), source: "card" },
];
const LIMITS: FairUseLimits = {
  perBusiness: { BOOKING: money(12_000), REMINDERS: money(10_000), WAITING_LIST: money(1_000) },
  signInPerDay: 300,
};
/** One agora a message: `count` messages cost `count` agorot. */
const spent = (source: CostSource, count: number, unit: CostUnit = "WHATSAPP_UTILITY") =>
  costOfUsage(
    [{ businessId: shop, source, unit, day: parseLocalDate("2026-09-10"), quantity: count, messages: count }],
    RATES,
  );

describe("Fair Use Limits", () => {
  it("covers the causes a Business can run up, and nothing that sends no message", () => {
    expect(FAIR_USE_SOURCES).toEqual(["BOOKING", "REMINDERS", "WAITING_LIST"]);
    expect(isFairUseSource("REMINDERS")).toBe(true);
    expect(isFairUseSource("BILLING")).toBe(false);
    expect(isFairUseSource("SIGN_IN")).toBe(false);
    expect(isFairUseSource("CUSTOMER_HISTORY")).toBe(false);
  });

  it("is over only above the limit, never at it", () => {
    expect(overLimits(spent("WAITING_LIST", 1_000), LIMITS)).toEqual([]);
    expect(overLimits(spent("WAITING_LIST", 1_001), LIMITS)).toEqual(["WAITING_LIST"]);
  });

  it("reads every cause against its own limit, in a fixed order, with nothing used as nothing", () => {
    expect(readingsOf(NO_USAGE_COST, LIMITS)).toEqual([
      { source: "BOOKING", limit: 12_000, cost: 0, over: false },
      { source: "REMINDERS", limit: 10_000, cost: 0, over: false },
      { source: "WAITING_LIST", limit: 1_000, cost: 0, over: false },
    ]);
    const readings = readingsOf(spent("REMINDERS", 10_500), LIMITS);
    expect(readings.find((reading) => reading.source === "REMINDERS")).toEqual({
      source: "REMINDERS",
      limit: 10_000,
      cost: 10_500 * 10_000,
      over: true,
    });
  });

  it("ignores what is not a Fair Use cause however much it cost", () => {
    expect(overLimits(spent("BILLING", 1_000_000), LIMITS)).toEqual([]);
  });

  it("alerts on sign-in codes only above the day's limit", () => {
    expect(signInOver(300, LIMITS)).toBe(false);
    expect(signInOver(301, LIMITS)).toBe(true);
    expect(signInOver(0, LIMITS)).toBe(false);
  });

  it("takes a limit of whole agorot above zero, up to ₪100,000", () => {
    expect(checkBusinessLimit(1)).toBe(1);
    expect(checkBusinessLimit(MAX_BUSINESS_LIMIT_MINOR)).toBe(MAX_BUSINESS_LIMIT_MINOR);
    for (const wrong of [0, -5, 1.5, MAX_BUSINESS_LIMIT_MINOR + 1, Number.NaN]) {
      expect(() => checkBusinessLimit(wrong)).toThrow(/limit/);
    }
  });

  it("takes a daily limit of at least one whole code", () => {
    expect(checkSignInLimit(1)).toBe(1);
    expect(checkSignInLimit(300)).toBe(300);
    for (const wrong of [0, -1, 2.5, 1_000_001]) {
      expect(() => checkSignInLimit(wrong)).toThrow(/daily limit/);
    }
  });
});
