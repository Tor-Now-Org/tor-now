import type { OverrideDto } from "@/lib/api/types.ts";

/**
 * Telling a calendar's own special day apart from the shop's.
 *
 * ADR 0002 keeps the schedule per calendar, so closing the business writes one
 * Override per calendar per date — there is no closure row to find. That is
 * fine until a screen offers to delete one of them: the schedule page did, and
 * deleting a single copy left the shop half shut. One chair went back to its
 * usual hours while the others kept the short ones, the month stopped calling
 * the day a closure at all (a closure is every calendar agreeing), and the
 * copies that were left were invisible from the calendar and still in force.
 *
 * So a date is read as the shop's when every calendar says the same thing
 * about it, and removing it has to mean removing all of them.
 */

/** What a calendar says about a date, reduced to what makes two of them equal. */
const shapeOf = (override: OverrideDto): string =>
  JSON.stringify([
    override.closed,
    override.ranges.map((range) => [range.start, range.end]),
  ]);

/**
 * The dates on which every calendar was given the same day.
 *
 * A business with one calendar has no distinction to draw — its calendar's
 * special day *is* the shop's — which falls out of the rule rather than being
 * a case: one calendar agreeing with itself is agreement.
 */
export const shopWideDates = (
  overridesByCalendar: readonly (readonly OverrideDto[])[],
  calendars: number,
): Set<string> => {
  if (calendars === 0 || overridesByCalendar.length < calendars) return new Set();

  const said = new Map<string, string[]>();
  overridesByCalendar.forEach((forOne) =>
    forOne.forEach((override) => {
      said.set(override.date, [...(said.get(override.date) ?? []), shapeOf(override)]);
    }),
  );

  return new Set(
    [...said.entries()]
      .filter(
        ([, shapes]) =>
          shapes.length === calendars && new Set(shapes).size === 1,
      )
      .map(([date]) => date),
  );
};
