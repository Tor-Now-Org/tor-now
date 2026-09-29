import { describe, expect, it } from "vitest";
import { asId, type BusinessId } from "../model/ids.ts";
import { parseLocalDate } from "../time/local-date.ts";
import { microShekels, type CostSource, type CostUnit, type UnitRate } from "./cost.ts";
import { costOfUsage, costsOf, NO_USAGE_COST, sourceCost, type UsageDay } from "./usage-cost.ts";

const day = parseLocalDate;
const shop = asId<"Business">("shop") as BusinessId;
const other = asId<"Business">("other") as BusinessId;

const rate = (unit: CostUnit, from: string, perUnit: number): UnitRate => ({
  unit,
  effectiveFrom: day(from),
  perUnit: microShekels(perUnit),
  source: "https://example.test/rate-card",
});
const RATES = [
  rate("WHATSAPP_UTILITY", "2026-09-01", 20_000),
  rate("WHATSAPP_AUTHENTICATION", "2026-09-01", 15_000),
  rate("SMS_SEGMENT", "2026-09-01", 950_000),
];

const line = (
  businessId: BusinessId | null,
  source: CostSource,
  unit: CostUnit,
  on: string,
  quantity: number,
  messages = quantity,
): UsageDay => ({ businessId, source, unit, day: day(on), quantity, messages });

describe("costOfUsage", () => {
  it("costs nothing when nothing was sent", () => {
    expect(costOfUsage([], RATES)).toEqual(NO_USAGE_COST);
  });

  it("prices each cause by the rate in force on its day, and counts messages and SMS parts apart", () => {
    const usage = costOfUsage(
      [
        line(shop, "BOOKING", "WHATSAPP_UTILITY", "2026-09-10", 10),
        line(shop, "BOOKING", "SMS_SEGMENT", "2026-09-10", 6, 3),
        line(shop, "REMINDERS", "WHATSAPP_UTILITY", "2026-09-11", 4),
      ],
      RATES,
    );
    expect(usage.total).toBe(10 * 20_000 + 6 * 950_000 + 4 * 20_000);
    expect(sourceCost(usage, "BOOKING")).toEqual({
      cost: 10 * 20_000 + 6 * 950_000,
      whatsapp: 10,
      smsMessages: 3,
      smsParts: 6,
      unpricedUnits: 0,
    });
    expect(sourceCost(usage, "REMINDERS").whatsapp).toBe(4);
    expect(usage.whatsapp).toBe(14);
    expect(usage.smsMessages).toBe(3);
    expect(usage.smsParts).toBe(6);
  });

  it("uses a later rate from its day, and a correction reaches back to the days it covers", () => {
    const rates = [...RATES, rate("WHATSAPP_UTILITY", "2026-09-15", 30_000)];
    const usage = costOfUsage(
      [
        line(shop, "BOOKING", "WHATSAPP_UTILITY", "2026-09-14", 1),
        line(shop, "BOOKING", "WHATSAPP_UTILITY", "2026-09-15", 1),
      ],
      rates,
    );
    expect(usage.total).toBe(20_000 + 30_000);
  });

  it("keeps units no rate covers apart, never as free, and still counts the messages", () => {
    const usage = costOfUsage(
      [
        line(shop, "BOOKING", "SMS_SEGMENT", "2026-08-31", 4, 2),
        line(shop, "BOOKING", "WHATSAPP_UTILITY", "2026-09-01", 1),
      ],
      RATES,
    );
    expect(usage.total).toBe(20_000);
    expect(usage.unpricedUnits).toBe(4);
    expect(sourceCost(usage, "BOOKING").unpricedUnits).toBe(4);
    expect(usage.smsMessages).toBe(2);
  });

  it("gives an unused cause nothing rather than nothing at all", () => {
    expect(sourceCost(NO_USAGE_COST, "WAITING_LIST")).toEqual({
      cost: 0,
      whatsapp: 0,
      smsMessages: 0,
      smsParts: 0,
      unpricedUnits: 0,
    });
  });
});

describe("costsOf", () => {
  it("splits usage between the Businesses that caused it and the platform", () => {
    const costs = costsOf(
      [
        line(shop, "BOOKING", "WHATSAPP_UTILITY", "2026-09-10", 2),
        line(other, "REMINDERS", "WHATSAPP_UTILITY", "2026-09-10", 3),
        line(null, "SIGN_IN", "WHATSAPP_AUTHENTICATION", "2026-09-10", 5),
        line(shop, "BILLING", "WHATSAPP_UTILITY", "2026-09-12", 1),
      ],
      RATES,
    );
    expect(costs.businesses.get(shop)?.total).toBe(3 * 20_000);
    expect(costs.businesses.get(other)?.total).toBe(3 * 20_000);
    expect(costs.platform.total).toBe(5 * 15_000);
    expect(sourceCost(costs.platform, "SIGN_IN").whatsapp).toBe(5);
    expect(costs.businesses.size).toBe(2);
    expect(costs.unpriced).toEqual([]);
  });

  it("says, per unit, how much no rate covered and from which day", () => {
    const costs = costsOf(
      [
        line(shop, "BOOKING", "SMS_SEGMENT", "2026-08-30", 2, 1),
        line(other, "BOOKING", "SMS_SEGMENT", "2026-08-20", 3, 1),
        line(null, "SIGN_IN", "WHATSAPP_AUTHENTICATION", "2026-08-25", 1),
        line(shop, "BOOKING", "SMS_SEGMENT", "2026-09-02", 2, 1),
      ],
      RATES,
    );
    expect(costs.unpriced).toEqual([
      { unit: "SMS_SEGMENT", units: 5, messages: 2, from: "2026-08-20" },
      { unit: "WHATSAPP_AUTHENTICATION", units: 1, messages: 1, from: "2026-08-25" },
    ]);
  });
});
