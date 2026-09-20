import { validationFailed } from "../shared/errors.ts";
import type { Instant } from "../time/instant.ts";
import { hourOf } from "../time/local-time.ts";
import { instantToZoned, type TimeZone } from "../time/zone.ts";

/**
 * The coarse parts a day is read in: morning, the middle of the day, evening.
 *
 * The customer's slot grid has always been grouped this way, and while that
 * was only presentation the boundaries could live in the interface. A Waiting
 * Entry is expressed in these words — "tell me if a morning opens up" — so
 * where morning ends is now a fact about the product that both sides of the
 * wire have to agree on, and facts of that kind live here.
 *
 * Local hours in the Business's own zone. A customer asking about a morning
 * means the shop's morning, not the server's.
 */
export const PARTS_OF_DAY = ["MORNING", "NOON", "EVENING"] as const;

export type PartOfDay = (typeof PARTS_OF_DAY)[number];

/** Where one part gives way to the next, on the Business's clock. */
export const PART_OF_DAY_STARTS_AT_HOUR = Object.freeze({
  NOON: 12,
  EVENING: 17,
});

export const partOfDayAt = (value: Instant, zone: TimeZone): PartOfDay => {
  const hour = hourOf(instantToZoned(value, zone).time);
  if (hour < PART_OF_DAY_STARTS_AT_HOUR.NOON) return "MORNING";
  if (hour < PART_OF_DAY_STARTS_AT_HOUR.EVENING) return "NOON";
  return "EVENING";
};

const isPartOfDay = (value: string): value is PartOfDay =>
  (PARTS_OF_DAY as readonly string[]).includes(value);

/**
 * What a customer asked for, cleaned up.
 *
 * Deduplicated and put back into the day's own order, so two entries wanting
 * the same thing are stored the same way and the message that names them reads
 * forwards.
 *
 * "Any time" is every part rather than none. An empty set would have to mean
 * "all of them" by convention, and a convention like that gets read backwards
 * exactly once before it sends a message to everybody.
 */
export const wantedPartsOfDay = (
  wanted: readonly string[],
): readonly PartOfDay[] => {
  for (const part of wanted) {
    if (!isPartOfDay(part)) {
      throw validationFailed(`${part} is not a part of the day`);
    }
  }
  const kept = PARTS_OF_DAY.filter((part) => wanted.includes(part));
  if (kept.length === 0) {
    throw validationFailed("Waiting for a time needs at least one part of the day");
  }
  return kept;
};
