import {
  MINUTES_PER_DAY,
  MINUTES_PER_HOUR,
} from "../shared/constants.ts";
import { validationFailed } from "../shared/errors.ts";

/**
 * A wall-clock time in a Business's own timezone, with no date attached
 * (CONTEXT.md: "Local Time"). Represented as minutes elapsed since midnight so
 * that ordering and arithmetic are integer operations.
 *
 * The upper bound is inclusive of `MINUTES_PER_DAY`: a Working Hours range may
 * end at 24:00, which denotes the end of the day rather than the start of the
 * next one.
 */
export type LocalTime = number & { readonly __brand: "LocalTime" };

export const MIDNIGHT = 0 as LocalTime;
export const END_OF_DAY = MINUTES_PER_DAY as LocalTime;

const LOCAL_TIME_PATTERN = /^(\d{2}):(\d{2})$/;

export const isLocalTime = (value: number): value is LocalTime =>
  Number.isInteger(value) && value >= MIDNIGHT && value <= END_OF_DAY;

export const localTime = (minutesFromMidnight: number): LocalTime => {
  if (!isLocalTime(minutesFromMidnight)) {
    throw validationFailed(
      `Local time must be a whole number of minutes within a day, got ${minutesFromMidnight}`,
    );
  }
  return minutesFromMidnight;
};

export const localTimeOf = (hour: number, minute: number): LocalTime =>
  localTime(hour * MINUTES_PER_HOUR + minute);

/** Parses the `HH:MM` form used on the wire and in the database. */
export const parseLocalTime = (text: string): LocalTime => {
  const match = LOCAL_TIME_PATTERN.exec(text);
  if (match === null) {
    throw validationFailed(`Local time must look like HH:MM, got "${text}"`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute >= MINUTES_PER_HOUR) {
    throw validationFailed(`Minute must be below ${MINUTES_PER_HOUR}, got "${text}"`);
  }
  return localTimeOf(hour, minute);
};

const pad = (value: number): string => String(value).padStart(2, "0");

export const formatLocalTime = (time: LocalTime): string =>
  `${pad(Math.floor(time / MINUTES_PER_HOUR))}:${pad(time % MINUTES_PER_HOUR)}`;

export const hourOf = (time: LocalTime): number =>
  Math.floor(time / MINUTES_PER_HOUR);

export const minuteOf = (time: LocalTime): number => time % MINUTES_PER_HOUR;

/** Shifts a time within the day, clamped to the day's bounds. */
export const shiftLocalTime = (time: LocalTime, minutes: number): LocalTime =>
  localTime(Math.min(END_OF_DAY, Math.max(MIDNIGHT, time + minutes)));

export const compareLocalTime = (left: LocalTime, right: LocalTime): number =>
  left - right;
