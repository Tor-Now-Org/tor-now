import type { ResourceId } from "../model/ids.ts";
import type { Block, DateOverride, LocalTimeRangeValue } from "../model/schedule.ts";
import { interval, normalize } from "../time/interval.ts";
import { addDays, compareLocalDate, parseLocalDate, type LocalDate } from "../time/local-date.ts";
import { END_OF_DAY, MIDNIGHT, type LocalTime } from "../time/local-time.ts";
import { instantToZoned, type TimeZone } from "../time/zone.ts";

/**
 * "שינוי ביומן": the one thing an owner changes about a day.
 *
 * Underneath there are still ADR 0002's layers — a Block carved out of a day,
 * an Override replacing a day's hours — and closing the business is still one
 * Override per calendar. Owners never thought in those terms: they knew a day
 * off, a break, or other hours, for one calendar or for the whole business.
 * So the records are read back as that, and nothing new is stored.
 *
 * - Blocks of one decision (a group) are a day off when every day of them is
 *   whole, part of the day otherwise; on more than one calendar they are the
 *   whole business's.
 * - A date on which every calendar on offer has the same Override is the
 *   business's: closed when it keeps no hours, other hours when it keeps some.
 * - Any other Override is that calendar's own, read the same way.
 * - Consecutive dates saying the same thing are one change.
 */

export const CHANGE_OUTCOMES = ["OFF_ALL_DAY", "OFF_PART", "OTHER_HOURS"] as const;
export type ChangeOutcome = (typeof CHANGE_OUTCOMES)[number];

export type ChangeScope =
  | { readonly kind: "BUSINESS" }
  | { readonly kind: "CALENDAR"; readonly resourceId: ResourceId };

export type ChangeDay = {
  readonly date: LocalDate;
  /** Hours taken off for OFF_PART, hours kept for OTHER_HOURS, none for OFF_ALL_DAY. */
  readonly ranges: readonly LocalTimeRangeValue[];
};

export type CalendarChange = {
  /** Names the records behind it; see `parseChangeId`. */
  readonly id: string;
  readonly scope: ChangeScope;
  readonly outcome: ChangeOutcome;
  readonly fromDate: LocalDate;
  readonly toDate: LocalDate;
  readonly days: readonly ChangeDay[];
  /** The hours when every day has the same ones, so it can be said once; null when they differ. */
  readonly ranges: readonly LocalTimeRangeValue[] | null;
  readonly note: string | null;
};

export type ChangeRef =
  | { readonly kind: "BLOCKS"; readonly groupId: string }
  | { readonly kind: "CLOSURE"; readonly fromDate: LocalDate; readonly toDate: LocalDate }
  | {
      readonly kind: "HOURS";
      readonly resourceId: ResourceId;
      readonly fromDate: LocalDate;
      readonly toDate: LocalDate;
    };

/** The longest change made at once: a year, which bounds what a list has to read around it. */
export const MAX_CHANGE_DAYS = 366;

/** A day kept free from its first minute to its last. */
export const wholeDayRange = (): LocalTimeRangeValue => ({ start: MIDNIGHT, end: END_OF_DAY });

/**
 * An all-day blockage was always written as midnight to 23:59, so a day counts
 * as whole from that minute on.
 */
const LAST_MINUTE = (END_OF_DAY - 1) as LocalTime;

const isWholeDay = (ranges: readonly LocalTimeRangeValue[]): boolean =>
  ranges.length === 1 && ranges[0]!.start === MIDNIGHT && ranges[0]!.end >= LAST_MINUTE;

const shapeOf = (ranges: readonly LocalTimeRangeValue[]): string =>
  ranges.map((range) => `${range.start}-${range.end}`).join(",");

const sameRanges = (days: readonly ChangeDay[]): readonly LocalTimeRangeValue[] | null => {
  const first = days[0]?.ranges ?? [];
  return days.every((day) => shapeOf(day.ranges) === shapeOf(first)) ? first : null;
};

const noteOf = (said: string | null | undefined): string | null => {
  const trimmed = said?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
};

