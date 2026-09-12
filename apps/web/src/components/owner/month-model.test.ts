import { describe, expect, it } from "vitest";
import { columnOf, datesBetween, labelFor, segmentIn, weeksOf } from "./month-model.ts";

describe("the month as rows of seven", () => {
  it("starts October 2026 on a Thursday, with three days in the first row", () => {
    const weeks = weeksOf("2026-10-01");
    expect(columnOf("2026-10-01")).toBe(4);
    expect(weeks[0]?.slice(0, 4)).toEqual([null, null, null, null]);
    expect(weeks[0]?.[4]).toBe("2026-10-01");
    expect(weeks).toHaveLength(5);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
  });

  it("keeps every date of the month exactly once", () => {
    const dates = weeksOf("2026-02-01").flat().filter((cell) => cell !== null);
    expect(dates).toHaveLength(28);
    expect(new Set(dates).size).toBe(28);
    expect(dates[0]).toBe("2026-02-01");
    expect(dates[27]).toBe("2026-02-28");
  });
});

describe("a span drawn across a week", () => {
  const weeks = weeksOf("2026-10-01");

  it("sits where its days sit", () => {
    // 12–16 October is Monday to Friday of the third row.
    const week = weeks[2] ?? [];
    const segment = segmentIn(week, { fromDate: "2026-10-12", toDate: "2026-10-16" });
    expect(segment).toMatchObject({ column: 1, width: 5 });
  });

  it("is clipped by the row, so a span crossing Saturday is drawn twice", () => {
    const one = segmentIn(weeks[2] ?? [], { fromDate: "2026-10-16", toDate: "2026-10-19" });
    const two = segmentIn(weeks[3] ?? [], { fromDate: "2026-10-16", toDate: "2026-10-19" });
    expect(one).toMatchObject({ column: 5, width: 2 });
    expect(two).toMatchObject({ column: 0, width: 2 });
  });

  it("is nothing at all in a week it does not touch", () => {
    expect(segmentIn(weeks[0] ?? [], { fromDate: "2026-10-20", toDate: "2026-10-22" })).toBeNull();
  });

  it("survives a row with leading blanks", () => {
    // The first row is Thursday to Saturday; a span starting before the month
    // is clipped to the first date that exists.
    const segment = segmentIn(weeks[0] ?? [], { fromDate: "2026-09-28", toDate: "2026-10-02" });
    expect(segment).toMatchObject({ column: 4, width: 2 });
  });
});

describe("the dates a selection covers", () => {
  it("includes both ends", () => {
    expect(datesBetween("2026-10-21", "2026-10-23")).toEqual([
      "2026-10-21", "2026-10-22", "2026-10-23",
    ]);
  });

  it("reads the same when the taps arrive backwards", () => {
    expect(datesBetween("2026-10-23", "2026-10-21")).toHaveLength(3);
  });

  it("is one day when both taps are the same day", () => {
    expect(datesBetween("2026-10-21", "2026-10-21")).toEqual(["2026-10-21"]);
  });

  it("crosses a month end", () => {
    expect(datesBetween("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02",
    ]);
  });
});

describe("what a band says", () => {
  it("says the reason it was given", () => {
    expect(labelFor("חופשה", 3, "סגור")).toBe("חופשה");
  });

  it("falls back to the kind when nothing was said", () => {
    expect(labelFor(null, 3, "סגור")).toBe("סגור");
    expect(labelFor("   ", 3, "סגור")).toBe("סגור");
  });

  it("falls back rather than cutting a long reason off mid-word", () => {
    // Two days of width cannot hold a sentence; half of one reads as a bug.
    expect(labelFor("שיפוץ במספרה, נחזור ביום ראשון בבוקר", 2, "סגור")).toBe("סגור");
  });

  it("lets a longer reason through when the band is wide enough for it", () => {
    expect(labelFor("שיפוץ במספרה", 7, "סגור")).toBe("שיפוץ במספרה");
  });
});
