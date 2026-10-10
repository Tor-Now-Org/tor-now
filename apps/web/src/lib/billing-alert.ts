import {
  daysBetween,
  formatLocalTime,
  instant,
  nextDeactivationRun,
  parseLocalDate,
  timeZone,
} from "@tor-now/domain";
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

/**
 * When the nightly run turns a lapsed Business off, on its own clock: the date
 * and time, and whether that is tomorrow rather than later today.
 */
export const deactivationDeadline = (
  zone: string,
  now: Date = new Date(),
): { date: string; tomorrow: boolean; time: string } => {
  const run = nextDeactivationRun(instant(now.getTime()), timeZone(zone));
  return { date: run.date, tomorrow: run.date !== localDateOf(now.toISOString(), zone), time: formatLocalTime(run.time) };
};

/** How close a Trial's end has to be before the banner above every tab asks for payment. */
export const PAY_SOON_DAYS = 3;

/**
 * Which sentence the banner above every tab says: while a Business is lapsed
 * and still on, in its Grace Period, or in the last days of its Trial; null
 * otherwise. No Trial at all means its owner used it on an earlier Business.
 * `daysLeft` is `daysUntil` the Standing's date, null when it has none.
 */
export const payTodayNote = (
  billing: { status: string; subscription: { trialEndsOn: string | null } },
  daysLeft: number | null,
): "lapsedSoonNote" | "lapsedSoonPaidNote" | "trialEndingNote" | "inGraceNote" | null => {
  if (billing.status === "LAPSED") {
    return billing.subscription.trialEndsOn === null ? "lapsedSoonNote" : "lapsedSoonPaidNote";
  }
  if (billing.status === "IN_GRACE") return "inGraceNote";
  if (billing.status === "TRIAL" && daysLeft !== null && daysLeft >= 0 && daysLeft <= PAY_SOON_DAYS) {
    return "trialEndingNote";
  }
  return null;
};
