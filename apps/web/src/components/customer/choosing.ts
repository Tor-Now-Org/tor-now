/**
 * Choosing some of a small set, with "any" as one of the choices.
 *
 * Both rows of the waiting sheet ask the same shape of question — which parts
 * of the day, which calendars — so they behave the same way, out of one place.
 *
 * The first cut treated "any" as a fourth chip and drew a part as unselected
 * whenever everything was selected. That looked tidy and behaved appallingly:
 * with "any" showing, the three parts read as off while all three were in the
 * set, so pressing one *removed* it, two chips lit up that the person had not
 * touched, and the one they pressed stayed dark. Every press did the opposite
 * of what it looked like.
 *
 * The rule here is the one people expect of a filter. "Any" means all of them.
 * Pressing a single choice while "any" is showing narrows to that one, because
 * somebody pressing "morning" wants mornings, not everything-except-mornings.
 * After that it is an ordinary toggle — and emptying the set returns to "any"
 * rather than to a dead end, since nobody wants to wait for nothing.
 */
export const chosenAfterPressing = <T>(
  everything: readonly T[],
  chosen: readonly T[],
  pressed: T | "ANY",
): readonly T[] => {
  if (pressed === "ANY") return everything;

  const isEverything = chosen.length === everything.length;
  if (isEverything) return [pressed];

  const without = chosen.filter((one) => one !== pressed);
  if (without.length !== chosen.length) {
    return without.length === 0 ? everything : without;
  }
  // Kept in the set's own order, so two people who chose the same things store
  // them the same way and the sentence describing them reads forwards.
  return everything.filter((one) => chosen.includes(one) || one === pressed);
};

/** Whether "any" is what is showing: every choice taken is the same as none. */
export const isAny = <T>(everything: readonly T[], chosen: readonly T[]): boolean =>
  chosen.length === everything.length;
