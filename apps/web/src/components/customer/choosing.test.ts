import { describe, expect, it } from "vitest";
import { chosenAfterPressing, isAny } from "./choosing.ts";

/**
 * The bug this exists to stop: with everything selected, the individual chips
 * were drawn as unselected, so pressing one removed it from a set the person
 * could not see they were in. Two chips they never touched lit up, and the one
 * they pressed went dark.
 */
const PARTS = ["MORNING", "NOON", "EVENING"] as const;
const press = (chosen: readonly string[], pressed: string) =>
  chosenAfterPressing<string>([...PARTS], chosen, pressed);

describe("choosing some of a few, with 'any'", () => {
  it("narrows to the one pressed when 'any' was showing", () => {
    expect(press([...PARTS], "MORNING")).toEqual(["MORNING"]);
  });

  it("adds a second, in the set's own order", () => {
    expect(press(["EVENING"], "MORNING")).toEqual(["MORNING", "EVENING"]);
  });

  it("removes one that was chosen", () => {
    expect(press(["MORNING", "EVENING"], "EVENING")).toEqual(["MORNING"]);
  });

  /**
   * Waiting for nothing is not a thing anybody wants, and the domain refuses
   * an empty set. Coming back to "any" is the answer a person expects from
   * unticking the last box of a filter.
   */
  it("returns to 'any' rather than to nothing", () => {
    expect(press(["MORNING"], "MORNING")).toEqual([...PARTS]);
  });

  it("takes everything when 'any' is pressed", () => {
    expect(chosenAfterPressing<string>([...PARTS], ["NOON"], "ANY")).toEqual([...PARTS]);
  });

  it("pressing 'any' while it already shows changes nothing", () => {
    expect(chosenAfterPressing<string>([...PARTS], [...PARTS], "ANY")).toEqual([...PARTS]);
  });

  /**
   * Pressing the same chip twice should land back where it started. The first
   * cut failed this: the state after two presses depended on how many were
   * selected before the first.
   */
  it("is its own undo, from 'any' and back", () => {
    const once = press([...PARTS], "NOON");
    expect(once).toEqual(["NOON"]);
    expect(press(once, "NOON")).toEqual([...PARTS]);
  });

  it("never leaves a set that is empty or repeats itself", () => {
    let chosen: readonly string[] = [...PARTS];
    for (const pressed of ["MORNING", "NOON", "EVENING", "MORNING", "MORNING", "EVENING"]) {
      chosen = press(chosen, pressed);
      expect(chosen.length).toBeGreaterThan(0);
      expect(new Set(chosen).size).toBe(chosen.length);
      expect(chosen.every((one) => (PARTS as readonly string[]).includes(one))).toBe(true);
    }
  });

  describe("what 'any' is showing", () => {
    it("is everything, and nothing less", () => {
      expect(isAny([...PARTS], [...PARTS])).toBe(true);
      expect(isAny([...PARTS], ["MORNING", "NOON"])).toBe(false);
    });

    /** One calendar shop: the only choice is also every choice. */
    it("is true when there is only one of them", () => {
      expect(isAny(["only"], ["only"])).toBe(true);
    });
  });
});
