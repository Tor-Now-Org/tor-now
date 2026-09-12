import { addDaysTo } from "@/lib/format.ts";
import type { BusinessMonthDto } from "@/lib/api/types.ts";

/**
 * The arithmetic behind the month grid: which dates sit in which row, and where
 * a thing covering several days is drawn across them.
 *
 * Pure and on its own, because a band in the wrong column is a bug nobody spots
 * by looking — a holiday drawn one day early reads as perfectly plausible.
 */

export const DAYS_IN_A_WEEK = 7;

/** Sunday-first, the week this product's businesses work. */
export const columnOf = (date: string): number => {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

export const daysInMonth = (firstOfMonth: string): number => {
  const [year, month] = firstOfMonth.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
};

/**
 * The month as rows of seven, with the leading and trailing blanks the grid
 * needs. A date is a string; a blank is null.
 */
export const weeksOf = (firstOfMonth: string): (string | null)[][] => {
  const lead = columnOf(firstOfMonth);
  const total = daysInMonth(firstOfMonth);
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let offset = 0; offset < total; offset += 1) {
    cells.push(addDaysTo(firstOfMonth, offset));
  }
  while (cells.length % DAYS_IN_A_WEEK !== 0) cells.push(null);
  return Array.from({ length: cells.length / DAYS_IN_A_WEEK }, (_unused, row) =>
    cells.slice(row * DAYS_IN_A_WEEK, (row + 1) * DAYS_IN_A_WEEK),
  );
};

export type Span = { readonly fromDate: string; readonly toDate: string };

/**
 * Where a span is drawn inside one week, given as a column and a width.
 *
 * A holiday crossing a Saturday is two segments — one per row — which is what a
 * calendar does and what makes it read as continuous.
 */
export const segmentIn = <T extends Span>(
  week: readonly (string | null)[],
  span: T,
): { readonly span: T; readonly column: number; readonly width: number } | null => {
  const dates = week.filter((cell): cell is string => cell !== null);
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first === undefined || last === undefined) return null;
  if (span.toDate < first || span.fromDate > last) return null;

  const from = span.fromDate < first ? first : span.fromDate;
  const to = span.toDate > last ? last : span.toDate;
  const column = week.indexOf(from);
  const until = week.indexOf(to);
  if (column < 0 || until < 0) return null;
  return { span, column, width: until - column + 1 };
};

/** What a square has to say, gathered from the month the API answered. */
export type DayFacts = {
  readonly date: string;
  readonly shopClosed: boolean;
  readonly shopHours: readonly { start: string; end: string }[];
  readonly byCalendar: readonly { resourceId: string; appointments: number; away: boolean }[];
};

export const factsOn = (month: BusinessMonthDto, date: string): DayFacts => {
  const found = month.days.find((day) => day.date === date);
  return (
    found ?? { date, shopClosed: false, shopHours: [], byCalendar: [] }
  );
};

/** The dates a two-tap selection covers, in order, both ends included. */
export const datesBetween = (from: string, to: string): string[] => {
  const [start, end] = from <= to ? [from, to] : [to, from];
  const out: string[] = [];
  for (let date = start; date <= end; date = addDaysTo(date, 1)) out.push(date);
  return out;
};

/**
 * What a band across the month says.
 *
 * A band is twelve pixels tall and as wide as the days it covers — and on a
 * phone one day is about fifty pixels, which is seven Hebrew letters once the
 * pill has its padding. A longer reason cut off at that width reads as a
 * rendering fault rather than as a reason, so a band too narrow for what it
 * would like to say falls back to something shorter. The sheet behind it
 * always has the whole of it.
 */
export const CHARACTERS_PER_DAY = 7;

/**
 * The first of these that fits, or the last as a floor.
 *
 * Things a band would like to say, in descending order of how much it says:
 * whose it is and why, then why alone, then what kind of thing it is. A wide
 * band carries all of it and a single day carries a word, without either
 * needing a rule of its own.
 */
export const labelFitting = (candidates: readonly string[], days: number): string => {
  const room = days * CHARACTERS_PER_DAY;
  const said = candidates.map((one) => one.trim()).filter((one) => one !== "");
  return said.find((one) => one.length <= room) ?? said[said.length - 1] ?? "";
};

export const labelFor = (note: string | null, days: number, fallback: string): string =>
  labelFitting([note ?? "", fallback], days);

/**
 * How many rows of bands a week may carry before the rest are folded away.
 *
 * Two is what a month can spare. Beyond that the bands stop being a glance and
 * start being a list, and a list belongs in a sheet rather than on top of the
 * days it is describing.
 */
export const BAND_ROWS_IN_A_WEEK = 2;

export type Segment<T> = {
  readonly span: T;
  readonly column: number;
  readonly width: number;
};

/**
 * Bands arranged into as few rows as they will fit in.
 *
 * Every decision used to get a row of its own, so a week with a Monday off, a
 * Wednesday course and a Friday closure grew three bars — stacked over the
 * squares they were describing until the month was unreadable. Bands that do
 * not overlap in time do not need separate rows: three single days sit on one
 * line, the way a calendar has always drawn them.
 *
 * First fit, in the order given, which keeps a long span near the top where it
 * reads as the backdrop to the shorter things beside it.
 */
export const packBands = <T>(
  segments: readonly Segment<T>[],
): { readonly rows: Segment<T>[][]; readonly folded: Segment<T>[] } => {
  const rows: Segment<T>[][] = [];

  segments.forEach((segment) => {
    const room = rows.find((row) =>
      row.every(
        (taken) =>
          segment.column >= taken.column + taken.width ||
          taken.column >= segment.column + segment.width,
      ),
    );
    if (room === undefined) rows.push([segment]);
    else room.push(segment);
  });

  return {
    rows: rows.slice(0, BAND_ROWS_IN_A_WEEK),
    folded: rows.slice(BAND_ROWS_IN_A_WEEK).flat(),
  };
};
