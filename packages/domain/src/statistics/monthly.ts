import type { Appointment } from "../model/appointment.ts";
import type { ResourceId, UserId } from "../model/ids.ts";
import type { BlockedSpan, DateOverride, WorkingHours } from "../model/schedule.ts";
import { outcomeOf } from "../booking/outcome.ts";
import { freeIntervalsOn } from "../booking/free-intervals.ts";
import type { Instant } from "../time/instant.ts";
import { interval, totalDuration } from "../time/interval.ts";
import {
  addDays,
  compareLocalDate,
  datesBetween,
  daysBetween,
  monthStartOf,
  nextMonthStartOf,
  type LocalDate,
} from "../time/local-date.ts";
import { MIDNIGHT } from "../time/local-time.ts";
import { instantToZoned, todayIn, zonedToInstant, type TimeZone } from "../time/zone.ts";

/**
 * A Business's month in numbers, for its owner (the Statistics Feature).
 *
 * Pure: everything the month needs is handed in, `now` included, so the same
 * appointments always give the same page. Finished and Upcoming come from
 * `outcomeOf` — the one place that decides it — so an Appointment is never
 * counted as both.
 */

/** One calendar as utilization needs it: when it was open, and when it was blocked. */
export type StatisticsCalendar = {
  readonly id: ResourceId;
  readonly name: string;
  readonly workingHours: readonly WorkingHours[];
  readonly overrides: readonly DateOverride[];
  readonly blocks: readonly BlockedSpan[];
};

/** A customer's first attended Appointment with the Business, wherever it falls. */
export type FirstVisit = {
  readonly customerId: UserId;
  readonly resourceId: ResourceId;
  readonly firstAt: Instant;
};

export type StatisticsInput = {
  /** The first of the month being shown. */
  readonly month: LocalDate;
  /** The first of the month the Business opened; nothing earlier is shown. */
  readonly firstMonth: LocalDate;
  readonly timeZone: TimeZone;
  readonly now: Instant;
  /** Every Appointment starting from the first trend month to the end of `month`. */
  readonly appointments: readonly Appointment[];
  readonly calendars: readonly StatisticsCalendar[];
  /** First visits that fall anywhere in the same span as `appointments`. */
  readonly firstVisits: readonly FirstVisit[];
  /** One calendar only, or null for the whole Business. */
  readonly resourceId: ResourceId | null;
};

export type StatisticsTotals = {
  /** Minor units, from the price each completed Appointment was booked at. */
  readonly revenue: number;
  readonly completed: number;
  /** Booked time ÷ open time, 0–1; null when nothing was open yet. */
  readonly utilization: number | null;
  readonly newCustomers: number;
};

export type MonthlyStatistics = {
  readonly month: LocalDate;
  readonly firstMonth: LocalDate;
  /** The month `now` falls in; the stepper goes no further. */
  readonly currentMonth: LocalDate;
  readonly totals: StatisticsTotals;
  /**
   * The month before, over the same stretch: while a month is still running it
   * is compared with the same days of the previous one. Null before the
   * Business opened.
   */
  readonly previous: StatisticsTotals | null;
  /** Up to six months ending with this one, oldest first. */
  readonly trend: readonly { readonly month: LocalDate; readonly totals: StatisticsTotals }[];
  readonly days: readonly {
    readonly date: LocalDate;
    readonly completed: number;
    /** No Shows and cancellations, by anybody. */
    readonly lost: number;
    readonly upcoming: number;
    /** Whether any calendar shown was open that day. */
    readonly open: boolean;
  }[];
  readonly services: readonly { readonly name: string; readonly revenue: number; readonly completed: number }[];
  /** Per calendar; empty when one calendar is chosen. */
  readonly calendars: readonly {
    readonly resourceId: ResourceId;
    readonly name: string;
    readonly completed: number;
    readonly revenue: number;
    readonly noShows: number;
    readonly utilization: number | null;
  }[];
  readonly customers: {
    readonly seen: number;
    readonly returning: number;
    readonly new: number;
    readonly top: readonly { readonly customerId: UserId; readonly visits: number }[];
  };
  readonly outcomes: {
    readonly completed: number;
    readonly noShow: number;
    readonly lateCancellation: number;
    readonly cancelledOnTime: number;
    readonly cancelledByBusiness: number;
  };
  /** Customers who did not come, or cancelled late, more than once this month. */
  readonly repeatMisses: readonly { readonly customerId: UserId; readonly times: number }[];
  /** Counts for: same day, next day, 2–3, 4–7, 8–14, 15+ days ahead. */
  readonly leadTime: readonly number[];
};

