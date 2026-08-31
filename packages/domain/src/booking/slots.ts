import type { Instant } from "../time/instant.ts";
import { addMinutesToInstant } from "../time/instant.ts";
import type { Interval } from "../time/interval.ts";
import { validationFailed } from "../shared/errors.ts";

/** A candidate start time offered to a customer. Computed, never stored. */
export type Slot = { readonly startAt: Instant; readonly endAt: Instant };

/**
 * ADR 0001 puts slot generation behind a seam so the algorithm can be revisited
 * against real booking data. A strategy is a pure function over intervals: no
 * I/O, no clock, no database.
 */
export type SlotGenerationStrategy = (
  freeIntervals: readonly Interval<Instant>[],
  durationMinutes: number,
  bufferMinutes: number,
) => Slot[];

const assertPositiveDuration = (durationMinutes: number): void => {
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw validationFailed(
      `A service must have a positive duration, got ${durationMinutes}`,
    );
  }
};

/**
 * The MVP strategy of ADR 0001. A cursor steps forward from the start of each
 * Free Interval in `duration + buffer` increments for as long as the service
 * still fits. Start times therefore drift off round numbers as a day fills up,
 * which the ADR accepts as a cost.
 *
 * The buffer is required *after* the appointment but need not fit inside the
 * free interval for the last slot of the interval: the gap that follows may be
 * closing time. Only the duration has to fit.
 */
export const greedyWalk: SlotGenerationStrategy = (
  freeIntervals,
  durationMinutes,
  bufferMinutes,
) => {
  assertPositiveDuration(durationMinutes);
  const stepMinutes = durationMinutes + Math.max(0, bufferMinutes);

  return freeIntervals.flatMap((free) => {
    const slots: Slot[] = [];
    let cursor = free.start;
    while (true) {
      const endAt = addMinutesToInstant(cursor, durationMinutes);
      if (endAt > free.end) break;
      slots.push({ startAt: cursor, endAt });
      cursor = addMinutesToInstant(cursor, stepMinutes);
    }
    return slots;
  });
};

/**
 * The alternative ADR 0001 weighed and deferred, kept because the seam is only
 * real if something else can occupy it. Tests every start on a fixed grid.
 */
export const fixedGranularity =
  (granularityMinutes: number): SlotGenerationStrategy =>
  (freeIntervals, durationMinutes) => {
    assertPositiveDuration(durationMinutes);
    if (granularityMinutes <= 0) {
      throw validationFailed(
        `Granularity must be positive, got ${granularityMinutes}`,
      );
    }
    return freeIntervals.flatMap((free) => {
      const slots: Slot[] = [];
      let cursor = free.start;
      while (true) {
        const endAt = addMinutesToInstant(cursor, durationMinutes);
        if (endAt > free.end) break;
        slots.push({ startAt: cursor, endAt });
        cursor = addMinutesToInstant(cursor, granularityMinutes);
      }
      return slots;
    });
  };

export const SLOT_STRATEGIES = {
  GREEDY_WALK: "GREEDY_WALK",
} as const;

export type SlotStrategyName = keyof typeof SLOT_STRATEGIES;

export const strategyByName = (
  name: SlotStrategyName,
): SlotGenerationStrategy => {
  switch (name) {
    case "GREEDY_WALK":
      return greedyWalk;
  }
};
