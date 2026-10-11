import { describe, expect, it } from "vitest";
import type { ChangeDto } from "@/lib/api/types.ts";
import {
  changeMonth,
  changesIn,
  dateBlockOf,
  dayLineOf,
  isBusinessIn,
  mergedWithPrevious,
  nothingSet,
  tooManyDiffer,
  weekDiffers,
  weekIsSaveable,
  withBreak,
} from "./schedule-model.ts";
import type { DayHours } from "./week.ts";

const open = (...ranges: { start: string; end: string }[]): DayHours => ({ open: true, ranges });
const shut: DayHours = { open: false, ranges: [{ start: "09:00", end: "17:00" }] };
const range = (start: string, end: string) => ({ start, end });

const aChange = (overrides: Partial<ChangeDto> = {}): ChangeDto => ({
  id: "c1",
  scope: { kind: "CALENDAR", resourceId: "dana" },
  outcome: "OFF_ALL_DAY",
  fromDate: "2026-10-13",
  toDate: "2026-10-13",
  days: [{ date: "2026-10-13", ranges: [] }],
  ranges: [],
  note: null,
  ...overrides,
});

describe("adding a break", () => {
  it("cuts an hour out of the middle of the day, on the hour", () => {
    expect(withBreak([range("09:00", "19:00")])).toEqual([range("09:00", "13:00"), range("14:00", "19:00")]);
    expect(withBreak([range("08:00", "20:00")])).toEqual([range("08:00", "13:00"), range("14:00", "20:00")]);
  });

  it("cuts it from the longest stretch, leaving the others as they are", () => {
    expect(withBreak([range("08:00", "10:00"), range("11:00", "19:00")])).toEqual([
      range("08:00", "10:00"),
      range("11:00", "14:00"),
      range("15:00", "19:00"),
    ]);
  });

  it("adds any number of breaks, one each time", () => {
    const twice = withBreak(withBreak([range("08:00", "20:00")]));
    expect(twice).toHaveLength(3);
    expect(twice[0]).toEqual(range("08:00", "13:00"));
  });

  it("adds a stretch after the last when no stretch can hold an hour's break", () => {
    expect(withBreak([range("09:00", "11:00")])).toEqual([range("09:00", "11:00"), range("12:00", "14:00")]);
  });

  it("never runs past midnight, nor starts after eleven", () => {
    expect(withBreak([range("21:00", "23:30")])).toEqual([range("21:00", "23:30"), range("23:00", "23:59")]);
  });

  it("adds a stretch from nine to a day with none, or a half-typed one", () => {
    expect(withBreak([])).toEqual([range("09:00", "11:00")]);
    expect(withBreak([range("09:00", "")])).toEqual([range("09:00", ""), range("09:00", "11:00")]);
  });

  it("does not touch the ranges it was given", () => {
    const given = [range("09:00", "19:00")];
    withBreak(given);
    expect(given).toEqual([range("09:00", "19:00")]);
  });
});

describe("a stretch that runs into the one before it", () => {
  it("names the one stretch both are saved as", () => {
    expect(mergedWithPrevious([range("09:00", "13:00"), range("12:00", "18:00")], 1)).toEqual(range("09:00", "18:00"));
    expect(mergedWithPrevious([range("09:00", "18:00"), range("10:00", "12:00")], 1)).toEqual(range("09:00", "18:00"));
    expect(mergedWithPrevious([range("12:00", "14:00"), range("09:00", "12:00")], 1)).toEqual(range("09:00", "14:00"));
  });

  it("is nothing when they are apart, half-typed, or there is no stretch before", () => {
    expect(mergedWithPrevious([range("09:00", "12:00"), range("13:00", "18:00")], 1)).toBeNull();
    expect(mergedWithPrevious([range("09:00", "12:00"), range("11:00", "")], 1)).toBeNull();
    expect(mergedWithPrevious([range("09:00", "12:00")], 0)).toBeNull();
  });
});

describe("the week on screen against the week saved", () => {
  const saved = [open(range("09:00", "17:00")), shut, shut, shut, shut, shut, shut];

  it("is the same until an hour or a day changes", () => {
    expect(weekDiffers(saved.map((day) => ({ ...day })), saved)).toBe(false);
    expect(weekDiffers([open(range("09:00", "18:00")), ...saved.slice(1)], saved)).toBe(true);
    expect(weekDiffers([shut, ...saved.slice(1)], saved)).toBe(true);
  });

  it("ignores the hours a day that is not worked keeps in reserve", () => {
    expect(weekDiffers([saved[0]!, { open: false, ranges: [range("10:00", "11:00")] }, ...saved.slice(2)], saved)).toBe(false);
  });

  it("sees a half-typed time as a change", () => {
    expect(weekDiffers([open(range("09:00", "")), ...saved.slice(1)], saved)).toBe(true);
  });
});

