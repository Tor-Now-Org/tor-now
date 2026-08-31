import { MILLISECONDS_PER_MINUTE } from "../shared/constants.ts";
import { validationFailed } from "../shared/errors.ts";

/**
 * An absolute moment on the timeline, held as milliseconds since the Unix
 * epoch (CONTEXT.md: "Instant"). Used for anything that happened or will
 * happen; never for a recurring rule.
 */
export type Instant = number & { readonly __brand: "Instant" };

export const instant = (epochMilliseconds: number): Instant => {
  if (!Number.isFinite(epochMilliseconds)) {
    throw validationFailed(`Instant must be a finite epoch value`);
  }
  return Math.round(epochMilliseconds) as Instant;
};

export const parseInstant = (isoText: string): Instant => {
  const parsed = Date.parse(isoText);
  if (Number.isNaN(parsed)) {
    throw validationFailed(`"${isoText}" is not a valid instant`);
  }
  return instant(parsed);
};

export const formatInstant = (value: Instant): string =>
  new Date(value).toISOString();

export const addMinutesToInstant = (value: Instant, minutes: number): Instant =>
  instant(value + minutes * MILLISECONDS_PER_MINUTE);

export const minutesBetweenInstants = (from: Instant, to: Instant): number =>
  (to - from) / MILLISECONDS_PER_MINUTE;

export const compareInstant = (left: Instant, right: Instant): number =>
  left - right;

/**
 * The domain never reads the wall clock directly; a Clock is passed in, so
 * every rule that depends on "now" is testable without freezing global time.
 */
export type Clock = { now: () => Instant };

export const systemClock: Clock = { now: () => instant(Date.now()) };

export const fixedClock = (at: Instant): Clock => ({ now: () => at });
