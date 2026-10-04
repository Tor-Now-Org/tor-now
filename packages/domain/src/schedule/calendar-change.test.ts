import { describe, expect, it } from "vitest";
import type { Block, DateOverride } from "../model/schedule.ts";
import type { BlockId, BusinessId, DateOverrideId, ResourceId } from "../model/ids.ts";
import type { LocalDate } from "../time/local-date.ts";
import { parseLocalTime } from "../time/local-time.ts";
import { timeZone, zonedToInstant } from "../time/zone.ts";
import {
  changeDates,
  classifyChanges,
  parseChangeId,
  wholeDayRange,
  type CalendarChange,
} from "./calendar-change.ts";

const ZONE = timeZone("Asia/Jerusalem");
const BUSINESS = "b" as BusinessId;
const A = "calendar-a" as ResourceId;
const B = "calendar-b" as ResourceId;
const C = "calendar-c" as ResourceId;
const date = (text: string) => text as LocalDate;
const at = (day: string, clock: string) => zonedToInstant(date(day), parseLocalTime(clock), ZONE);
const hours = (start: string, end: string) => ({ start: parseLocalTime(start), end: parseLocalTime(end) });

let sequence = 0;
const override = (
  resourceId: ResourceId,
  day: string,
  ranges: { start: string; end: string }[] = [],
  note: string | null = null,
): DateOverride => ({
  id: `o${(sequence += 1)}` as DateOverrideId,
  resourceId,
  businessId: BUSINESS,
  date: date(day),
  note,
  ranges: ranges.map((range) => hours(range.start, range.end)),
});

const block = (
  resourceId: ResourceId,
  groupId: string,
  from: [string, string],
  to: [string, string],
  reason = "",
): Block => ({
  id: `k${(sequence += 1)}` as BlockId,
  resourceId,
  businessId: BUSINESS,
  startAt: at(...from),
  endAt: at(...to),
  reason,
  groupId,
});

const classify = (input: {
  calendars?: readonly ResourceId[];
  overrides?: readonly DateOverride[];
  blocks?: readonly Block[];
}): readonly CalendarChange[] =>
  classifyChanges({
    calendars: input.calendars ?? [A, B],
    overrides: input.overrides ?? [],
    blocks: input.blocks ?? [],
    timeZone: ZONE,
  });

