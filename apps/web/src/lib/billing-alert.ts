import { daysBetween, parseLocalDate } from "@tor-now/domain";
import { localDateOf } from "@/components/owner/day-filter.ts";

/**
 * Days from the Business's own today to a billing date — a Trial's end, the
 * last day of grace. Negative once it has passed.
 */
export const daysUntil = (localDate: string, timeZone: string): number =>
  daysBetween(
    parseLocalDate(localDateOf(new Date().toISOString(), timeZone)),
    parseLocalDate(localDate),
  );
