import { describe, expect, it } from "vitest";
import { asId, type BusinessId, type ReferenceBusinessId } from "../model/ids.ts";
import { money } from "../model/money.ts";
import { parseLocalDate } from "../time/local-date.ts";
import {
  averageUse,
  calculate,
  checkCalculatorUse,
  checkReferenceName,
  checkReferenceRoom,
  DEFAULT_PARTS_PER_SMS,
  MAX_REFERENCE_BUSINESSES,
  partsPerSmsOf,
  useOf,
  type CalculatorPlan,
  type CalculatorRates,
  type CalculatorUse,
} from "./calculator.ts";
import { microShekels, type CostUnit, type UnitRate } from "./cost.ts";
import { costOfUsage, NO_USAGE_COST, type UsageDay } from "./usage-cost.ts";

const RATES: CalculatorRates = { whatsapp: microShekels(19_610), smsPart: microShekels(952_750), partsPerSms: 2 };
const PLANS: CalculatorPlan[] = [
  { plan: "SOLO", price: money(4_900), allowance: 1 },
  { plan: "TEAM", price: money(8_900), allowance: 5 },
];
const use = (calendars: number, counts: Partial<Record<keyof Omit<CalculatorUse, "calendars">, [number, number]>>) =>
  ({
    calendars,
    BOOKING: { whatsapp: counts.BOOKING?.[0] ?? 0, sms: counts.BOOKING?.[1] ?? 0 },
    REMINDERS: { whatsapp: counts.REMINDERS?.[0] ?? 0, sms: counts.REMINDERS?.[1] ?? 0 },
    WAITING_LIST: { whatsapp: counts.WAITING_LIST?.[0] ?? 0, sms: counts.WAITING_LIST?.[1] ?? 0 },
    BILLING: { whatsapp: counts.BILLING?.[0] ?? 0, sms: counts.BILLING?.[1] ?? 0 },
  }) satisfies CalculatorUse;
const AVERAGE = use(2, { BOOKING: [238, 3], REMINDERS: [197, 2], WAITING_LIST: [6, 0], BILLING: [2, 0] });

describe("calculate", () => {
  it("prices WhatsApp by the message and SMS by its measured parts, cause by cause", () => {
    const result = calculate({ use: AVERAGE, rates: RATES, plans: PLANS, share: null });
    expect(result.bySource.BOOKING).toBe(Math.round(238 * 19_610 + 3 * 2 * 952_750));
    expect(result.bySource.REMINDERS).toBe(Math.round(197 * 19_610 + 2 * 2 * 952_750));
    expect(result.bySource.WAITING_LIST).toBe(6 * 19_610);
    expect(result.bySource.BILLING).toBe(2 * 19_610);
    expect(result.total).toBe(
      result.bySource.BOOKING + result.bySource.REMINDERS + result.bySource.WAITING_LIST + result.bySource.BILLING,
    );
    // ₪18.21, as the design showed.
    expect(Math.round(result.total / 10_000)).toBe(1_821);
    expect(result.smsMessages).toBe(5);
    expect(result.smsCost).toBe(5 * 2 * 952_750);
    expect(result.missingRates).toEqual([]);
  });

  it("gives a margin on every Plan, saying which the calendars do not fit", () => {
    const result = calculate({ use: AVERAGE, rates: RATES, plans: PLANS, share: null });
    const [solo, team] = result.margins;
    expect(solo).toMatchObject({ plan: "SOLO", fits: false, marginAfterShare: null });
    expect(team).toMatchObject({ plan: "TEAM", fits: true });
    expect(team?.margin).toBeCloseTo((8_900 * 10_000 - result.total) / (8_900 * 10_000), 10);
  });

  it("fits a Plan exactly at its allowance", () => {
    const result = calculate({ use: use(5, {}), rates: RATES, plans: PLANS, share: null });
    expect(result.margins.map((margin) => margin.fits)).toEqual([false, true]);
    expect(result.margins.every((margin) => margin.margin === 1)).toBe(true);
  });

  it("takes the Platform Cost share off again for the margin after it", () => {
    const share = microShekels(98_100);
    const result = calculate({ use: AVERAGE, rates: RATES, plans: PLANS, share });
    const team = result.margins[1];
    expect(team?.marginAfterShare).toBeCloseTo((8_900 * 10_000 - result.total - share) / (8_900 * 10_000), 10);
  });

  it("uses the parts measured, not two, when they differ", () => {
    const three = calculate({ use: use(1, { BOOKING: [0, 10] }), rates: { ...RATES, partsPerSms: 3 }, plans: PLANS, share: null });
    expect(three.total).toBe(10 * 3 * 952_750);
  });

  it("counts a unit with no rate at nothing, and says which", () => {
    const result = calculate({
      use: use(1, { BOOKING: [100, 5] }),
      rates: { whatsapp: null, smsPart: null, partsPerSms: 2 },
      plans: PLANS,
      share: null,
    });
    expect(result.total).toBe(0);
    expect(result.missingRates).toEqual(["WHATSAPP_UTILITY", "SMS_SEGMENT"]);
  });

  it("goes below zero when a Business costs more than its price", () => {
    const loud = calculate({ use: use(1, { BOOKING: [0, 30] }), rates: RATES, plans: PLANS, share: null });
    expect(loud.margins[0]?.margin).toBeLessThan(0);
  });

  it("has no margin to divide by on a free Plan, rather than dividing by zero", () => {
    const result = calculate({
      use: AVERAGE,
      rates: RATES,
      plans: [{ plan: "SOLO", price: money(0), allowance: 9 }],
      share: null,
    });
    expect(result.margins[0]?.margin).toBe(0);
  });
});