describe("a change made of blockages", () => {
  it("is a calendar's day off when every day of it is whole", () => {
    const [change] = classify({
      blocks: [
        block(A, "g1", ["2026-10-07", "00:00"], ["2026-10-07", "23:59"], "חופשה"),
        block(A, "g1", ["2026-10-08", "00:00"], ["2026-10-08", "23:59"], "חופשה"),
      ],
    });
    expect(change).toEqual({
      id: "blocks:g1",
      scope: { kind: "CALENDAR", resourceId: A },
      outcome: "OFF_ALL_DAY",
      fromDate: "2026-10-07",
      toDate: "2026-10-08",
      days: [
        { date: "2026-10-07", ranges: [] },
        { date: "2026-10-08", ranges: [] },
      ],
      ranges: [],
      note: "חופשה",
    });
  });

  it("is part of a calendar's day when it leaves some of it", () => {
    const [change] = classify({
      blocks: [block(A, "g2", ["2026-10-06", "13:00"], ["2026-10-06", "15:00"], "רופא שיניים")],
    });
    expect(change).toMatchObject({
      id: "blocks:g2",
      scope: { kind: "CALENDAR", resourceId: A },
      outcome: "OFF_PART",
      fromDate: "2026-10-06",
      toDate: "2026-10-06",
      ranges: [hours("13:00", "15:00")],
      note: "רופא שיניים",
    });
  });

  it("keeps several hours of one day, and the same hours across days", () => {
    const [change] = classify({
      blocks: [
        block(A, "g3", ["2026-10-06", "10:00"], ["2026-10-06", "11:00"]),
        block(A, "g3", ["2026-10-06", "14:00"], ["2026-10-06", "15:00"]),
        block(A, "g3", ["2026-10-07", "10:00"], ["2026-10-07", "11:00"]),
        block(A, "g3", ["2026-10-07", "14:00"], ["2026-10-07", "15:00"]),
      ],
    });
    expect(change?.ranges).toEqual([hours("10:00", "11:00"), hours("14:00", "15:00")]);
    expect(change?.days).toHaveLength(2);
  });

  it("says no common hours when the days differ, and keeps each day's own", () => {
    const [change] = classify({
      blocks: [
        block(A, "g4", ["2026-10-06", "10:00"], ["2026-10-06", "11:00"]),
        block(A, "g4", ["2026-10-07", "12:00"], ["2026-10-07", "13:00"]),
      ],
    });
    expect(change?.ranges).toBeNull();
    expect(change?.days).toEqual([
      { date: "2026-10-06", ranges: [hours("10:00", "11:00")] },
      { date: "2026-10-07", ranges: [hours("12:00", "13:00")] },
    ]);
  });

  it("splits one span across midnight into the days it touches", () => {
    // Made before blockages were per day: Monday at ten to Wednesday at two.
    const [change] = classify({
      blocks: [block(A, "g5", ["2026-10-05", "10:00"], ["2026-10-07", "14:00"])],
    });
    expect(change?.outcome).toBe("OFF_PART");
    expect(change?.days).toEqual([
      { date: "2026-10-05", ranges: [hours("10:00", "24:00")] },
      { date: "2026-10-06", ranges: [wholeDayRange()] },
      { date: "2026-10-07", ranges: [hours("00:00", "14:00")] },
    ]);
  });

  it("does not count the midnight a span ends on as a day", () => {
    const [change] = classify({
      blocks: [block(A, "g6", ["2026-10-06", "22:00"], ["2026-10-07", "00:00"])],
    });
    expect(change?.days).toEqual([{ date: "2026-10-06", ranges: [hours("22:00", "24:00")] }]);
  });

  it("is the whole business's when one decision stands on every calendar", () => {
    const [change] = classify({
      calendars: [A, B, C],
      blocks: [
        block(A, "g7", ["2026-10-06", "13:00"], ["2026-10-06", "14:00"], "ישיבת צוות"),
        block(B, "g7", ["2026-10-06", "13:00"], ["2026-10-06", "14:00"], "ישיבת צוות"),
        block(C, "g7", ["2026-10-06", "13:00"], ["2026-10-06", "14:00"], "ישיבת צוות"),
      ],
    });
    expect(change).toMatchObject({
      id: "blocks:g7",
      scope: { kind: "BUSINESS" },
      outcome: "OFF_PART",
      ranges: [hours("13:00", "14:00")],
      note: "ישיבת צוות",
    });
  });

  it("is a calendar's in a business with one calendar", () => {
    const [change] = classify({
      calendars: [A],
      blocks: [block(A, "g8", ["2026-10-06", "00:00"], ["2026-10-06", "23:59"])],
    });
    expect(change?.scope).toEqual({ kind: "CALENDAR", resourceId: A });
  });

  it("keeps two decisions on one day apart", () => {
    const changes = classify({
      blocks: [
        block(A, "first", ["2026-10-06", "09:00"], ["2026-10-06", "10:00"]),
        block(A, "second", ["2026-10-06", "15:00"], ["2026-10-06", "16:00"]),
      ],
    });
    expect(changes.map((change) => change.id)).toEqual(["blocks:first", "blocks:second"]);
  });

  it("says nothing as the note when none was given", () => {
    const [change] = classify({ blocks: [block(A, "g9", ["2026-10-06", "09:00"], ["2026-10-06", "10:00"], "  ")] });
    expect(change?.note).toBeNull();
  });
});