export const TREND_MONTHS = 6;
const LISTED = 3;
const LEAD_BUCKETS: readonly (readonly [number, number])[] = [
  [0, 0], [1, 1], [2, 3], [4, 7], [8, 14], [15, Number.POSITIVE_INFINITY],
];
const MINUTE = 60_000;

/** The first month of the trend that ends with `month`, never before the Business opened. */
export const trendStartOf = (month: LocalDate, firstMonth: LocalDate): LocalDate => {
  let start = month;
  for (let step = 1; step < TREND_MONTHS; step++) {
    const earlier = previousMonthOf(start);
    if (compareLocalDate(earlier, firstMonth) < 0) break;
    start = earlier;
  }
  return start;
};

export const previousMonthOf = (month: LocalDate): LocalDate => monthStartOf(addDays(month, -1));

export const monthlyStatistics = (input: StatisticsInput): MonthlyStatistics => {
  const { timeZone, now } = input;
  const startOf = (date: LocalDate) => zonedToInstant(date, MIDNIGHT, timeZone);

  const shown = input.calendars.filter(
    (calendar) => input.resourceId === null || calendar.id === input.resourceId,
  );
  const mine = input.appointments.filter(
    (appointment) => input.resourceId === null || appointment.resourceId === input.resourceId,
  );
  const firstVisits = input.firstVisits.filter(
    (visit) => input.resourceId === null || visit.resourceId === input.resourceId,
  );

  const openMinutes = (calendars: readonly StatisticsCalendar[], from: Instant, to: Instant): number => {
    if (to <= from) return 0;
    const window = interval(from, to);
    const dates = datesBetween(
      instantToZoned(from, timeZone).date,
      instantToZoned(to, timeZone).date,
    );
    let total = 0;
    for (const calendar of calendars) {
      for (const date of dates) {
        total += totalDuration(
          freeIntervalsOn({
            date,
            timeZone,
            workingHours: calendar.workingHours,
            overrides: calendar.overrides,
            blocks: calendar.blocks,
            occupied: [],
            bufferMinutes: 0,
            window,
          }),
        );
      }
    }
    return total / MINUTE;
  };

  // ponytail: past months are measured against today's Working Hours; the
  // store keeps no history of them. Add hour history if owners change hours often.
  const totalsOf = (
    appointments: readonly Appointment[],
    calendars: readonly StatisticsCalendar[],
    from: Instant,
    to: Instant,
  ): StatisticsTotals => {
    const inside = appointments.filter((one) => one.startAt >= from && one.startAt < to);
    const finished = inside.filter((one) => outcomeOf(one, now) === "FINISHED");
    // Time that was held for somebody, whether or not they came.
    const booked = inside
      .filter((one) => outcomeOf(one, now) === "FINISHED" || (one.status === "NO_SHOW" && one.startAt < now))
      .reduce((sum, one) => sum + (one.occupiedUntil - one.startAt) / MINUTE, 0);
    const open = openMinutes(calendars, from, to < now ? to : now);
    const ids = new Set(calendars.map((calendar) => calendar.id));
    return {
      revenue: finished.reduce((sum, one) => sum + one.price, 0),
      completed: finished.length,
      utilization: open > 0 ? Math.min(1, booked / open) : null,
      newCustomers: firstVisits.filter(
        (visit) => visit.firstAt >= from && visit.firstAt < to && ids.has(visit.resourceId),
      ).length,
    };
  };

  const monthStart = startOf(input.month);
  const monthEnd = startOf(nextMonthStartOf(input.month));
  const totals = totalsOf(mine, shown, monthStart, monthEnd);

  const previousMonth = previousMonthOf(input.month);
  const previousStart = startOf(previousMonth);
  const previous =
    compareLocalDate(previousMonth, input.firstMonth) < 0
      ? null
      : totalsOf(
          mine,
          shown,
          previousStart,
          // A running month is set against the same stretch of the one before.
          now < monthEnd
            ? (Math.min(previousStart + Math.max(0, now - monthStart), monthStart) as Instant)
            : monthStart,
        );

  const trend: { month: LocalDate; totals: StatisticsTotals }[] = [];
  for (
    let month = trendStartOf(input.month, input.firstMonth);
    compareLocalDate(month, input.month) <= 0;
    month = nextMonthStartOf(month)
  ) {
    trend.push({
      month,
      totals:
        month === input.month ? totals : totalsOf(mine, shown, startOf(month), startOf(nextMonthStartOf(month))),
    });
  }

  const inMonth = mine.filter((one) => one.startAt >= monthStart && one.startAt < monthEnd);
  const outcome = (one: Appointment) => outcomeOf(one, now);
  const finished = inMonth.filter((one) => outcome(one) === "FINISHED");
  const noShows = inMonth.filter((one) => outcome(one) === "NO_SHOW");
  const cancelled = inMonth.filter((one) => outcome(one) === "CANCELLED");

  const dateOf = (at: Instant) => instantToZoned(at, timeZone).date;
  const days = datesBetween(input.month, addDays(nextMonthStartOf(input.month), -1)).map((date) => {
    const that = inMonth.filter((one) => dateOf(one.startAt) === date);
    return {
      date,
      completed: that.filter((one) => outcome(one) === "FINISHED").length,
      lost: that.filter((one) => outcome(one) === "NO_SHOW" || outcome(one) === "CANCELLED").length,
      upcoming: that.filter((one) => outcome(one) === "UPCOMING").length,
      open: openMinutes(shown, startOf(date), startOf(addDays(date, 1))) > 0,
    };
  });

  const byService = new Map<string, { name: string; revenue: number; completed: number }>();
  for (const one of finished) {
    const entry = byService.get(one.serviceName) ?? { name: one.serviceName, revenue: 0, completed: 0 };
    entry.revenue += one.price;
    entry.completed += 1;
    byService.set(one.serviceName, entry);
  }

  const calendars =
    input.resourceId !== null
      ? []
      : input.calendars.map((calendar) => {
          const theirs = inMonth.filter((one) => one.resourceId === calendar.id);
          const own = totalsOf(theirs, [calendar], monthStart, monthEnd);
          return {
            resourceId: calendar.id,
            name: calendar.name,
            completed: own.completed,
            revenue: own.revenue,
            noShows: theirs.filter((one) => outcome(one) === "NO_SHOW").length,
            utilization: own.utilization,
          };
        });

  const visits = countBy(finished.map((one) => one.customerId));
  const misses = countBy(
    [...noShows, ...cancelled.filter((one) => one.lateCancellation)].map((one) => one.customerId),
  );

  const leadTime = LEAD_BUCKETS.map(() => 0);
  for (const one of inMonth) {
    if (outcome(one) === "CANCELLED") continue;
    const ahead = daysBetween(dateOf(one.createdAt), dateOf(one.startAt));
    // Booked after the fact (an owner writing in a walk-in) counts as same day.
    const bucket = Math.max(0, LEAD_BUCKETS.findIndex(([low, high]) => ahead >= low && ahead <= high));
    leadTime[bucket] = (leadTime[bucket] ?? 0) + 1;
  }

  return {
    month: input.month,
    firstMonth: input.firstMonth,
    currentMonth: monthStartOf(todayIn(now, timeZone)),
    totals,
    previous,
    trend,
    days,
    services: [...byService.values()].sort((a, b) => b.revenue - a.revenue),
    calendars,
    customers: {
      seen: visits.size,
      new: totals.newCustomers,
      returning: Math.max(0, visits.size - totals.newCustomers),
      top: ranked(visits).slice(0, LISTED).map(([customerId, count]) => ({ customerId, visits: count })),
    },
    outcomes: {
      completed: finished.length,
      noShow: noShows.length,
      lateCancellation: cancelled.filter((one) => one.lateCancellation).length,
      cancelledOnTime: cancelled.filter((one) => one.cancelledBy === "CUSTOMER" && !one.lateCancellation).length,
      cancelledByBusiness: cancelled.filter((one) => one.cancelledBy === "BUSINESS").length,
    },
    repeatMisses: ranked(misses)
      .filter(([, times]) => times > 1)
      .slice(0, LISTED)
      .map(([customerId, times]) => ({ customerId, times })),
    leadTime,
  };
};

const countBy = <K>(keys: readonly K[]): Map<K, number> => {
  const counts = new Map<K, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
};

const ranked = <K>(counts: Map<K, number>): [K, number][] =>
  [...counts.entries()].sort((a, b) => b[1] - a[1]);

