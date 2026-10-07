import type { DayAvailabilityDto } from "@/lib/api/types.ts";
import { addDaysTo, partOfDay, type PartOfDay } from "@/lib/format.ts";

/**
 * ADR 0026: the customer's days, as pure rules. What a day says before it is
 * opened, how far the days run, which two-week pages to ask the server for, and
 * how the month is laid out. Nothing here touches React or the clock, so every
 * rule can be tested on its own.
 */

/** How many days the strip offers before the month takes over. */
export const STRIP_DAYS = 14;

/** When a date past the window opens: later today, tomorrow, or on a date. */
export type Opening =
  | { readonly kind: "today" }
  | { readonly kind: "tomorrow" }
  | { readonly kind: "on"; readonly date: string };

export type Mark =
  | { readonly kind: "free"; readonly count: number }
  | { readonly kind: "full" }
  | { readonly kind: "closed" }
  | { readonly kind: "call" }
  | { readonly kind: "over" }
  | { readonly kind: "later"; readonly when: Opening }
  | { readonly kind: "loading" };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days from one date to another; negative when `to` comes first. */
export const daysFromTo = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);

const earlier = (left: string, right: string): string => (left <= right ? left : right);
const later = (left: string, right: string): string => (left >= right ? left : right);

/** The dates from one to another, both included. */
export const datesFromTo = (from: string, to: string): string[] =>
  Array.from({ length: Math.max(0, daysFromTo(from, to) + 1) }, (_unused, index) => addDaysTo(from, index));

/**
 * The window moves with the clock, so a time on a date past it opens at the
 * same clock time `horizonDays` earlier: a date's hours open on the date the
 * horizon is subtracted from.
 */
export const whenOpens = (date: string, today: string, horizonDays: number): Opening => {
  const on = addDaysTo(date, -horizonDays);
  if (on <= today) return { kind: "today" };
  if (on === addDaysTo(today, 1)) return { kind: "tomorrow" };
  return { kind: "on", date: on };
};

export const markOf = (
  day: DayAvailabilityDto | undefined,
  today: string,
  horizonDays: number,
): Mark => {
  if (day === undefined) return { kind: "loading" };
  if (day.slots.length > 0) return { kind: "free", count: day.slots.length };
  switch (day.emptyReason) {
    case "CLOSED":
      return { kind: "closed" };
    case "TOO_SOON":
      return { kind: "call" };
    case "DAY_OVER":
      return { kind: "over" };
    case "BEYOND_HORIZON":
      return { kind: "later", when: whenOpens(day.date, today, horizonDays) };
    default:
      // FULLY_BOOKED, and a day with no times that gave no reason: nothing to
      // book, and a waiting list may still be worth offering.
      return { kind: "full" };
  }
};

/** The date an instant falls on in the business's zone. */
const dateAt = (instant: number, timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));

/**
 * The last date the window reaches into, partly or wholly — ADR 0012 measures
 * the horizon from this moment, not from midnight, so this day is usually only
 * partly open and must still be offered.
 */
export const lastBookableDay = (now: Date, timeZone: string, horizonDays: number): string =>
  dateAt(now.getTime() + horizonDays * MS_PER_DAY, timeZone);

/** The last day of the two-week page a date falls in, pages counted from today. */
const pageEndOf = (today: string, date: string): string =>
  addDaysTo(today, (Math.floor(Math.max(0, daysFromTo(today, date)) / STRIP_DAYS) + 1) * STRIP_DAYS - 1);

/**
 * The days the strip draws: two weeks from today, or on through the page of a
 * day picked from the month, and never past the window's last day.
 */
export const stripDates = (today: string, lastDay: string, through: string | null): string[] => {
  const end = earlier(lastDay, pageEndOf(today, through === null ? today : later(today, through)));
  return datesFromTo(today, end);
};

/**
 * The two-week pages, counted from today, that hold every date from `from` to
 * `to` — each asked for whole, so a page once answered answers every later
 * question about its days.
 */
export const pagesFor = (
  today: string,
  lastDay: string,
  from: string,
  to: string,
): { from: string; to: string }[] => {
  const first = Math.floor(Math.max(0, daysFromTo(today, from)) / STRIP_DAYS);
  const last = Math.floor(Math.max(0, daysFromTo(today, earlier(to, lastDay))) / STRIP_DAYS);
  return Array.from({ length: Math.max(0, last - first + 1) }, (_unused, index) => {
    const start = addDaysTo(today, (first + index) * STRIP_DAYS);
    return { from: start, to: earlier(lastDay, addDaysTo(start, STRIP_DAYS - 1)) };
  });
};

