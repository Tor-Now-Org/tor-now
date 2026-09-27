import { addDays, daysBetween, MAX_GRANT_DAYS, parseLocalDate } from "@tor-now/domain";

/**
 * How long a Grant runs, as the administrator picks it: a quick length, or a
 * day of their own, never more than a year ahead (ADR 0021). Days are the
 * Business's own, as YYYY-MM-DD.
 */
export const GRANT_LENGTHS = [30, 60, 90] as const;

/** The last day of a Grant that runs `days` from today. */
export const endsAfter = (today: string, days: number): string => addDays(parseLocalDate(today), days);

/** The latest day a Grant may run to. */
export const latestGrantEnd = (today: string): string => endsAfter(today, MAX_GRANT_DAYS);

/** Days from today to a Grant's last day; zero on the day itself. */
export const daysLeft = (today: string, endsOn: string): number =>
  daysBetween(parseLocalDate(today), parseLocalDate(endsOn));

/** Close enough to its end to be marked, as the owner's reminder is. */
export const isEndingSoon = (today: string, endsOn: string): boolean => daysLeft(today, endsOn) <= 7;

/**
 * A day typed or picked for a Grant, if it is one it may end on: today or
 * later, and within the year.
 */
export const isGrantEnd = (today: string, endsOn: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) return false;
  const left = daysLeft(today, endsOn);
  return left >= 0 && left <= MAX_GRANT_DAYS;
};