describe("whether the week can be saved", () => {
  it("needs at least one day worked", () => {
    expect(weekIsSaveable([shut, shut, shut, shut, shut, shut, shut])).toBe(false);
    expect(nothingSet([shut, shut, shut, shut, shut, shut, shut])).toBe(true);
    expect(weekIsSaveable([open(range("09:00", "17:00")), shut, shut, shut, shut, shut, shut])).toBe(true);
    expect(nothingSet([open(range("09:00", "17:00")), shut, shut, shut, shut, shut, shut])).toBe(false);
  });

  it("waits for every time to be complete, and every end to follow its start", () => {
    expect(weekIsSaveable([open(range("09:00", "")), shut, shut, shut, shut, shut, shut])).toBe(false);
    expect(weekIsSaveable([open(range("17:00", "09:00")), shut, shut, shut, shut, shut, shut])).toBe(false);
    expect(weekIsSaveable([open(), shut, shut, shut, shut, shut, shut])).toBe(false);
  });
});

describe("when the week reads better day by day", () => {
  const nine = (end: string) => open(range("09:00", end));

  it("is when four worked days differ from the usual", () => {
    const week = [nine("17:00"), nine("17:00"), nine("13:00"), nine("14:00"), nine("15:00"), nine("16:00"), shut];
    expect(tooManyDiffer(week, [2, 3, 4, 5, 6])).toBe(true);
    expect(tooManyDiffer(week, [2, 3, 4, 6])).toBe(false);
  });

  it("is not when the days that differ are days off", () => {
    const twoDays = [shut, nine("17:00"), shut, nine("17:00"), shut, shut, shut];
    expect(tooManyDiffer(twoDays, [0, 2, 4, 5, 6])).toBe(false);
  });
});

describe("a day's row", () => {
  it("says a day not worked", () => {
    expect(dayLineOf(shut)).toEqual({ kind: "off" });
  });

  it("says its hours, merged, in the order of the day", () => {
    expect(dayLineOf(open(range("16:00", "20:00"), range("09:00", "13:00")))).toEqual({
      kind: "hours",
      text: "09:00–13:00, 16:00–20:00",
      incomplete: false,
    });
    expect(dayLineOf(open(range("09:00", "13:00"), range("12:00", "18:00")))).toMatchObject({ text: "09:00–18:00" });
  });

  it("flags a half-typed time, and a day open with no hours", () => {
    expect(dayLineOf(open(range("09:00", "13:00"), range("19:00", "")))).toEqual({
      kind: "hours",
      text: "09:00–13:00",
      incomplete: true,
    });
    expect(dayLineOf(open())).toEqual({ kind: "hours", text: "", incomplete: true });
  });
});

describe("the changes a view lists", () => {
  const business = aChange({ id: "b1", scope: { kind: "BUSINESS" }, fromDate: "2026-10-15", toDate: "2026-10-17" });
  const dana = aChange({ id: "d1", fromDate: "2026-10-13" });
  const ron = aChange({ id: "r1", scope: { kind: "CALENDAR", resourceId: "ron" }, fromDate: "2026-10-20" });
  const all = [ron, business, dana];

  it("lists only the business's own under the whole business", () => {
    expect(changesIn(all, { kind: "BUSINESS" }).map((change) => change.id)).toEqual(["b1"]);
  });

  it("lists a calendar's own and the business's, in date order", () => {
    expect(changesIn(all, { kind: "CALENDAR", resourceId: "dana" }).map((change) => change.id)).toEqual(["d1", "b1"]);
    expect(changesIn(all, { kind: "CALENDAR", resourceId: "ron" }).map((change) => change.id)).toEqual(["b1", "r1"]);
  });

  it("breaks a tie on the same day the same way every time", () => {
    const same = [aChange({ id: "z", fromDate: "2026-10-13" }), aChange({ id: "a", fromDate: "2026-10-13" })];
    expect(changesIn(same, { kind: "CALENDAR", resourceId: "dana" }).map((change) => change.id)).toEqual(["a", "z"]);
  });

  it("is empty for a calendar nobody changed in a business with no changes of its own", () => {
    expect(changesIn([ron], { kind: "CALENDAR", resourceId: "dana" })).toEqual([]);
    expect(changesIn([], { kind: "BUSINESS" })).toEqual([]);
  });

  it("does not reorder the list it was given", () => {
    changesIn(all, { kind: "CALENDAR", resourceId: "dana" });
    expect(all.map((change) => change.id)).toEqual(["r1", "b1", "d1"]);
  });

  it("marks the business's changes only inside a calendar's view", () => {
    expect(isBusinessIn(business, { kind: "CALENDAR", resourceId: "dana" })).toBe(true);
    expect(isBusinessIn(business, { kind: "BUSINESS" })).toBe(false);
    expect(isBusinessIn(dana, { kind: "CALENDAR", resourceId: "dana" })).toBe(false);
  });
});

describe("a change's date", () => {
  it("is the day large and the month short, in either language", () => {
    expect(dateBlockOf("2026-10-05", "he")).toEqual({ day: "5", month: "אוק׳" });
    expect(dateBlockOf("2026-10-15", "en")).toEqual({ day: "15", month: "Oct" });
  });

  it("names the month a change starts in, for the heading over it", () => {
    expect(changeMonth({ fromDate: "2026-10-15" }, "he")).toBe("אוקטובר 2026");
    expect(changeMonth({ fromDate: "2026-11-01" }, "en")).toBe("November 2026");
  });
});
