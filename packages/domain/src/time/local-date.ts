import { DAYS_PER_WEEK, MILLISECONDS_PER_DAY } from "../shared/constants.ts";
import { validationFailed } from "../shared/errors.ts";

/** A calendar date with no time and no zone, in ISO `YYYY-MM-DD` form. */
export type LocalDate = string & { readonly __brand: "LocalDate" };

/**
 * Day of week as stored: 0 is Sunday, matching both Postgres `extract(dow)`
 * and the Israeli working week, whose first day is Sunday.
 */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export const isDayOfWeek = (value: number): value is DayOfWeek =>
  Number.isInteger(value) && value >= 0 && value < DAYS_PER_WEEK;

export const dayOfWeek = (value: number): DayOfWeek => {
  if (!isDayOfWeek(value)) {
    throw validationFailed(`Day of week must be 0..6, got ${value}`);
  }
  return value;
};

type DateParts = { year: number; month: number; day: number };

const partsOf = (date: LocalDate): DateParts => {
  const match = LOCAL_DATE_PATTERN.exec(date);
  /* istanbul ignore next -- unreachable for a validated LocalDate */
  if (match === null) {
    throw validationFailed(`Local date must look like YYYY-MM-DD, got "${date}"`);
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
};

export const parseLocalDate = (text: string): LocalDate => {
  const match = LOCAL_DATE_PATTERN.exec(text);
  if (match === null) {
    throw validationFailed(`Local date must look like YYYY-MM-DD, got "${text}"`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  const roundTrip = new Date(utc);
  // Rejects 2026-02-30 and friends, which Date.UTC would silently roll over.
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    throw validationFailed(`"${text}" is not a real calendar date`);
  }
  return text as LocalDate;
};

const pad = (value: number, width = 2): string =>
  String(value).padStart(width, "0");

export const localDateOf = (
  year: number,
  month: number,
  day: number,
): LocalDate => parseLocalDate(`${pad(year, 4)}-${pad(month)}-${pad(day)}`);

/** Days are compared as strings; the ISO form makes that lexicographic order. */
export const compareLocalDate = (left: LocalDate, right: LocalDate): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const dayOfWeekOf = (date: LocalDate): DayOfWeek => {
  const { year, month, day } = partsOf(date);
  return dayOfWeek(new Date(Date.UTC(year, month - 1, day)).getUTCDay());
};

export const addDays = (date: LocalDate, days: number): LocalDate => {
  const { year, month, day } = partsOf(date);
  const shifted = new Date(
    Date.UTC(year, month - 1, day) + days * MILLISECONDS_PER_DAY,
  );
  return localDateOf(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
};

export const daysBetween = (from: LocalDate, to: LocalDate): number => {
  const start = partsOf(from);
  const end = partsOf(to);
  return Math.round(
    (Date.UTC(end.year, end.month - 1, end.day) -
      Date.UTC(start.year, start.month - 1, start.day)) /
      MILLISECONDS_PER_DAY,
  );
};

/** The inclusive run of dates from `from` to `to`. */
export const datesBetween = (from: LocalDate, to: LocalDate): LocalDate[] => {
  const span = daysBetween(from, to);
  if (span < 0) return [];
  return Array.from({ length: span + 1 }, (_unused, index) =>
    addDays(from, index),
  );
};
