/**
 * What colour a thing on the calendar is drawn in.
 *
 * A service keeps one colour — the same one on every day, in every calendar,
 * for as long as it is called what it is called. The colour used to be the
 * service's position in *that day's* list of services, so the same haircut was
 * blue on a day it was the only service and violet on a day a dye job came
 * first; two days of the same calendar could not be compared at a glance,
 * which is the one thing colour was there for.
 *
 * So a service takes its colour from where it sits in the business's own list
 * of services — which is the same on Tuesday as it is on Thursday, and gives
 * the first six services six different colours by construction. A hash of the
 * name was the first answer and it collided on the sample that matters: in a
 * salon offering צבע לשיער and פן, both came out the same blue.
 *
 * A service the list does not know — an appointment keeps the name it was
 * booked under, so a service since renamed or removed still appears — falls
 * back to that hash. Past the sixth service colours repeat, which is the
 * honest trade: shape tells the kinds apart, a calendar's mark says whose it
 * is, and the words are always there. Colour is the fastest channel, not the
 * only one.
 */

/** How many hues the palette holds. Kept in step with globals.css. */
export const EVENT_HUES = 6;

export type EventColour = {
  /** The body of the event: a ground pale enough for ink to sit on. */
  readonly ground: string;
  /** Its leading edge, which is what the eye actually groups by. */
  readonly rail: string;
};

/**
 * FNV-1a, over UTF-16 code units.
 *
 * Any stable hash would do; this one is four lines, has no dependency, and
 * spreads short strings that differ in one letter — which is what service
 * names in the same shop tend to be.
 */
const hashOf = (value: string): number => {
  let hash = 0x811c9dc5;
  for (let at = 0; at < value.length; at += 1) {
    hash ^= value.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
};

/**
 * Which of the palette's hues a name is given.
 *
 * `offered` is the business's services in their own order. Anything in it takes
 * its position; anything else falls back to a hash of the name, which is stable
 * even though it can collide.
 */
export const hueIndexOf = (name: string, offered: readonly string[] = []): number => {
  const said = name.trim();
  const at = offered.findIndex((one) => one.trim() === said);
  return (at < 0 ? hashOf(said) : at) % EVENT_HUES;
};

export const colourOf = (name: string, offered: readonly string[] = []): EventColour => {
  const hue = hueIndexOf(name, offered) + 1;
  return { ground: `var(--event-${hue}-soft)`, rail: `var(--event-${hue})` };
};

/** How many calendars can be told apart by colour before the set repeats. */
export const LANE_COLOURS = 4;

/**
 * A calendar's own colour, which answers a different question from a service's.
 *
 * Kept off the service palette deliberately: a lane's mark sits right beside
 * the appointments it marks, and if it is drawn from the same set of colours
 * the eye reads it as one more service. These are deeper and quieter, so the
 * mark reads as "whose" rather than "what".
 *
 * An index below zero means a calendar this screen does not know about — a
 * blockage on a chair a worker cannot see — and gets the first colour rather
 * than throwing the grid off.
 */
export const laneColourOf = (index: number): string =>
  `var(--lane-${(Math.max(0, index) % LANE_COLOURS) + 1})`;
