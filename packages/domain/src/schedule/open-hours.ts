import type { DateOverride, WorkingHours } from "../model/schedule.ts";
import { interval, normalize, type Interval } from "../time/interval.ts";
import { dayOfWeekOf, type LocalDate } from "../time/local-date.ts";
import type { LocalTime } from "../time/local-time.ts";

export type LocalInterval = Interval<LocalTime>;

/**
 * Layers one and two of ADR 0002, resolved for a single date.
 *
 * An Override for the date *replaces* that weekday's recurring rows entirely,
 * rather than adding to them — which is what lets "closed on this date" be
 * expressed as an Override carrying no ranges, with no separate mechanism.
 */
export const openIntervalsOn = (
  date: LocalDate,
  workingHours: readonly WorkingHours[],
  overrides: readonly DateOverride[],
): LocalInterval[] => {
  const overrideForDate = overrides.find(
    (candidate) => candidate.date === date,
  );

  if (overrideForDate !== undefined) {
    return normalize(
      overrideForDate.ranges.map((range) => interval(range.start, range.end)),
    );
  }

  const weekday = dayOfWeekOf(date);
  return normalize(
    workingHours
      .filter((hours) => hours.dayOfWeek === weekday)
      .map((hours) => interval(hours.start, hours.end)),
  );
};

/**
 * The gaps between a date's open intervals — the Resource's breaks. Derived,
 * never stored: ADR 0002 has no break entity.
 */
export const breaksOn = (open: readonly LocalInterval[]): LocalInterval[] =>
  open
    .slice(1)
    .map((range, index) => {
      const previous = open[index];
      /* istanbul ignore next -- index is always in range for a sliced tail */
      if (previous === undefined) return null;
      return interval(previous.end, range.start);
    })
    .filter((gap): gap is LocalInterval => gap !== null && gap.end > gap.start);
