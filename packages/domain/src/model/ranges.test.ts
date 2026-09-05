import { describe, expect, it } from "vitest";
import { mergedRanges } from "./ranges.ts";

/**
 * A day's working hours as a set of ranges, tidied.
 *
 * ADR 0002 stores ranges and reads the gap between two of them as a break, so
 * two ranges that touch or overlap describe one continuous stretch — with a
 * break of zero or of negative length between them, which is not a thing.
 */
describe("merging a day's ranges", () => {
  it("leaves ranges with a real gap between them alone", () => {
    expect(
      mergedRanges([
        { start: "09:00", end: "13:00" },
        { start: "16:00", end: "20:00" },
      ]),
    ).toEqual([
      { start: "09:00", end: "13:00" },
      { start: "16:00", end: "20:00" },
    ]);
  });

  it("collapses two that say the same thing", () => {
    expect(
      mergedRanges([
        { start: "09:00", end: "17:00" },
        { start: "09:00", end: "17:00" },
      ]),
    ).toEqual([{ start: "09:00", end: "17:00" }]);
  });

  it("joins ones that overlap", () => {
    expect(
      mergedRanges([
        { start: "09:00", end: "13:00" },
        { start: "12:00", end: "17:00" },
      ]),
    ).toEqual([{ start: "09:00", end: "17:00" }]);
  });

  it("joins ones that merely touch, since a break of no length is not a break", () => {
    expect(
      mergedRanges([
        { start: "09:00", end: "13:00" },
        { start: "13:00", end: "17:00" },
      ]),
    ).toEqual([{ start: "09:00", end: "17:00" }]);
  });

  it("swallows one wholly inside another", () => {
    expect(
      mergedRanges([
        { start: "09:00", end: "20:00" },
        { start: "11:00", end: "12:00" },
      ]),
    ).toEqual([{ start: "09:00", end: "20:00" }]);
  });

  it("sorts what it returns, whatever order it was given", () => {
    expect(
      mergedRanges([
        { start: "16:00", end: "20:00" },
        { start: "09:00", end: "13:00" },
      ]),
    ).toEqual([
      { start: "09:00", end: "13:00" },
      { start: "16:00", end: "20:00" },
    ]);
  });

  it("drops a range that ends before it starts, and one of no length", () => {
    // Neither describes any time at all; keeping them would mean storing rows
    // that can never offer a slot.
    expect(
      mergedRanges([
        { start: "17:00", end: "09:00" },
        { start: "12:00", end: "12:00" },
        { start: "09:00", end: "17:00" },
      ]),
    ).toEqual([{ start: "09:00", end: "17:00" }]);
  });

  it("has nothing to say about no ranges", () => {
    expect(mergedRanges([])).toEqual([]);
  });
});
