/**
 * The dates a customer's page reads, on the business's own clock: the month
 * someone has been a customer since, a history row's day and month, and the
 * month a history is grouped by.
 */

const LOCALE = { he: "he-IL", en: "en-GB" } as const;
type Language = keyof typeof LOCALE;

const format = (iso: string, zone: string, language: Language, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(LOCALE[language], { ...options, timeZone: zone }).format(new Date(iso));

/** "ספטמבר 2026": the month and year of a customer's first appointment. */
export const monthAndYear = (iso: string, zone: string, language: Language): string =>
  format(iso, zone, language, { month: "long", year: "numeric" });

/** The day of the month, large on a history row. */
export const dayOfMonth = (iso: string, zone: string, language: Language): string =>
  format(iso, zone, language, { day: "numeric" });

/** The month, short, under the day. */
export const shortMonth = (iso: string, zone: string, language: Language): string =>
  format(iso, zone, language, { month: "short" });

/** "יום ב׳, 12 באוק׳ · 16:00": an upcoming appointment, as the card names it. */
export const dayAndTime = (iso: string, zone: string, language: Language): string => {
  const day = format(iso, zone, language, { weekday: "short", day: "numeric", month: "short" });
  const time = format(iso, zone, language, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${day} · ${time}`;
};

/** The hour alone, for a history row whose date stands beside it. */
export const timeOnly = (iso: string, zone: string, language: Language): string =>
  format(iso, zone, language, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "יום ב׳": the weekday, beside a date shown on its own. */
export const weekdayShort = (iso: string, zone: string, language: Language): string =>
  format(iso, zone, language, { weekday: "short" });