const merged = (ranges: readonly LocalTimeRangeValue[]): LocalTimeRangeValue[] =>
  normalize(ranges.map((range) => interval(range.start, range.end))).map((range) => ({
    start: range.start,
    end: range.end,
  }));

/** One block, as the pieces of each local day it touches. */
const piecesOf = (block: Block, zone: TimeZone): ChangeDay[] => {
  const from = instantToZoned(block.startAt, zone);
  const to = instantToZoned(block.endAt, zone);
  const pieces: ChangeDay[] = [];
  for (let day = from.date; compareLocalDate(day, to.date) <= 0; day = addDays(day, 1)) {
    const start = day === from.date ? from.time : MIDNIGHT;
    const end = day === to.date ? to.time : END_OF_DAY;
    if (end > start) pieces.push({ date: day, ranges: [{ start, end }] });
  }
  return pieces;
};

const byDate = (left: { date: LocalDate }, right: { date: LocalDate }) =>
  compareLocalDate(left.date, right.date);

const fromBlocks = (
  blocks: readonly Block[],
  calendars: readonly ResourceId[],
  zone: TimeZone,
): CalendarChange[] => {
  const groups = new Map<string, Block[]>();
  for (const block of blocks) groups.set(block.groupId, [...(groups.get(block.groupId) ?? []), block]);

  return [...groups.entries()].map(([groupId, group]) => {
    const perDate = new Map<LocalDate, LocalTimeRangeValue[]>();
    for (const block of group) {
      for (const piece of piecesOf(block, zone)) {
        perDate.set(piece.date, [...(perDate.get(piece.date) ?? []), ...piece.ranges]);
      }
    }
    const pieces = [...perDate.entries()]
      .map(([date, ranges]) => ({ date, ranges: merged(ranges) }))
      .sort(byDate);
    const allDay = pieces.every((piece) => isWholeDay(piece.ranges));
    const days = allDay ? pieces.map((piece) => ({ date: piece.date, ranges: [] })) : pieces;
    const standingOn = [...new Set(group.map((block) => block.resourceId))];
    const scope: ChangeScope =
      standingOn.length > 1 && calendars.length > 1
        ? { kind: "BUSINESS" }
        : { kind: "CALENDAR", resourceId: standingOn[0]! };
    return {
      id: `blocks:${groupId}`,
      scope,
      outcome: allDay ? "OFF_ALL_DAY" : "OFF_PART",
      fromDate: days[0]!.date,
      toDate: days[days.length - 1]!.date,
      days,
      ranges: sameRanges(days),
      note: noteOf(group.find((block) => noteOf(block.reason) !== null)?.reason),
    } satisfies CalendarChange;
  });
};

type Said = { readonly date: LocalDate; readonly ranges: readonly LocalTimeRangeValue[]; readonly note: string | null };

/** Consecutive dates saying the same thing, as runs. */
const runsOf = (said: readonly Said[]): Said[][] => {
  const runs: Said[][] = [];
  for (const day of [...said].sort(byDate)) {
    const run = runs[runs.length - 1];
    const last = run?.[run.length - 1];
    const continues =
      last !== undefined &&
      addDays(last.date, 1) === day.date &&
      shapeOf(last.ranges) === shapeOf(day.ranges) &&
      last.note === day.note;
    if (continues) run!.push(day);
    else runs.push([day]);
  }
  return runs;
};

const changeOfRun = (run: readonly Said[], scope: ChangeScope, id: string): CalendarChange => {
  const days = run.map((day) => ({ date: day.date, ranges: merged(day.ranges) }));
  return {
    id,
    scope,
    outcome: days[0]!.ranges.length === 0 ? "OFF_ALL_DAY" : "OTHER_HOURS",
    fromDate: days[0]!.date,
    toDate: days[days.length - 1]!.date,
    days,
    ranges: sameRanges(days),
    note: run[0]!.note,
  };
};

