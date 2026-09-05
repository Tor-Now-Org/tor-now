import { describe, expect, it } from "vitest";
import type { DayHours } from "./week.ts";
import {
  breakBetween,
  collidesWithPrevious,
  exceptionsTo,
  isUsable,
  usualOf,
  weekIsUsable,
} from "./usual-week.ts";

const open = (...ranges: { start: string; end: string }[]): DayHours => ({
  open: true,
  ranges,
});
const shut: DayHours = { open: false, ranges: [{ start: "09:00", end: "17:00" }] };
const nineToFive = { start: "09:00", end: "17:00" };
const tillOne = { start: "09:00", end: "13:00" };

describe("the usual week", () => {
  it("is the hours the most days keep", () => {
    // Sunday to Thursday nine to five, Friday till one, Saturday shut — the
    // week nearly every business in the country works.
    const week = [
      open(nineToFive),
      open(nineToFive),
      open(nineToFive),
      open(nineToFive),
      open(nineToFive),
      open(tillOne),
      shut,
    ];

    expect(usualOf(week)).toEqual({ days: [0, 1, 2, 3, 4], ranges: [nineToFive] });
    expect(exceptionsTo(usualOf(week))).toEqual([5, 6]);
  });

  it("compares what would be stored, not what was typed", () => {
    // One day says 09:00–13:00 and 13:00–17:00; both store as 09:00–17:00, so
    // it is the same day as the rest and not an exception.
    const week = [
      open({ start: "09:00", end: "13:00" }, { start: "13:00", end: "17:00" }),
      open(nineToFive),
      open(nineToFive),
      shut,
      shut,
      shut,
      shut,
    ];

    expect(usualOf(week).days).toEqual([0, 1, 2]);
  });

  it("hands the hours back as they were typed, not as they will be stored", () => {
    // Merging here would collapse a day's two stretches into one while somebody
    // was editing them — the row under the hand would simply vanish.
    const week = [
      open({ start: "09:00", end: "13:00" }, { start: "12:00", end: "17:00" }),
      shut,
      shut,
      shut,
      shut,
      shut,
      shut,
    ];

    expect(usualOf(week).ranges).toEqual([
      { start: "09:00", end: "13:00" },
      { start: "12:00", end: "17:00" },
    ]);
  });

  it("keeps a day the owner pulled out, even when its hours still match", () => {
    const week = [open(nineToFive), open(nineToFive), open(nineToFive), shut, shut, shut, shut];

    // Without this the day would be swallowed straight back into the group,
    // which reads as the screen undoing the tap.
    expect(usualOf(week, [2]).days).toEqual([0, 1]);
    expect(exceptionsTo(usualOf(week, [2]))).toContain(2);
  });

  it("gives a tie to the group holding the earliest day, so it does not wander", () => {
    const week = [open(nineToFive), open(nineToFive), open(tillOne), open(tillOne), shut, shut, shut];

    expect(usualOf(week).days).toEqual([0, 1]);
  });

  it("has no usual at all when the week is shut", () => {
    expect(usualOf([shut, shut, shut, shut, shut, shut, shut])).toEqual({
      days: [],
      ranges: [],
    });
  });
});

describe("what sits between two stretches", () => {
  const ranges = [tillOne, { start: "16:00", end: "19:00" }];

  it("is the break, with its own times", () => {
    expect(breakBetween(ranges, 1)).toEqual({ start: "13:00", end: "16:00" });
    expect(collidesWithPrevious(ranges, 1)).toBe(false);
  });

  it("is nothing at all before the first stretch", () => {
    expect(breakBetween(ranges, 0)).toBeNull();
    expect(collidesWithPrevious(ranges, 0)).toBe(false);
  });

  it("is a collision when the second starts before the first has ended", () => {
    const overlapping = [tillOne, { start: "12:00", end: "19:00" }];
    expect(breakBetween(overlapping, 1)).toBeNull();
    expect(collidesWithPrevious(overlapping, 1)).toBe(true);
  });

  it("counts touching stretches as a collision too, since they store as one", () => {
    const touching = [tillOne, { start: "13:00", end: "19:00" }];
    expect(breakBetween(touching, 1)).toBeNull();
    expect(collidesWithPrevious(touching, 1)).toBe(true);
  });
});

describe("a week that could not be stored as it reads", () => {
  it("is one with a day open and nothing to show for it", () => {
    // Stored, this is a closed day. On screen it says the business is open,
    // so saving it would be the screen and the store disagreeing.
    expect(weekIsUsable([{ open: true, ranges: [] }, shut, shut, shut, shut, shut, shut]))
      .toBe(false);
  });

  it("is not one that is simply shut all week", () => {
    expect(weekIsUsable([shut, shut, shut, shut, shut, shut, shut])).toBe(true);
  });
});

describe("a time the browser is still being told", () => {
  it("is not a stretch, and not a week that can be saved", () => {
    // What a native time field reports while only half of it has been set.
    expect(isUsable({ start: "", end: "17:00" })).toBe(false);
    expect(isUsable({ start: "09:00", end: "" })).toBe(false);
    expect(isUsable({ start: "17:00", end: "09:00" })).toBe(false);
    expect(isUsable({ start: "09:00", end: "17:00" })).toBe(true);

    expect(weekIsUsable([open({ start: "09:00", end: "" }), shut, shut, shut, shut, shut, shut]))
      .toBe(false);
    // A closed day keeps whatever was last in its fields, and none of it is
    // going to be stored, so it cannot be what blocks a save.
    expect(
      weekIsUsable([
        { open: false, ranges: [{ start: "09:00", end: "" }] },
        shut,
        shut,
        shut,
        shut,
        shut,
        shut,
      ]),
    ).toBe(true);
  });

  it("says nothing about the gap on either side of it", () => {
    const halfTyped = [{ start: "09:00", end: "13:00" }, { start: "", end: "19:00" }];
    expect(breakBetween(halfTyped, 1)).toBeNull();
    expect(collidesWithPrevious(halfTyped, 1)).toBe(false);
  });
});
