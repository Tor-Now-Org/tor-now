import { describe, expect, it } from "vitest";
import { daysLeft, endsAfter, GRANT_LENGTHS, isEndingSoon, isGrantEnd, latestGrantEnd } from "./grant-length.ts";

const today = "2026-09-27";

describe("a Grant's length", () => {
  it("offers a month, two and three, counted from today", () => {
    expect(GRANT_LENGTHS.map((days) => endsAfter(today, days))).toEqual(["2026-10-27", "2026-11-26", "2026-12-26"]);
  });

  it("runs at most a year ahead", () => {
    expect(latestGrantEnd(today)).toBe("2027-09-27");
    expect(isGrantEnd(today, "2027-09-27")).toBe(true);
    expect(isGrantEnd(today, "2027-09-28")).toBe(false);
  });

  it("may end today, never before, and needs a whole date", () => {
    expect(isGrantEnd(today, today)).toBe(true);
    expect(isGrantEnd(today, "2026-09-26")).toBe(false);
    expect(isGrantEnd(today, "")).toBe(false);
  });

  it("counts the days left, and marks the last week", () => {
    expect(daysLeft(today, "2026-10-02")).toBe(5);
    expect(isEndingSoon(today, "2026-10-04")).toBe(true);
    expect(isEndingSoon(today, "2026-10-05")).toBe(false);
  });
});