/**
 * The first date with a time free — but only once every day before it has
 * answered, so the page never opens past a day it has not read.
 */
export const firstFree = (
  dates: readonly string[],
  days: Readonly<Record<string, DayAvailabilityDto>>,
): string | null => {
  for (const date of dates) {
    const day = days[date];
    if (day === undefined) return null;
    if (day.slots.length > 0) return date;
  }
  return null;
};

/** Whether the window holds more than the strip's two weeks. */
export const reachesPastStrip = (today: string, lastDay: string): boolean =>
  daysFromTo(today, lastDay) >= STRIP_DAYS;

const firstOfMonth = (date: string): string => `${date.slice(0, 7)}-01`;

const nextMonth = (first: string): string => {
  const [year, month] = first.split("-").map(Number) as [number, number];
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
};

const lastOfMonth = (first: string): string => addDaysTo(nextMonth(first), -1);

/** The months the sheet pages through: this one to the window's last. */
export const monthsOf = (today: string, lastDay: string): string[] => {
  const months: string[] = [];
  for (let month = firstOfMonth(today); month <= lastDay; month = nextMonth(month)) {
    months.push(month);
  }
  return months;
};

const SUNDAY_FIRST_WEEK = 7;

/** A month as weeks from Sunday, with the days outside it left empty. */
export const monthWeeks = (first: string): (string | null)[][] => {
  const leading = new Date(`${first}T00:00:00Z`).getUTCDay();
  const cells: (string | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...datesFromTo(first, lastOfMonth(first)),
  ];
  const trailing = (SUNDAY_FIRST_WEEK - (cells.length % SUNDAY_FIRST_WEEK)) % SUNDAY_FIRST_WEEK;
  const padded = [...cells, ...Array.from({ length: trailing }, () => null)];
  return Array.from({ length: padded.length / SUNDAY_FIRST_WEEK }, (_unused, week) =>
    padded.slice(week * SUNDAY_FIRST_WEEK, (week + 1) * SUNDAY_FIRST_WEEK),
  );
};

/** The part of a month inside the window, which is all there is to ask about. */
export const monthSpan = (
  first: string,
  today: string,
  lastDay: string,
): { from: string; to: string } | null => {
  const from = later(first, today);
  const to = earlier(lastOfMonth(first), lastDay);
  return from <= to ? { from, to } : null;
};

export const cellOf = (date: string, today: string, lastDay: string): "past" | "open" | "later" =>
  date < today ? "past" : date > lastDay ? "later" : "open";

/**
 * How a day is drawn in the month: its tone, and the one word (or count) under
 * its number. A day past the window — wholly, or still to open later today —
 * is drawn as not open yet, the same dotted cell as every later day, rather
 * than as a quiet blank.
 */
export type CellLook = {
  readonly tone: "" | "full" | "off" | "off call" | "later";
  readonly word: "count" | "full" | "closed" | "call" | "over" | "";
};

export const cellLook = (mark: Mark): CellLook => {
  switch (mark.kind) {
    case "free":
      return { tone: "", word: "count" };
    case "full":
      return { tone: "full", word: "full" };
    case "closed":
      return { tone: "off", word: "closed" };
    case "call":
      return { tone: "off call", word: "call" };
    case "over":
      return { tone: "off", word: "over" };
    case "later":
      return { tone: "later", word: "" };
    case "loading":
      return { tone: "", word: "" };
  }
};

const PART_ORDER: readonly PartOfDay[] = ["morning", "noon", "evening"];

/**
 * The first Part of Day on this date that waiting could still come to anything
 * in: none before the notice ends, since those hours are not taken but too
 * soon, and none of today's that are already over. `noticeEnds` is now plus the
 * Minimum Notice. Returns the count of parts when none is left on the date.
 */
export const firstWaitablePart = (date: string, noticeEnds: Date, timeZone: string): number => {
  const edge = dateAt(noticeEnds.getTime(), timeZone);
  if (date > edge) return 0;
  if (date < edge) return PART_ORDER.length;
  return PART_ORDER.indexOf(partOfDay(noticeEnds.toISOString(), timeZone));
};

export type { PartOfDay };
