import { validationFailed } from "../shared/errors.ts";

/**
 * A half-open interval `[start, end)` over any numeric axis — Local Times
 * within a day, or Instants on the timeline. Half-open is what makes
 * back-to-back intervals not overlap: 09:00–10:00 and 10:00–11:00 are
 * adjacent, not conflicting.
 *
 * Every operation here is pure and returns new values; no input is mutated.
 */
export type Interval<T extends number> = {
  readonly start: T;
  readonly end: T;
};

export const interval = <T extends number>(start: T, end: T): Interval<T> => {
  if (end < start) {
    throw validationFailed(
      `An interval cannot end before it starts (${start} → ${end})`,
    );
  }
  return Object.freeze({ start, end });
};

export const durationOf = <T extends number>(range: Interval<T>): number =>
  range.end - range.start;

export const isEmpty = <T extends number>(range: Interval<T>): boolean =>
  range.end <= range.start;

export const overlaps = <T extends number>(
  left: Interval<T>,
  right: Interval<T>,
): boolean => left.start < right.end && right.start < left.end;

export const containsPoint = <T extends number>(
  range: Interval<T>,
  point: T,
): boolean => point >= range.start && point < range.end;

export const containsInterval = <T extends number>(
  outer: Interval<T>,
  inner: Interval<T>,
): boolean => inner.start >= outer.start && inner.end <= outer.end;

export const intersect = <T extends number>(
  left: Interval<T>,
  right: Interval<T>,
): Interval<T> | null => {
  const start = (Math.max(left.start, right.start) as T);
  const end = (Math.min(left.end, right.end) as T);
  return end > start ? interval(start, end) : null;
};

/**
 * `minuend` with `subtrahend` removed. Yields zero, one or two intervals: two
 * when the subtrahend falls strictly inside, splitting the range in half.
 */
export const subtract = <T extends number>(
  minuend: Interval<T>,
  subtrahend: Interval<T>,
): Interval<T>[] => {
  if (!overlaps(minuend, subtrahend)) return [minuend];
  const remainder: Interval<T>[] = [];
  if (subtrahend.start > minuend.start) {
    remainder.push(interval(minuend.start, subtrahend.start));
  }
  if (subtrahend.end < minuend.end) {
    remainder.push(interval(subtrahend.end, minuend.end));
  }
  return remainder;
};

/** Every interval in `minuends`, with every interval in `subtrahends` removed. */
export const subtractAll = <T extends number>(
  minuends: readonly Interval<T>[],
  subtrahends: readonly Interval<T>[],
): Interval<T>[] =>
  subtrahends.reduce<Interval<T>[]>(
    (remaining, subtrahend) =>
      remaining.flatMap((range) => subtract(range, subtrahend)),
    [...minuends],
  );

export const compareIntervals = <T extends number>(
  left: Interval<T>,
  right: Interval<T>,
): number => left.start - right.start || left.end - right.end;

/**
 * Sorts, drops empties, and merges anything overlapping or touching into the
 * fewest intervals covering the same time. Every layered subtraction runs
 * through this, so downstream code never sees duplicate or nested ranges.
 */
export const normalize = <T extends number>(
  ranges: readonly Interval<T>[],
): Interval<T>[] => {
  const sorted = ranges
    .filter((range) => !isEmpty(range))
    .slice()
    .sort(compareIntervals);

  return sorted.reduce<Interval<T>[]>((merged, range) => {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && range.start <= previous.end) {
      if (range.end > previous.end) {
        merged[merged.length - 1] = interval(previous.start, range.end);
      }
      return merged;
    }
    return [...merged, range];
  }, []);
};

/** Every interval trimmed to `bounds`; anything falling outside disappears. */
export const clipAll = <T extends number>(
  ranges: readonly Interval<T>[],
  bounds: Interval<T>,
): Interval<T>[] =>
  ranges
    .map((range) => intersect(range, bounds))
    .filter((range): range is Interval<T> => range !== null);

export const totalDuration = <T extends number>(
  ranges: readonly Interval<T>[],
): number => ranges.reduce((sum, range) => sum + durationOf(range), 0);
