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
export const deactivationDeadline = (zone: string): { date: string; tomorrow: boolean; time: string } => {
  const now = new Date();
  const run = nextDeactivationRun(instant(now.getTime()), timeZone(zone));
  return { date: run.date, tomorrow: run.date !== localDateOf(now.toISOString(), zone), time: formatLocalTime(run.time) };
};
