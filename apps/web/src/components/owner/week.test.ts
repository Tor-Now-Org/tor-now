import { describe, expect, it } from "vitest";
import { rangesFor, weekFromRanges, type DayHours } from "./week.ts";

describe("the ranges a day is stored as", () => {
  it("are written to the day being saved, whatever the range remembers", () => {
    // The API sends {dayOfWeek, start, end}, and the editor copies one day's
    // stretches onto every day that keeps the same hours. Spreading the range
    // over the day let the range's own dayOfWeek win, and the entire week was
    // written to Sunday — every other day lost its hours.
    const fromTheApi = [{ dayOfWeek: 0, start: "09:00", end: "17:00" }];
    const day: DayHours = { open: true, ranges: fromTheApi };

    expect(rangesFor(day, 3)).toEqual([{ dayOfWeek: 3, start: "09:00", end: "17:00" }]);
  });

  it("are nothing at all for a closed day", () => {
    expect(rangesFor({ open: false, ranges: [{ start: "09:00", end: "17:00" }] }, 2)).toEqual(
      [],
    );
  });

  it("are merged, so two that touch are the one stretch they describe", () => {
    const day: DayHours = {
      open: true,
      ranges: [
        { start: "09:00", end: "13:00" },
        { start: "13:00", end: "17:00" },
      ],
    };

    expect(rangesFor(day, 1)).toEqual([{ dayOfWeek: 1, start: "09:00", end: "17:00" }]);
  });
});

describe("the week a stored calendar reads as", () => {
  it("keeps nothing of the rows it came from but the times", () => {
    const week = weekFromRanges([
      { dayOfWeek: 1, start: "09:00", end: "13:00" },
      { dayOfWeek: 1, start: "16:00", end: "19:00" },
      { dayOfWeek: 4, start: "09:00", end: "17:00" },
    ]);

    expect(week[1]).toEqual({
      open: true,
      ranges: [
        { start: "09:00", end: "13:00" },
        { start: "16:00", end: "19:00" },
      ],
    });
    // A day with no rows is closed, and still carries times to show if it is
    // opened again.
    expect(week[0]?.open).toBe(false);
    expect(week[0]?.ranges).toHaveLength(1);

    // And a day taken from the store can be written straight back to a
    // different day without dragging the old one along.
    const monday = week[1];
    expect(monday === undefined ? [] : rangesFor(monday, 5)).toEqual([
      { dayOfWeek: 5, start: "09:00", end: "13:00" },
      { dayOfWeek: 5, start: "16:00", end: "19:00" },
    ]);
  });
});
