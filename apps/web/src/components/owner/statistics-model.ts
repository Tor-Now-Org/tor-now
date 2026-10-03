import type { StatisticsDto } from "@/lib/api/types.ts";
import { shiftMonth } from "./month-model.ts";

/**
 * The statistics screen's own arithmetic, kept out of the component so it can
 * be checked without a browser. The figures themselves come from the API.
 */

/** The month the address asks for (`?month=2026-09`), or the fallback when it asks for none or nonsense. */
export const monthAsked = (asked: string | null, fallback: string): string =>
  asked !== null && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? `${asked}-01` : fallback;

/** Every month from the last back to the first, newest first, as the month list offers them. */
export const monthsBetween = (first: string, last: string): string[] => {
  const months: string[] = [];
  for (let at = last; at >= first; at = shiftMonth(at, -1)) months.push(at);
  return months;
};

export type Change =
  | { readonly kind: "none" }
  | { readonly kind: "same" }
  | { readonly kind: "up" | "down"; readonly amount: number };

/**
 * How a figure moved since last month: a rate in points, a count in percent.
 * From nothing to something is shown as a full hundred percent rather than
 * infinity. Less than one percent, or half a point, reads as no change.
 */
export const changeOf = (now: number | null, before: number | null, points: boolean): Change => {
  if (now === null || before === null) return { kind: "none" };
  const change = points
    ? (now - before) * 100
    : before === 0
      ? now === 0 ? 0 : 100
      : ((now - before) / before) * 100;
  if (Math.abs(change) < (points ? 0.5 : 1)) return { kind: "same" };
  return { kind: change > 0 ? "up" : "down", amount: Math.round(Math.abs(change)) };
};

/** The day with the most completed appointments, or null while there is none. */
export const busiestDay = (days: StatisticsDto["days"]): StatisticsDto["days"][number] | null => {
  const best = days.reduce<StatisticsDto["days"][number] | null>(
    (leader, day) => (leader === null || day.completed > leader.completed ? day : leader),
    null,
  );
  return best === null || best.completed === 0 ? null : best;
};

/** The share booked a day ahead or less — the first two lead-time buckets — or null with nothing booked. */
export const bookedAtShortNotice = (leadTime: readonly number[]): number | null => {
  const total = leadTime.reduce((sum, count) => sum + count, 0);
  return total === 0 ? null : ((leadTime[0] ?? 0) + (leadTime[1] ?? 0)) / total;
};

/**
 * While a month is still running it is set against the same days of the one
 * before, cut short at that month's last day. This names both stretches —
 * "1–3 October" and "1–3 September" — or gives null once the month is over.
 */
export const daysCompared = (
  month: string,
  today: string,
  locale: string,
): { readonly now: string; readonly before: string } | null => {
  if (!today.startsWith(month.slice(0, 7))) return null;
  const [year, number] = month.split("-").map(Number) as [number, number];
  const day = Number(today.slice(8, 10));
  const format = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" });
  const days = (index: number, last: number) =>
    format.formatRange(new Date(Date.UTC(year, index, 1, 12)), new Date(Date.UTC(year, index, last, 12)));
  const previousLast = new Date(Date.UTC(year, number - 1, 0)).getUTCDate();
  return { now: days(number - 1, day), before: days(number - 2, Math.min(day, previousLast)) };
};
