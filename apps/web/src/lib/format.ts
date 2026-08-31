import type { Language } from "./i18n/dictionaries.ts";

/**
 * Formatting is a presentation concern and lives here rather than in the API:
 * the wire carries an ISO instant and a minor-unit integer, and each interface
 * renders them in its own language and in the Business's own timezone.
 */

const LOCALE: Readonly<Record<Language, string>> = Object.freeze({
  he: "he-IL",
  en: "en-GB",
});

export const timeIn = (
  isoInstant: string,
  timeZone: string,
  language: Language,
): string =>
  new Intl.DateTimeFormat(LOCALE[language], {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(isoInstant));

export const dateIn = (
  isoInstant: string,
  timeZone: string,
  language: Language,
): string =>
  new Intl.DateTimeFormat(LOCALE[language], {
    timeZone,
    day: "numeric",
    month: "long",
  }).format(new Date(isoInstant));

export const weekdayIn = (
  isoInstant: string,
  timeZone: string,
  language: Language,
): string =>
  new Intl.DateTimeFormat(LOCALE[language], { timeZone, weekday: "long" }).format(
    new Date(isoInstant),
  );

/** A calendar date has no instant; formatting it must not shift it by a zone. */
export const formatLocalDate = (
  localDate: string,
  language: Language,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" },
): string => {
  const [year, month, day] = localDate.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Intl.DateTimeFormat(LOCALE[language], {
    ...options,
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
};

export const weekdayOf = (localDate: string): number => {
  const [year, month, day] = localDate.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

export const addDaysTo = (localDate: string, days: number): string => {
  const [year, month, day] = localDate.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
};

/** Today, as the Business sees it — not as the customer's device sees it. */
export const todayIn = (timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts;
};

const MINOR_UNITS_PER_MAJOR = 100;

export const formatPrice = (
  minorUnits: number,
  language: Language,
  freeLabel: string,
): string => {
  if (minorUnits === 0) return freeLabel;
  return new Intl.NumberFormat(LOCALE[language], {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: minorUnits % MINOR_UNITS_PER_MAJOR === 0 ? 0 : 2,
  }).format(minorUnits / MINOR_UNITS_PER_MAJOR);
};

export const formatDuration = (minutes: number, minutesLabel: string): string =>
  `${minutes} ${minutesLabel}`;

/**
 * The parts of the day the customer's slot list is grouped into, matching the
 * design's morning / noon / evening headings.
 */
export const PART_OF_DAY_BOUNDARIES = Object.freeze({
  noonStartsAtHour: 12,
  eveningStartsAtHour: 17,
});

export type PartOfDay = "morning" | "noon" | "evening";

export const partOfDay = (isoInstant: string, timeZone: string): PartOfDay => {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      hour12: false,
    }).format(new Date(isoInstant)),
  );
  if (hour < PART_OF_DAY_BOUNDARIES.noonStartsAtHour) return "morning";
  if (hour < PART_OF_DAY_BOUNDARIES.eveningStartsAtHour) return "noon";
  return "evening";
};
