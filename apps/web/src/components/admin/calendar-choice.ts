/**
 * Choosing which calendars stay when a Business is over its Resource
 * Allowance. Pure, so the two rules — what is chosen to begin with, and what a
 * tap does — are tested apart from the list that draws them.
 */

type Calendar = { readonly id: string; readonly upcoming: number };

/**
 * The ones with the most booked ahead, as many as the Allowance holds: the
 * calendars an owner is least likely to want paused, so the usual answer is
 * already chosen. Ties keep the order they came in — oldest first.
 */
export const likelyToStay = (calendars: readonly Calendar[], allowance: number): string[] =>
  calendars
    .map((calendar, at) => ({ ...calendar, at }))
    .sort((a, b) => b.upcoming - a.upcoming || a.at - b.at)
    .slice(0, Math.max(0, allowance))
    .map((calendar) => calendar.id);

/**
 * What a tap on a calendar makes of the choice. With room for one, the tap is
 * the choice. With room for more, it toggles — and a calendar past the room
 * left is not added, rather than silently dropping another.
 */
export const tapped = (chosen: readonly string[], id: string, allowance: number): string[] => {
  if (allowance <= 1) return [id];
  if (chosen.includes(id)) return chosen.filter((kept) => kept !== id);
  return chosen.length >= allowance ? [...chosen] : [...chosen, id];
};
