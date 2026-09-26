import { describe, expect, it } from "vitest";
import {
  costOf,
  microShekels,
  MICRO_SHEKELS_PER_AGORA,
  priceUsage,
  rateOn,
  smsSegments,
  toAgorot,
  type UnitRate,
} from "./cost.ts";
import { parseLocalDate } from "../time/local-date.ts";

const day = parseLocalDate;
const rate = (unit: UnitRate["unit"], from: string, perUnit: number): UnitRate => ({
  unit,
  effectiveFrom: day(from),
  perUnit: microShekels(perUnit),
  source: "https://example.test/rate-card",
});

describe("microShekels", () => {
  it("holds a fraction of an agora exactly", () => {
    expect(MICRO_SHEKELS_PER_AGORA).toBe(10_000);
    expect(microShekels(19_610)).toBe(19_610);
  });

  it("refuses anything but a whole, non-negative number", () => {
    expect(() => microShekels(-1)).toThrow();
    expect(() => microShekels(1.5)).toThrow();
  });

  it("rounds to the nearest agora only when shown as money", () => {
    expect(toAgorot(microShekels(19_610))).toBe(2);
    expect(toAgorot(microShekels(14_999))).toBe(1);
  });
});

describe("costOf", () => {
  it("is the rate times the units used", () => {
    expect(costOf(microShekels(952_750), 3)).toBe(2_858_250);
  });

  it("refuses a quantity that is not a whole, positive number", () => {
    expect(() => costOf(microShekels(952_750), 0)).toThrow();
    expect(() => costOf(microShekels(952_750), 1.5)).toThrow();
  });
});

describe("rateOn", () => {
  const rates = [
    rate("SMS_SEGMENT", "2026-09-01", 900_000),
    rate("SMS_SEGMENT", "2026-10-01", 950_000),
    rate("WHATSAPP_UTILITY", "2026-09-01", 19_000),
  ];

  it("is the latest rate that had started for that unit", () => {
    expect(rateOn(rates, "SMS_SEGMENT", day("2026-09-30"))?.perUnit).toBe(900_000);
    expect(rateOn(rates, "SMS_SEGMENT", day("2026-10-01"))?.perUnit).toBe(950_000);
    expect(rateOn(rates, "SMS_SEGMENT", day("2027-01-01"))?.perUnit).toBe(950_000);
  });

  it("is none before the first rate, or for a unit nobody priced", () => {
    expect(rateOn(rates, "SMS_SEGMENT", day("2026-08-31"))).toBeNull();
    expect(rateOn(rates, "WHATSAPP_AUTHENTICATION", day("2026-10-01"))).toBeNull();
  });
});

describe("priceUsage", () => {
  it("prices each day by the rate in force that day", () => {
    const rates = [rate("SMS_SEGMENT", "2026-09-01", 900_000), rate("SMS_SEGMENT", "2026-10-01", 950_000)];
    const total = priceUsage(
      [
        { unit: "SMS_SEGMENT", day: day("2026-09-30"), quantity: 2 },
        { unit: "SMS_SEGMENT", day: day("2026-10-02"), quantity: 1 },
      ],
      rates,
    );
    expect(total).toEqual({ priced: 2_750_000, unpricedQuantity: 0 });
  });

  it("reprices past usage when a rate is corrected backwards, without touching the usage", () => {
    const usage = [{ unit: "WHATSAPP_UTILITY" as const, day: day("2026-09-15"), quantity: 10 }];
    expect(priceUsage(usage, [rate("WHATSAPP_UTILITY", "2026-09-20", 19_000)])).toEqual({
      priced: 0,
      unpricedQuantity: 10,
    });
    expect(priceUsage(usage, [rate("WHATSAPP_UTILITY", "2026-09-01", 19_000)])).toEqual({
      priced: 190_000,
      unpricedQuantity: 0,
    });
  });

  it("counts what no rate covers apart, rather than as free", () => {
    const total = priceUsage([{ unit: "SMS_SEGMENT", day: day("2026-09-10"), quantity: 4 }], []);
    expect(total).toEqual({ priced: 0, unpricedQuantity: 4 });
  });
});

describe("smsSegments", () => {
  it("fits 160 plain characters in one segment and splits longer text by 153", () => {
    expect(smsSegments("a".repeat(160))).toBe(1);
    expect(smsSegments("a".repeat(161))).toBe(2);
    expect(smsSegments("a".repeat(306))).toBe(2);
    expect(smsSegments("a".repeat(307))).toBe(3);
  });

  it("fits only 70 Hebrew characters in one segment and splits longer text by 67", () => {
    expect(smsSegments("א".repeat(70))).toBe(1);
    expect(smsSegments("א".repeat(71))).toBe(2);
    expect(smsSegments("א".repeat(134))).toBe(2);
    expect(smsSegments("א".repeat(135))).toBe(3);
  });

  it("counts a single Hebrew letter as making the whole message Unicode", () => {
    expect(smsSegments(`${"a".repeat(100)}א`)).toBe(2);
  });

  it("is one segment even when empty, because a message is still sent", () => {
    expect(smsSegments("")).toBe(1);
  });
});
