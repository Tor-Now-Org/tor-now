import { describe, expect, it } from "vitest";
import type { OverrideDto } from "@/lib/api/types.ts";
import { shopWideDates } from "./shop-days.ts";

const override = (
  resourceId: string,
  date: string,
  ranges: { start: string; end: string }[] = [],
): OverrideDto => ({
  id: `${resourceId}-${date}`,
  resourceId,
  date,
  note: null,
  ranges,
  closed: ranges.length === 0,
});

describe("telling the shop's day from one calendar's", () => {
  it("calls a date the shop's when every calendar was given the same day", () => {
    const dates = shopWideDates(
      [[override("a", "2026-09-15")], [override("b", "2026-09-15")]],
      2,
    );
    expect([...dates]).toEqual(["2026-09-15"]);
  });

  it("does not, when only one calendar has it", () => {
    // One barber's day off is not the shop closing, and removing it must not
    // reach the chair beside him.
    const dates = shopWideDates([[override("a", "2026-09-15")], []], 2);
    expect([...dates]).toEqual([]);
  });

  it("does not, when the calendars were given different hours", () => {
    const dates = shopWideDates(
      [
        [override("a", "2026-09-15", [{ start: "09:00", end: "12:00" }])],
        [override("b", "2026-09-15", [{ start: "10:00", end: "14:00" }])],
      ],
      2,
    );
    expect([...dates]).toEqual([]);
  });

  it("does not mistake a shut day for a short one on the same date", () => {
    const dates = shopWideDates(
      [
        [override("a", "2026-09-15")],
        [override("b", "2026-09-15", [{ start: "09:00", end: "12:00" }])],
      ],
      2,
    );
    expect([...dates]).toEqual([]);
  });

  it("treats a one-calendar business's own day as the shop's", () => {
    // There is no distinction to draw, and the rule gives that answer without
    // needing a case for it.
    const dates = shopWideDates([[override("a", "2026-09-15")]], 1);
    expect([...dates]).toEqual(["2026-09-15"]);
  });

  it("answers per date, not per business", () => {
    const dates = shopWideDates(
      [
        [override("a", "2026-09-15"), override("a", "2026-09-16")],
        [override("b", "2026-09-15")],
      ],
      2,
    );
    expect([...dates]).toEqual(["2026-09-15"]);
  });

  it("says nothing when a calendar's overrides have not arrived yet", () => {
    // Half-loaded must not read as "they all agree": that would offer to lift a
    // closure that is not there.
    expect([...shopWideDates([[override("a", "2026-09-15")]], 3)]).toEqual([]);
    expect([...shopWideDates([], 0)]).toEqual([]);
  });

  it("matches short days that keep the same hours in the same order", () => {
    const hours = [{ start: "09:00", end: "12:00" }];
    const dates = shopWideDates(
      [[override("a", "2026-09-15", hours)], [override("b", "2026-09-15", hours)]],
      2,
    );
    expect([...dates]).toEqual(["2026-09-15"]);
  });
});