describe("checkCalculatorUse", () => {
  it("takes whole counts from zero and whole calendars from one", () => {
    expect(checkCalculatorUse(AVERAGE)).toEqual(AVERAGE);
    expect(checkCalculatorUse(use(1, {}))).toEqual(use(1, {}));
  });

  it("refuses a fraction, a negative, an absurd count, or no calendar", () => {
    expect(() => checkCalculatorUse(use(0, {}))).toThrow(/Calendars/);
    expect(() => checkCalculatorUse(use(101, {}))).toThrow(/Calendars/);
    expect(() => checkCalculatorUse(use(1.5, {}))).toThrow(/Calendars/);
    expect(() => checkCalculatorUse(use(1, { BOOKING: [-1, 0] }))).toThrow(/count/);
    expect(() => checkCalculatorUse(use(1, { REMINDERS: [0, 2.5] }))).toThrow(/count/);
    expect(() => checkCalculatorUse(use(1, { BILLING: [1_000_001, 0] }))).toThrow(/count/);
  });

  it("names the field that was wrong", () => {
    try {
      checkCalculatorUse(use(1, { WAITING_LIST: [0, -3] }));
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ details: { field: "WAITING_LIST.sms" } });
    }
  });
});

describe("saved Businesses", () => {
  const saved = [
    { id: asId<"ReferenceBusiness">("medium") as ReferenceBusinessId, name: "בינוני" },
    { id: asId<"ReferenceBusiness">("busy") as ReferenceBusinessId, name: "Busy" },
  ];

  it("takes a trimmed name of 2 to 30 characters", () => {
    expect(checkReferenceName("  מספרה עם 3 כיסאות ", saved)).toBe("מספרה עם 3 כיסאות");
    expect(() => checkReferenceName(" א ", saved)).toThrow(/2 to 30/);
    expect(() => checkReferenceName("x".repeat(31), saved)).toThrow(/2 to 30/);
  });

  it("refuses another's name in any case, but lets one keep its own", () => {
    expect(() => checkReferenceName("בינוני", saved)).toThrow(/Another/);
    expect(() => checkReferenceName(" busy ", saved)).toThrow(/Another/);
    expect(checkReferenceName("busy", saved, saved[1]?.id ?? null)).toBe("busy");
  });

  it("keeps room for eight", () => {
    expect(() => checkReferenceRoom(MAX_REFERENCE_BUSINESSES - 1)).not.toThrow();
    expect(() => checkReferenceRoom(MAX_REFERENCE_BUSINESSES)).toThrow(/At most 8/);
  });
});

describe("measured examples", () => {
  const shop = asId<"Business">("shop") as BusinessId;
  const rates: UnitRate[] = [
    { unit: "WHATSAPP_UTILITY", effectiveFrom: parseLocalDate("2026-09-01"), perUnit: microShekels(1), source: "card" },
    { unit: "SMS_SEGMENT", effectiveFrom: parseLocalDate("2026-09-01"), perUnit: microShekels(1), source: "card" },
  ];
  const line = (source: UsageDay["source"], unit: CostUnit, quantity: number, messages: number): UsageDay => ({
    businessId: shop,
    source,
    unit,
    day: parseLocalDate("2026-09-10"),
    quantity,
    messages,
  });

  it("reads one Business's month as WhatsApp messages and SMS messages per cause", () => {
    const usage = costOfUsage(
      [
        line("BOOKING", "WHATSAPP_UTILITY", 40, 40),
        line("BOOKING", "SMS_SEGMENT", 6, 3),
        line("WAITING_LIST", "WHATSAPP_UTILITY", 2, 2),
        line("CUSTOMER_HISTORY", "WHATSAPP_UTILITY", 99, 99),
      ],
      rates,
    );
    expect(useOf(usage, 3)).toEqual(use(3, { BOOKING: [40, 3], WAITING_LIST: [2, 0] }));
    expect(useOf(NO_USAGE_COST, 0).calendars).toBe(1);
  });

  it("averages several to whole numbers, and has nothing to average with none", () => {
    expect(averageUse([use(1, { BOOKING: [10, 1] }), use(2, { BOOKING: [15, 2] })])).toEqual(
      use(2, { BOOKING: [13, 2] }),
    );
    expect(averageUse([])).toBeNull();
  });

  it("measures parts per SMS, and falls back to two when no SMS went out", () => {
    const usage = costOfUsage([line("BOOKING", "SMS_SEGMENT", 7, 3)], rates);
    expect(partsPerSmsOf([usage])).toBe(2.3);
    expect(partsPerSmsOf([NO_USAGE_COST])).toBe(DEFAULT_PARTS_PER_SMS);
    expect(partsPerSmsOf([])).toBe(DEFAULT_PARTS_PER_SMS);
  });
});
