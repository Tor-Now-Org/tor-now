import { mergedRanges, type TimeRange } from "@tor-now/domain";
import type { ChangeDto } from "@/lib/api/types.ts";
import { formatLocalDate } from "@/lib/format.ts";
import { isUsable } from "./usual-week.ts";
import type { DayHours } from "./week.ts";

/**
 * The schedule's rules, apart from the screen: what "add a break" does to a
 * day, when the week on screen differs from the one saved, how a day that
 * differs is said in its row, and which changes each view lists.
 */

/**
 * Once this many worked days go their own way, "most days" has stopped being
 * true. Days off do not count: a business open two days a week has five days
 * that differ from its usual, and nothing about that is hard to read.
 */
export const TOO_MANY_EXCEPTIONS = 4;

/** Past this many changes, the list is split by month. */
export const CHANGE_MONTHS_FROM = 13;

/** A break is an hour unless the stretch is too short to hold one. */
const BREAK_MINUTES = 60;
/** A new stretch after the last starts an hour after it, so it lands as a break. */
const AFTER_THE_LAST = 60;
/** How long a new stretch after the last one runs. */
const NEW_STRETCH = 120;
const LAST_START = 23 * 60;
/** The last minute a time field can hold: it has no 24:00. */
const LAST_MINUTE = 24 * 60 - 1;

const minutesOf = (clock: string): number => {
  const [hour, minute] = clock.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
};

const clockOf = (minutes: number): string => {
  const held = Math.max(0, Math.min(LAST_MINUTE, Math.round(minutes)));
  return `${String(Math.floor(held / 60)).padStart(2, "0")}:${String(held % 60).padStart(2, "0")}`;
};

/**
 * The day with a break in it.
 *
 * A break is cut out of the longest stretch, an hour on the hour nearest its
 * middle, because that is what "a lunch break" means to the person tapping.
 * A day whose stretches are all too short for one — or a half-typed day —
 * gets a new stretch after the last instead, which still leaves a break
 * between the two.
 */
export const withBreak = (ranges: readonly TimeRange[]): TimeRange[] => {
  const copies = ranges.map((range) => ({ ...range }));
  const usable = copies.length > 0 && copies.every(isUsable);
  if (usable) {
    const longest = copies.reduce((best, range, index) =>
      minutesOf(range.end) - minutesOf(range.start) > minutesOf(copies[best]!.end) - minutesOf(copies[best]!.start) ? index : best,
    0);
    const stretch = copies[longest]!;
    const start = minutesOf(stretch.start);
    const end = minutesOf(stretch.end);
    const breakStart = Math.floor((start + end - BREAK_MINUTES) / 2 / 60) * 60;
    if (breakStart > start && breakStart + BREAK_MINUTES < end) {
      return [
        ...copies.slice(0, longest),
        { start: stretch.start, end: clockOf(breakStart) },
        { start: clockOf(breakStart + BREAK_MINUTES), end: stretch.end },
        ...copies.slice(longest + 1),
      ];
    }
  }
  const last = copies[copies.length - 1];
  const from = last === undefined || !isUsable(last) ? minutesOf("09:00") : Math.min(minutesOf(last.end) + AFTER_THE_LAST, LAST_START);
  return [...copies, { start: clockOf(from), end: clockOf(Math.min(from + NEW_STRETCH, LAST_MINUTE)) }];
};

/**
 * What a stretch that runs into the one before it will be saved as: the two
 * merged, said with the hours, so "saved as one" names the one.
 */
export const mergedWithPrevious = (ranges: readonly TimeRange[], position: number): TimeRange | null => {
  const before = ranges[position - 1];
  const after = ranges[position];
  if (before === undefined || after === undefined || !isUsable(before) || !isUsable(after)) return null;
  if (after.start > before.end) return null;
  return { start: before.start < after.start ? before.start : after.start, end: before.end > after.end ? before.end : after.end };
};

/** The week as it would be written, half-typed times included, to compare two weeks by. */
const weekKey = (week: readonly DayHours[]): string =>
  week.map((day) => (day.open ? day.ranges.map((range) => `${range.start}-${range.end}`).join(",") : "off")).join("|");

/** Whether the week on screen is not the week that was saved. */
export const weekDiffers = (edited: readonly DayHours[], saved: readonly DayHours[]): boolean => weekKey(edited) !== weekKey(saved);

/** A week the save button may write: complete times, and at least one day worked. */
export const weekIsSaveable = (week: readonly DayHours[]): boolean =>
  week.some((day) => day.open) &&
  week.every((day) => !day.open || (day.ranges.length > 0 && day.ranges.every(isUsable)));

/** Whether the days that differ are most of the week, so the week reads better day by day. */
export const tooManyDiffer = (week: readonly DayHours[], exceptions: readonly number[]): boolean =>
  exceptions.filter((day) => week[day]?.open === true).length >= TOO_MANY_EXCEPTIONS;

/** Whether nobody works on any day yet: the week that was never set. */
export const nothingSet = (week: readonly DayHours[]): boolean => week.every((day) => !day.open);

export type DayLine =
  | { readonly kind: "off" }
  | { readonly kind: "hours"; readonly text: string; readonly incomplete: boolean };

/** A day as its row says it: not worked, or its hours, merged, with a half-typed one flagged. */
export const dayLineOf = (day: DayHours): DayLine => {
  if (!day.open) return { kind: "off" };
  const usable = day.ranges.filter(isUsable);
  return {
    kind: "hours",
    text: mergedRanges(usable).map((range) => `${range.start}–${range.end}`).join(", "),
    incomplete: usable.length !== day.ranges.length || day.ranges.length === 0,
  };
};

/** Whose changes are on screen: the whole business, or one calendar. */
export type ChangeView = { readonly kind: "BUSINESS" } | { readonly kind: "CALENDAR"; readonly resourceId: string };

/**
 * The changes one view lists, in date order. The business's view has its own;
 * a calendar's has its own and the business's, since both change its hours.
 */
export const changesIn = (changes: readonly ChangeDto[], view: ChangeView): ChangeDto[] =>
  changes
    .filter((change) =>
      view.kind === "BUSINESS"
        ? change.scope.kind === "BUSINESS"
        : change.scope.kind === "BUSINESS" || change.scope.resourceId === view.resourceId,
    )
    .sort((left, right) => left.fromDate.localeCompare(right.fromDate) || left.id.localeCompare(right.id));

/** The month a change starts in, for the heading over it once the list is long. */
export const changeMonth = (change: Pick<ChangeDto, "fromDate">, language: "he" | "en"): string =>
  formatLocalDate(change.fromDate, language, { month: "long", year: "numeric" });

/** The date block at the start of a change's row: the day large, the month small under it. */
export const dateBlockOf = (date: string, language: "he" | "en") => ({
  day: String(Number(date.slice(8, 10))),
  month: formatLocalDate(date, language, { month: "short" }),
});

/** Whether a change in a calendar's view is the business's, and so marked and edited elsewhere. */
export const isBusinessIn = (change: Pick<ChangeDto, "scope">, view: ChangeView): boolean =>
  view.kind === "CALENDAR" && change.scope.kind === "BUSINESS";
