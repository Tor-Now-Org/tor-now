import { mergedRanges, type TimeRange } from "@tor-now/domain";

/**
 * The week as the editor holds it, and the two translations between it and what
 * ADR 0002 stores.
 *
 * Pure, and in its own file for it: this is the part with rules in it — what a
 * day means, and what gets written for it — and it was living inside a React
 * component where no test could reach it. The bug that cost the whole week its
 * days was in these fifteen lines.
 */

/**
 * A day, as a person describes it: open or not, and the stretches it is open
 * for. ADR 0002 has no break entity — a break is the gap between two ranges —
 * so a day that shuts for lunch simply has two of them, and a day with three
 * stretches is no harder to say than a day with two.
 */
export type DayHours = {
  open: boolean;
  ranges: TimeRange[];
};

/** A stored range, as the API sends and receives it. */
export type StoredRange = { dayOfWeek: number; start: string; end: string };

export const DEFAULT_OPENING = { start: "09:00", end: "17:00" };
export const DEFAULT_OPEN_DAYS = [0, 1, 2, 3, 4];
const DAYS_IN_A_WEEK = 7;

export const emptyWeek = (): DayHours[] =>
  Array.from({ length: DAYS_IN_A_WEEK }, (_unused, day) => ({
    open: DEFAULT_OPEN_DAYS.includes(day),
    ranges: [{ start: DEFAULT_OPENING.start, end: DEFAULT_OPENING.end }],
  }));

/**
 * The ranges ADR 0002 stores, from the day a person described — merged, so two
 * that overlap or touch are stored as the one stretch they describe rather than
 * as a break of no length.
 */
export const rangesFor = (day: DayHours, dayOfWeek: number): StoredRange[] =>
  day.open
    ? // Built field by field rather than by spreading the range over the day.
      // The ranges that come back from the API carry a dayOfWeek of their own,
      // `mergedRanges` hands untouched ranges straight back, and a spread let
      // that stale day win — so once the usual copied one day's stretches to
      // every day on it, the whole week was written to Sunday.
      mergedRanges(day.ranges).map((range) => ({
        dayOfWeek,
        start: range.start,
        end: range.end,
      }))
    : [];

/** The inverse, for a week that already exists, tidied on the way in. */
export const weekFromRanges = (ranges: readonly StoredRange[]): DayHours[] =>
  Array.from({ length: DAYS_IN_A_WEEK }, (_unused, dayOfWeek) => {
    // Stripped to the two fields a stretch is, so nothing the API sent travels
    // back out with it.
    const onThisDay = mergedRanges(
      ranges
        .filter((range) => range.dayOfWeek === dayOfWeek)
        .map((range) => ({ start: range.start, end: range.end })),
    );
    return onThisDay.length === 0
      ? {
          open: false,
          ranges: [{ start: DEFAULT_OPENING.start, end: DEFAULT_OPENING.end }],
        }
      : { open: true, ranges: onThisDay };
  });
