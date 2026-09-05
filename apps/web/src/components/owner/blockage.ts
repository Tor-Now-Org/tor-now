import { mergedRanges, type TimeRange } from "@tor-now/domain";
import { addDaysTo, localToInstant } from "@/lib/format.ts";

/**
 * A blockage as the owner describes it, and the spans the store keeps.
 *
 * ADR 0002 knows one kind of block: an interval on a calendar. "I am away all
 * next week" and "keep an hour free every afternoon until the end of the month"
 * are both sentences about many intervals, and the screen used to make the
 * owner say each one separately — which is why nobody blocked a holiday, they
 * blocked Monday and gave up.
 *
 * Pure, so the arithmetic that turns one sentence into thirty intervals can be
 * read back in a test rather than in the browser.
 */
export type Blockage = {
  /** Both inclusive, and the same date for the ordinary one-day blockage. */
  readonly from: string;
  readonly to: string;
  readonly allDay: boolean;
  readonly ranges: readonly TimeRange[];
  readonly reason: string;
};

export type BlockSpan = { startAt: string; endAt: string; reason: string };

/** A whole day, as far as any calendar is concerned. */
const MIDNIGHT = "00:00";
const END_OF_DAY = "23:59";
/** Long enough for a sabbatical; short enough that a slip cannot fill a table. */
export const LONGEST_BLOCKAGE_IN_DAYS = 62;

const daysOf = (from: string, to: string): string[] => {
  const days: string[] = [];
  for (
    let day = from;
    day <= to && days.length < LONGEST_BLOCKAGE_IN_DAYS;
    day = addDaysTo(day, 1)
  ) {
    days.push(day);
  }
  return days;
};

/**
 * The intervals to create.
 *
 * A whole day is one span from midnight to midnight, and consecutive whole days
 * are still one span each rather than one long one: a holiday given back a day
 * at a time is the thing an owner actually asks for, and one interval per day
 * is what makes that possible.
 *
 * Hours are merged first, so two stretches an owner ran together become the one
 * they meant instead of two overlapping blocks.
 */
export const spansOf = (blockage: Blockage, timeZone: string): BlockSpan[] => {
  const days = daysOf(blockage.from, blockage.to);
  const hours = blockage.allDay
    ? [{ start: MIDNIGHT, end: END_OF_DAY }]
    : mergedRanges(blockage.ranges);

  return days.flatMap((day) =>
    hours.map((range) => ({
      startAt: localToInstant(day, range.start, timeZone),
      endAt: localToInstant(day, range.end, timeZone),
      reason: blockage.reason,
    })),
  );
};
