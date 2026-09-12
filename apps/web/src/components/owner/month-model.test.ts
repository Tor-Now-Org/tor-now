import { describe, expect, it } from "vitest";
import {
  columnOf,
  datesBetween,
  labelFitting,
  labelFor,
  packBands,
  segmentIn,
  weeksOf,
} from "./month-model.ts";

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

  it("says the kind on a single day when the reason will not fit in one", () => {
    // One day is about fifty pixels across, which is seven Hebrew letters —
    // past that comes "שיפוץ שנת…", a truncation that reads as a fault.
    expect(labelFor("שיפוץ שנתי במספרה", 1, "חסום")).toBe("חסום");
    expect(labelFor("מילואים", 1, "חסום")).toBe("מילואים");
  });

  it("takes the first of several things it could say that fits", () => {
    // Whose it is and why, then why, then what kind of thing it is.
    const said = ["יומן א · מילואים", "מילואים", "חסום"];
    expect(labelFitting(said, 3)).toBe("יומן א · מילואים");
    expect(labelFitting(said, 1)).toBe("מילואים");
    expect(labelFitting(["שיפוץ שנתי במספרה", "חסום"], 1)).toBe("חסום");
  });

  it("falls back to the shortest it was offered, even when that will not fit", () => {
    // A floor rather than an empty band: something is always said.
    expect(labelFitting(["ארוך מאוד מאוד", "גם זה ארוך"], 1)).toBe("גם זה ארוך");
  });

  it("ignores blanks among the things it could say", () => {
    expect(labelFitting(["", "מילואים", "חסום"], 1)).toBe("מילואים");
    expect(labelFitting(["", ""], 1)).toBe("");
  });

  it("lets a longer reason through when the band is wide enough for it", () => {
    expect(labelFor("שיפוץ במספרה", 7, "סגור")).toBe("שיפוץ במספרה");
  });
});

describe("fitting a week's bands into as few rows as they need", () => {
  const at = (column: number, width: number, name: string) => ({
    span: { name },
    column,
    width,
  });

  it("puts days that do not overlap on one line", () => {
    // The whole point: a Monday off, a Wednesday course and a Friday closure
    // are one line, not three bars stacked over the days they describe.
    const { rows, folded } = packBands([at(1, 1, "א"), at(3, 1, "ב"), at(5, 1, "ג")]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(3);
    expect(folded).toEqual([]);
  });

  it("gives a second line to something that overlaps the first", () => {
    const { rows } = packBands([at(0, 4, "שבוע"), at(2, 1, "יום")]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.[0]?.span).toEqual({ name: "שבוע" });
  });

  it("puts a band back on the first line once there is room again", () => {
    const { rows } = packBands([at(0, 2, "א"), at(0, 1, "ב"), at(4, 1, "ג")]);
    expect(rows[0]?.map((one) => one.span)).toEqual([{ name: "א" }, { name: "ג" }]);
    expect(rows[1]?.map((one) => one.span)).toEqual([{ name: "ב" }]);
  });

  it("treats touching bands as not overlapping", () => {
    // Monday–Tuesday and Wednesday are adjacent, not on top of each other.
    const { rows } = packBands([at(0, 2, "א"), at(2, 1, "ב")]);
    expect(rows).toHaveLength(1);
  });

  it("folds away everything past the rows a month can spare", () => {
    const many = [0, 1, 2, 3].map((at_) => at(at_ * 0, 7, `כל השבוע ${at_}`));
    const { rows, folded } = packBands(many);
    expect(rows).toHaveLength(2);
    expect(folded).toHaveLength(2);
  });

  it("has nothing to arrange in a quiet week", () => {
    expect(packBands([])).toEqual({ rows: [], folded: [] });
  });
});
