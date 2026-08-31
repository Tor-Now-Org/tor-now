import { describe, expect, it } from "vitest";
import {
  clipAll,
  containsInterval,
  containsPoint,
  interval,
  intersect,
  normalize,
  overlaps,
  subtract,
  subtractAll,
  totalDuration,
} from "./interval.ts";
import { DomainError } from "../shared/errors.ts";

type Minutes = number & { readonly __brand: "LocalTime" };
const at = (value: number): Minutes => value as Minutes;
const range = (start: number, end: number) => interval(at(start), at(end));
const shape = (ranges: ReturnType<typeof range>[]) =>
  ranges.map((r) => [r.start, r.end]);

describe("Interval", () => {
  it("refuses to end before it starts", () => {
    expect(() => range(60, 30)).toThrow(DomainError);
  });

  it("treats back-to-back intervals as adjacent, not overlapping", () => {
    expect(overlaps(range(0, 60), range(60, 120))).toBe(false);
    expect(overlaps(range(0, 61), range(60, 120))).toBe(true);
  });

  it("excludes its end point", () => {
    expect(containsPoint(range(0, 60), at(59))).toBe(true);
    expect(containsPoint(range(0, 60), at(60))).toBe(false);
  });

  it("reports containment of a whole interval", () => {
    expect(containsInterval(range(0, 60), range(10, 50))).toBe(true);
    expect(containsInterval(range(0, 60), range(10, 61))).toBe(false);
  });

  it("intersects, or returns nothing when disjoint", () => {
    expect(intersect(range(0, 60), range(30, 90))).toEqual(range(30, 60));
    expect(intersect(range(0, 60), range(60, 90))).toBeNull();
  });
});

describe("subtract", () => {
  it("returns the original when there is no overlap", () => {
    expect(shape(subtract(range(0, 60), range(60, 90)))).toEqual([[0, 60]]);
  });

  it("splits into two when the hole is strictly inside", () => {
    expect(shape(subtract(range(0, 120), range(30, 60)))).toEqual([
      [0, 30],
      [60, 120],
    ]);
  });

  it("trims a leading and a trailing overlap", () => {
    expect(shape(subtract(range(0, 120), range(0, 30)))).toEqual([[30, 120]]);
    expect(shape(subtract(range(0, 120), range(90, 200)))).toEqual([[0, 90]]);
  });

  it("removes the interval entirely when fully covered", () => {
    expect(subtract(range(30, 60), range(0, 120))).toEqual([]);
  });

  it("subtracts many from many", () => {
    const remaining = subtractAll(
      [range(0, 120), range(180, 300)],
      [range(30, 60), range(200, 220)],
    );
    expect(shape(remaining)).toEqual([
      [0, 30],
      [60, 120],
      [180, 200],
      [220, 300],
    ]);
  });
});

describe("normalize", () => {
  it("sorts, merges overlapping and drops empties", () => {
    expect(
      shape(normalize([range(60, 120), range(0, 70), range(200, 200)])),
    ).toEqual([[0, 120]]);
  });

  it("merges intervals that merely touch", () => {
    expect(shape(normalize([range(0, 60), range(60, 120)]))).toEqual([[0, 120]]);
  });

  it("keeps a real gap", () => {
    expect(shape(normalize([range(0, 60), range(90, 120)]))).toEqual([
      [0, 60],
      [90, 120],
    ]);
  });

  it("absorbs a nested interval", () => {
    expect(shape(normalize([range(0, 120), range(30, 60)]))).toEqual([[0, 120]]);
  });

  it("does not mutate its input", () => {
    const input = [range(60, 120), range(0, 70)];
    normalize(input);
    expect(shape(input)).toEqual([
      [60, 120],
      [0, 70],
    ]);
  });
});

describe("clipAll", () => {
  it("trims to the bounds and drops what falls outside", () => {
    expect(
      shape(clipAll([range(0, 60), range(120, 180)], range(30, 140))),
    ).toEqual([
      [30, 60],
      [120, 140],
    ]);
  });
});

describe("totalDuration", () => {
  it("sums the covered time", () => {
    expect(totalDuration([range(0, 60), range(120, 150)])).toBe(90);
  });
});
