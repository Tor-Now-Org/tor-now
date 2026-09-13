import { daysBetween, graceEndsOn, parseLocalDate } from "@tor-now/domain";
import { localDateOf } from "@/components/owner/day-filter.ts";

/** Days remaining in the Grace Period, in the Business's own timezone. */
export const graceDaysLeft = (paidThrough: string, timeZone: string): number =>
  daysBetween(
    parseLocalDate(localDateOf(new Date().toISOString(), timeZone)),
    graceEndsOn({ paidThrough: parseLocalDate(paidThrough) }),
  );
