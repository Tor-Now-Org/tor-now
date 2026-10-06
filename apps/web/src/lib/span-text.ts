import { fillText } from "./i18n/fill.ts";

/** The words a length of time is said in; the `days` namespace carries them. */
export type SpanWords = {
  readonly unitDay: string;
  readonly unitTwoDays: string;
  readonly unitDays: string;
  readonly unitHour: string;
  readonly unitTwoHours: string;
  readonly unitHours: string;
  readonly unitMinute: string;
  readonly unitMinutes: string;
};

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/** One, two, or many — Hebrew has a word of its own for two of a unit. */
const counted = (count: number, one: string, two: string, many: string): string =>
  count === 1 ? one : count === 2 ? two : fillText(many, { count: String(count) });

export const spanOfDays = (count: number, words: SpanWords): string =>
  counted(count, words.unitDay, words.unitTwoDays, words.unitDays);

/**
 * A notice the way somebody would say it: in the largest unit that divides it
 * exactly, so three days stay "3 ימים" rather than becoming 4320 minutes, and
 * 25 hours stay hours rather than becoming a day and a fraction.
 */
export const spanOfMinutes = (minutes: number, words: SpanWords): string => {
  if (minutes > 0 && minutes % MINUTES_PER_DAY === 0) {
    return spanOfDays(minutes / MINUTES_PER_DAY, words);
  }
  if (minutes > 0 && minutes % MINUTES_PER_HOUR === 0) {
    return counted(minutes / MINUTES_PER_HOUR, words.unitHour, words.unitTwoHours, words.unitHours);
  }
  return minutes === 1 ? words.unitMinute : fillText(words.unitMinutes, { count: String(minutes) });
};
