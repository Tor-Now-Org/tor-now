import { describe, expect, it } from "vitest";
import type { UnitRateDto } from "@/lib/api/types.ts";
import { rateOnDay } from "./unit-rates.ts";

const rate = (effectiveFrom: string, microShekels: number): UnitRateDto => ({
  unit: "WHATSAPP_UTILITY",
  effectiveFrom,
  microShekels,
  source: "Default",
  checkedBy: null,
  enteredAt: "2026-09-01T00:00:00.000Z",
});

describe("rateOnDay", () => {
  const rates = [rate("2026-09-01", 19_610), rate("2026-09-15", 21_000), rate("2026-12-01", 22_000)];

  it("is the latest rate that had started by the day", () => {
    expect(rateOnDay(rates, "WHATSAPP_UTILITY", "2026-09-27")?.microShekels).toBe(21_000);
    expect(rateOnDay(rates, "WHATSAPP_UTILITY", "2026-09-15")?.microShekels).toBe(21_000);
    expect(rateOnDay(rates, "WHATSAPP_UTILITY", "2026-09-14")?.microShekels).toBe(19_610);
  });

  it("is nothing before the first rate, or for another unit", () => {
    expect(rateOnDay(rates, "WHATSAPP_UTILITY", "2026-08-31")).toBeNull();
    expect(rateOnDay(rates, "SMS_SEGMENT", "2026-09-27")).toBeNull();
  });
});
