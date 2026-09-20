import type { ResourceId } from "../model/ids.ts";
import type { Instant } from "../time/instant.ts";
import type { TimeZone } from "../time/zone.ts";
import { partOfDayAt, type PartOfDay } from "./part-of-day.ts";
import type { Slot } from "./slots.ts";

/**
 * A Waiting Entry, reduced to the question it asks.
 *
 * Which Service, which Business and which customer are all matters for the
 * database and the message; none of them changes whether a freed stretch
 * answers. What decides that is only this: the calendars the customer will
 * accept, and the parts of the day they want.
 */
export type WaitingWant = {
  /** One, several, or all of a Business's calendars. Never empty. */
  readonly resourceIds: readonly ResourceId[];
  /** Never empty; wanting every part is what "any time" means. */
  readonly parts: readonly PartOfDay[];
};

/** Whether a change to this calendar is worth recomputing this entry for. */
export const waitsOn = (want: WaitingWant, resourceId: ResourceId): boolean =>
  want.resourceIds.includes(resourceId);

/**
 * What the customer is told about, if anything.
 *
 * Everything difficult has already happened by the time these Slots exist:
 * Minimum Notice trimmed the near end, the Booking Horizon trimmed the far
 * one, and Buffers, Blocks and Date Overrides shaped what was left. So this is
 * the last small question — is any offered time in a part of the day that was
 * asked for — and the answer is deliberately not a boolean.
 *
 * The earliest answering time, because the message names a part of the day and
 * with two wanted parts free at once "the opening" is the one that comes
 * first. A customer reading about a morning when the evening also freed has
 * lost nothing: the link opens the day, and the evening is on it.
 */
export type Opening = {
  readonly startAt: Instant;
  readonly part: PartOfDay;
};

export const openingFor = (
  want: WaitingWant,
  slots: readonly Slot[],
  zone: TimeZone,
): Opening | null => {
  let earliest: Opening | null = null;

  for (const slot of slots) {
    const part = partOfDayAt(slot.startAt, zone);
    if (!want.parts.includes(part)) continue;
    if (earliest === null || slot.startAt < earliest.startAt) {
      earliest = { startAt: slot.startAt, part };
    }
  }

  return earliest;
};
