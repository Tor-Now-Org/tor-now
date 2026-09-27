import type { CostUnitName, UnitRateDto } from "@/lib/api/types.ts";

/**
 * The rate in force for a unit on a day: the latest that had started — the
 * same rule the server prices usage by (ADR 0022). Days are YYYY-MM-DD, which
 * order as text.
 */
export const rateOnDay = (rates: readonly UnitRateDto[], unit: CostUnitName, day: string): UnitRateDto | null =>
  rates
    .filter((rate) => rate.unit === unit && rate.effectiveFrom <= day)
    .reduce<UnitRateDto | null>(
      (latest, rate) => (latest === null || rate.effectiveFrom > latest.effectiveFrom ? rate : latest),
      null,
    );
