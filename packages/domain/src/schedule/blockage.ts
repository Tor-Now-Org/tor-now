import { interval, normalize, type Interval } from "../time/interval.ts";
import type { Instant } from "../time/instant.ts";

/**
 * Blocking out time that is already blocked.
 *
 * An owner keeping Tuesday afternoon free, and then keeping all of Tuesday
 * free, has said one thing twice — but the calendar kept both, so the day ended
 * up carrying two blockages lying on top of each other. Removing one of them
 * gave back nothing, because the other was still there, which is the kind of
 * thing that makes a calendar impossible to trust.
 *
 * So a new blockage absorbs the ones it meets: what comes out is the run of
 * time that is now kept free, and the blocks it swallowed, which the caller
 * removes. Touching counts as meeting — two o'clock to four and four to six is
 * one afternoon, not two blockages that happen to be adjacent.
 */

export type BlockedInterval = Interval<Instant>;

export type Absorbed<T> = {
  /** The blocks the new one swallowed; they are replaced, not kept beside it. */
  readonly removed: readonly T[];
  /** The runs of time that end up blocked, once everything is put together. */
  readonly spans: readonly BlockedInterval[];
};

const meets = (left: BlockedInterval, right: BlockedInterval): boolean =>
  left.start <= right.end && right.start <= left.end;

export const absorbBlockages = <T extends { readonly startAt: Instant; readonly endAt: Instant }>(
  existing: readonly T[],
  wanted: readonly BlockedInterval[],
): Absorbed<T> => {
  let spans = normalize([...wanted]);
  const removed: T[] = [];

  // Repeated until nothing more is drawn in: absorbing one block can extend
  // the run far enough to reach another that the first pass walked past.
  let growing = true;
  while (growing) {
    growing = false;
    existing.forEach((block) => {
      if (removed.includes(block)) return;
      const span = interval(block.startAt, block.endAt);
      if (!spans.some((range) => meets(range, span))) return;
      removed.push(block);
      spans = normalize([...spans, span]);
      growing = true;
    });
  }

  return { removed, spans };
};