const fromOverrides = (
  overrides: readonly DateOverride[],
  calendars: readonly ResourceId[],
): CalendarChange[] => {
  const onOffer = new Set(calendars);
  const kept = overrides.filter((override) => onOffer.has(override.resourceId));

  const perDate = new Map<LocalDate, DateOverride[]>();
  for (const override of kept) perDate.set(override.date, [...(perDate.get(override.date) ?? []), override]);

  // A business with one calendar has no "whole business" to speak of: its
  // calendar's day is simply its calendar's day.
  const businessDates = new Set(
    calendars.length < 2
      ? []
      : [...perDate.entries()]
          .filter(
            ([, said]) =>
              said.length === calendars.length &&
              new Set(said.map((override) => override.resourceId)).size === calendars.length &&
              new Set(said.map((override) => shapeOf(merged(override.ranges)))).size === 1,
          )
          .map(([date]) => date),
  );

  const shop = runsOf(
    [...businessDates].map((date) => {
      const said = perDate.get(date)!;
      const notes = new Set(said.map((override) => noteOf(override.note)));
      return {
        date,
        ranges: said[0]!.ranges,
        note: notes.size === 1 ? noteOf(said[0]!.note) : null,
      };
    }),
  ).map((run) =>
    changeOfRun(run, { kind: "BUSINESS" }, `closure:${run[0]!.date}:${run[run.length - 1]!.date}`),
  );

  const own = calendars.flatMap((resourceId) =>
    runsOf(
      kept
        .filter((override) => override.resourceId === resourceId && !businessDates.has(override.date))
        .map((override) => ({ date: override.date, ranges: override.ranges, note: noteOf(override.note) })),
    ).map((run) =>
      changeOfRun(
        run,
        { kind: "CALENDAR", resourceId },
        `hours:${resourceId}:${run[0]!.date}:${run[run.length - 1]!.date}`,
      ),
    ),
  );

  return [...shop, ...own];
};

const scopeRank = (scope: ChangeScope) => (scope.kind === "BUSINESS" ? 0 : 1);

/** Every change the records come to, in date order, the business's first on a day. */
export const classifyChanges = (input: {
  /** The calendars on offer, in the business's order. */
  readonly calendars: readonly ResourceId[];
  readonly overrides: readonly DateOverride[];
  readonly blocks: readonly Block[];
  readonly timeZone: TimeZone;
}): readonly CalendarChange[] =>
  [...fromBlocks(input.blocks, input.calendars, input.timeZone), ...fromOverrides(input.overrides, input.calendars)]
    .filter((change) => change.days.length > 0)
    .sort(
      (left, right) =>
        compareLocalDate(left.fromDate, right.fromDate) ||
        scopeRank(left.scope) - scopeRank(right.scope) ||
        left.id.localeCompare(right.id),
    );

/** Every date a change covers. */
export const changeDates = (change: CalendarChange): readonly LocalDate[] =>
  change.days.map((day) => day.date);

const asDate = (text: string | undefined): LocalDate | null => {
  if (text === undefined) return null;
  try {
    return parseLocalDate(text);
  } catch {
    return null;
  }
};

const span = (from: string | undefined, to: string | undefined) => {
  const fromDate = asDate(from);
  const toDate = asDate(to);
  return fromDate !== null && toDate !== null && compareLocalDate(fromDate, toDate) <= 0
    ? { fromDate, toDate }
    : null;
};

/** What an id names, or null for one that names nothing. */
export const parseChangeId = (id: string): ChangeRef | null => {
  const [kind, ...rest] = id.split(":");
  if (kind === "blocks" && rest.length === 1 && rest[0] !== "") {
    return { kind: "BLOCKS", groupId: rest[0]! };
  }
  if (kind === "closure" && rest.length === 2) {
    const dates = span(rest[0], rest[1]);
    return dates === null ? null : { kind: "CLOSURE", ...dates };
  }
  if (kind === "hours" && rest.length === 3 && rest[0] !== "") {
    const dates = span(rest[1], rest[2]);
    return dates === null ? null : { kind: "HOURS", resourceId: rest[0] as ResourceId, ...dates };
  }
  return null;
};
