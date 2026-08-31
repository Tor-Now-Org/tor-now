import { describe, expect, it } from "vitest";
import { breaksOn, openIntervalsOn } from "./open-hours.ts";
import { parseLocalDate } from "../time/local-date.ts";
import { parseLocalTime } from "../time/local-time.ts";
import { asId } from "../model/ids.ts";
import type { DateOverride, WorkingHours } from "../model/schedule.ts";
import { interval } from "../time/interval.ts";

const t = parseLocalTime;
const shape = (ranges: { start: number; end: number }[]) =>
  ranges.map((r) => [r.start, r.end]);

const hours = (dayOfWeek: number, start: string, end: string): WorkingHours =>
  ({
    id: asId(`wh-${dayOfWeek}-${start}`),
    resourceId: asId("resource"),
    businessId: asId("business"),
    dayOfWeek,
    start: t(start),
    end: t(end),
  }) as WorkingHours;

const override = (date: string, ranges: [string, string][]): DateOverride =>
  ({
    id: asId(`ov-${date}`),
    resourceId: asId("resource"),
    businessId: asId("business"),
    date: parseLocalDate(date),
    note: null,
    ranges: ranges.map(([start, end]) => ({ start: t(start), end: t(end) })),
  });

// 2026-09-01 is a Tuesday (day 2); 2026-09-02 a Wednesday (day 3).
const tuesday = parseLocalDate("2026-09-01");
const wednesday = parseLocalDate("2026-09-02");

describe("openIntervalsOn", () => {
  it("takes the weekday's recurring hours when nothing overrides the date", () => {
    const open = openIntervalsOn(tuesday, [hours(2, "09:00", "17:00")], []);
    expect(shape(open)).toEqual([[t("09:00"), t("17:00")]]);
  });

  it("ignores other weekdays", () => {
    expect(openIntervalsOn(wednesday, [hours(2, "09:00", "17:00")], [])).toEqual(
      [],
    );
  });

  it("keeps two ranges apart, so the gap between them is a break", () => {
    const open = openIntervalsOn(
      tuesday,
      [hours(2, "09:00", "13:00"), hours(2, "16:00", "19:00")],
      [],
    );
    expect(shape(open)).toEqual([
      [t("09:00"), t("13:00")],
      [t("16:00"), t("19:00")],
    ]);
    expect(shape(breaksOn(open))).toEqual([[t("13:00"), t("16:00")]]);
  });

  it("replaces the weekday's hours entirely when the date is overridden", () => {
    const open = openIntervalsOn(
      tuesday,
      [hours(2, "09:00", "17:00")],
      [override("2026-09-01", [["10:00", "12:00"]])],
    );
    expect(shape(open)).toEqual([[t("10:00"), t("12:00")]]);
  });

  it("treats an override with no ranges as a day off", () => {
    const open = openIntervalsOn(
      tuesday,
      [hours(2, "09:00", "17:00")],
      [override("2026-09-01", [])],
    );
    expect(open).toEqual([]);
  });

  it("applies an override only to its own date", () => {
    const overrides = [override("2026-09-02", [])];
    expect(
      shape(openIntervalsOn(tuesday, [hours(2, "09:00", "17:00")], overrides)),
    ).toEqual([[t("09:00"), t("17:00")]]);
  });

  it("merges overlapping ranges into one", () => {
    const open = openIntervalsOn(
      tuesday,
      [hours(2, "09:00", "13:00"), hours(2, "12:00", "17:00")],
      [],
    );
    expect(shape(open)).toEqual([[t("09:00"), t("17:00")]]);
  });
});

describe("breaksOn", () => {
  it("finds nothing between a single range", () => {
    expect(breaksOn([interval(t("09:00"), t("17:00"))])).toEqual([]);
  });
});