describe("a change made of special days", () => {
  it("is the business closed when every calendar is shut that day", () => {
    const [change] = classify({
      overrides: [override(A, "2026-10-15", [], "יום כיפור"), override(B, "2026-10-15", [], "יום כיפור")],
    });
    expect(change).toEqual({
      id: "closure:2026-10-15:2026-10-15",
      scope: { kind: "BUSINESS" },
      outcome: "OFF_ALL_DAY",
      fromDate: "2026-10-15",
      toDate: "2026-10-15",
      days: [{ date: "2026-10-15", ranges: [] }],
      ranges: [],
      note: "יום כיפור",
    });
  });

  it("is the business on other hours when every calendar keeps the same ones", () => {
    const [change] = classify({
      overrides: [
        override(A, "2026-10-09", [{ start: "09:00", end: "13:00" }], "ערב חג"),
        override(B, "2026-10-09", [{ start: "09:00", end: "13:00" }], "ערב חג"),
      ],
    });
    expect(change).toMatchObject({
      id: "closure:2026-10-09:2026-10-09",
      scope: { kind: "BUSINESS" },
      outcome: "OTHER_HOURS",
      ranges: [hours("09:00", "13:00")],
    });
  });

  it("runs consecutive days with the same hours and words into one change", () => {
    const changes = classify({
      overrides: ["2026-10-07", "2026-10-08", "2026-10-09"].flatMap((day) => [
        override(A, day, [], "חופש"),
        override(B, day, [], "חופש"),
      ]),
    });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ id: "closure:2026-10-07:2026-10-09", fromDate: "2026-10-07", toDate: "2026-10-09" });
    expect(changeDates(changes[0]!)).toEqual(["2026-10-07", "2026-10-08", "2026-10-09"]);
  });

  it("starts a new change where the hours, the words or the run break", () => {
    const changes = classify({
      overrides: [
        override(A, "2026-10-07", [], "חופש"),
        override(B, "2026-10-07", [], "חופש"),
        // Other words the next day.
        override(A, "2026-10-08", [], "מילואים"),
        override(B, "2026-10-08", [], "מילואים"),
        // A gap, then the same words again.
        override(A, "2026-10-10", [], "מילואים"),
        override(B, "2026-10-10", [], "מילואים"),
      ],
    });
    expect(changes.map((change) => change.id)).toEqual([
      "closure:2026-10-07:2026-10-07",
      "closure:2026-10-08:2026-10-08",
      "closure:2026-10-10:2026-10-10",
    ]);
  });

  it("is one calendar's other hours when only it was given them", () => {
    const [change] = classify({
      overrides: [override(A, "2026-10-09", [{ start: "12:00", end: "18:00" }], "פתיחה מאוחרת")],
    });
    expect(change).toMatchObject({
      id: "hours:calendar-a:2026-10-09:2026-10-09",
      scope: { kind: "CALENDAR", resourceId: A },
      outcome: "OTHER_HOURS",
      ranges: [hours("12:00", "18:00")],
      note: "פתיחה מאוחרת",
    });
  });

  it("is one calendar's day off when only it is shut", () => {
    const [change] = classify({ overrides: [override(B, "2026-10-09")] });
    expect(change).toMatchObject({ scope: { kind: "CALENDAR", resourceId: B }, outcome: "OFF_ALL_DAY" });
  });

  it("is each calendar's own when they keep different hours", () => {
    const changes = classify({
      overrides: [
        override(A, "2026-10-09", [{ start: "09:00", end: "13:00" }]),
        override(B, "2026-10-09", [{ start: "10:00", end: "13:00" }]),
      ],
    });
    expect(changes.map((change) => change.scope)).toEqual([
      { kind: "CALENDAR", resourceId: A },
      { kind: "CALENDAR", resourceId: B },
    ]);
  });

  it("is not the business's when a calendar said nothing that day", () => {
    const changes = classify({ calendars: [A, B, C], overrides: [override(A, "2026-10-09"), override(B, "2026-10-09")] });
    expect(changes.every((change) => change.scope.kind === "CALENDAR")).toBe(true);
  });

  it("is the business's even when the calendars were given different words", () => {
    const [change] = classify({ overrides: [override(A, "2026-10-09", [], "חג"), override(B, "2026-10-09", [], "חופש")] });
    expect(change).toMatchObject({ scope: { kind: "BUSINESS" }, note: null });
  });

  it("is a calendar's in a business with one calendar", () => {
    const [change] = classify({ calendars: [A], overrides: [override(A, "2026-10-09")] });
    expect(change?.scope).toEqual({ kind: "CALENDAR", resourceId: A });
    expect(change?.id).toBe("hours:calendar-a:2026-10-09:2026-10-09");
  });

  it("ignores the days of a calendar no longer on offer", () => {
    // B was withdrawn; its old special day neither shows nor stops A's being the shop's.
    const changes = classify({ calendars: [A], overrides: [override(B, "2026-10-09"), override(A, "2026-10-10")] });
    expect(changes.map((change) => change.id)).toEqual(["hours:calendar-a:2026-10-10:2026-10-10"]);
  });
});

describe("the list of changes", () => {
  it("is in date order, the business's first on the same day", () => {
    const changes = classify({
      overrides: [override(A, "2026-10-09", [{ start: "10:00", end: "12:00" }])],
      blocks: [
        block(B, "later", ["2026-10-12", "09:00"], ["2026-10-12", "10:00"]),
        block(A, "shop", ["2026-10-09", "13:00"], ["2026-10-09", "14:00"]),
        block(B, "shop", ["2026-10-09", "13:00"], ["2026-10-09", "14:00"]),
      ],
    });
    expect(changes.map((change) => change.id)).toEqual([
      "blocks:shop",
      "hours:calendar-a:2026-10-09:2026-10-09",
      "blocks:later",
    ]);
  });

  it("is empty when nothing was changed", () => {
    expect(classify({})).toEqual([]);
  });
});

describe("a change's id", () => {
  it("reads back what it names", () => {
    expect(parseChangeId("blocks:3f2a")).toEqual({ kind: "BLOCKS", groupId: "3f2a" });
    expect(parseChangeId("closure:2026-10-07:2026-10-09")).toEqual({
      kind: "CLOSURE",
      fromDate: "2026-10-07",
      toDate: "2026-10-09",
    });
    expect(parseChangeId("hours:calendar-a:2026-10-07:2026-10-08")).toEqual({
      kind: "HOURS",
      resourceId: "calendar-a",
      fromDate: "2026-10-07",
      toDate: "2026-10-08",
    });
  });

  it("is refused when it names nothing", () => {
    for (const nonsense of ["", "blocks:", "closure:2026-10-07", "hours:a:2026-13-01:2026-10-01", "closure:2026-10-09:2026-10-07", "x:y"]) {
      expect(parseChangeId(nonsense), nonsense).toBeNull();
    }
  });
});
