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
 * A band is thirteen pixels tall and as wide as the days it covers, so a long
 * reason cannot be read on a short one — it would be cut off mid-word, which
 * reads as a rendering fault rather than as a reason. Below about a word per
 * day the band says what kind of thing it is instead; the sheet behind it
 * always has the whole of it.
 */
export const CHARACTERS_PER_DAY = 9;

export const labelFor = (note: string | null, days: number, fallback: string): string => {
  const said = (note ?? "").trim();
  if (said === "") return fallback;
  return said.length <= days * CHARACTERS_PER_DAY ? said : fallback;
};
