import { mergedRanges, type TimeRange } from "@tor-now/domain";
import type { DayHours } from "./weekly-hours.tsx";

/**
 * "Most days, nine to five" is how a person describes a week, and it is not
 * something the store knows: ADR 0002 holds ranges per weekday and nothing
 * above them. So the usual is worked out from the week itself — the largest set
 * of open days that keep identical hours — and everything else is an exception.
 *
 * Inferring it costs this file. The alternative is asking every owner to
 * describe seven days one at a time, which is the screen this replaces.
 */
export type UsualWeek = {
  /** The days keeping these hours. Empty when the business is shut all week. */
  readonly days: readonly number[];
  readonly ranges: readonly TimeRange[];
};

const DAYS_IN_A_WEEK = 7;

/** Two days are "the same" when their stored ranges are, so it compares those. */
const shapeOf = (day: DayHours): string =>
  mergedRanges(day.ranges)
    .map((range) => `${range.start}-${range.end}`)
    .join(",");

/**
 * The hours most days share.
 *
 * `apart` are days the owner has deliberately pulled out during this edit. A
 * day whose hours happen to match the usual would otherwise be swallowed back
 * into it the moment it did, which reads as the screen undoing the tap.
 *
 * Ties go to the group holding the earliest day, so the answer does not move
 * about while somebody is editing.
 */
export const usualOf = (
  week: readonly DayHours[],
  apart: readonly number[] = [],
): UsualWeek => {
  const candidates = week
    .map((day, dayOfWeek) => ({ day, dayOfWeek }))
    .filter(({ day, dayOfWeek }) => day.open && !apart.includes(dayOfWeek));

  const groups = new Map<string, number[]>();
  for (const { day, dayOfWeek } of candidates) {
    const shape = shapeOf(day);
    groups.set(shape, [...(groups.get(shape) ?? []), dayOfWeek]);
  }

  const best = [...groups.values()].reduce<number[] | null>(
    (winner, days) =>
      winner === null ||
      days.length > winner.length ||
      (days.length === winner.length && (days[0] ?? 0) < (winner[0] ?? 0))
        ? days
        : winner,
    null,
  );

  if (best === null) return { days: [], ranges: [] };
  // Grouped on the merged shape, but handed back exactly as typed: merging here
  // would collapse two stretches into one under the hand editing them, and the
  // row a person was halfway through would disappear. The store merges.
  const first = week[best[0] ?? 0];
  return { days: best, ranges: first === undefined ? [] : first.ranges };
};

/** Every day that is not on the usual, in the order of the week. */
export const exceptionsTo = (usual: UsualWeek): number[] =>
  Array.from({ length: DAYS_IN_A_WEEK }, (_unused, day) => day).filter(
    (day) => !usual.days.includes(day),
  );

/**
 * A time the browser will hand back mid-edit.
 *
 * A native time field is empty until both halves are set, and reports that as
 * "". Everything downstream — sorting, the bar, the gap between two stretches —
 * reads a clock as two numbers, so the half-typed state has to be a state the
 * screen knows about rather than a NaN it renders.
 */
export const isClock = (value: string): boolean => /^\d{2}:\d{2}$/.test(value);

/** A stretch that could be stored: two real times, the second after the first. */
export const isUsable = (range: TimeRange): boolean =>
  isClock(range.start) && isClock(range.end) && range.start < range.end;

/**
 * Whether the week could be saved as it stands. An open day with a half-typed
 * stretch would otherwise be written as a day with fewer hours than it has,
 * silently, because merging drops what it cannot read.
 */
export const weekIsUsable = (week: readonly DayHours[]): boolean =>
  week.every((day) => !day.open || day.ranges.every(isUsable));

/**
 * The gap between two stretches — which is all a break has ever been. Absent
 * when they touch or collide, since there is nothing between them to name.
 */
export const breakBetween = (
  ranges: readonly TimeRange[],
  position: number,
): TimeRange | null => {
  const before = ranges[position - 1];
  const after = ranges[position];
  if (before === undefined || after === undefined) return null;
  if (!isUsable(before) || !isUsable(after)) return null;
  return after.start > before.end ? { start: before.end, end: after.start } : null;
};

/** Whether a stretch runs into the one before it, and will be stored as one. */
export const collidesWithPrevious = (
  ranges: readonly TimeRange[],
  position: number,
): boolean => {
  const before = ranges[position - 1];
  const after = ranges[position];
  if (before === undefined || after === undefined) return false;
  if (!isUsable(before) || !isUsable(after)) return false;
  return after.start <= before.end;
};
