import { describe, expect, it } from "vitest";
import type { DayAvailabilityDto } from "@/lib/api/types.ts";
import {
  cellOf,
  firstFree,
  firstWaitablePart,
  lastBookableDay,
  markOf,
  monthSpan,
  monthWeeks,
  monthsOf,
  pagesFor,
  readPart,
  reachesPastStrip,
  slotsIn,
  stripDates,
  whenOpens,
} from "./days-model.ts";

const ZONE = "Asia/Jerusalem";
// 6.10.2026 is a Tuesday; Israel keeps summer time (UTC+3) until 25.10.
const TODAY = "2026-10-06";

/** A start on 13.10 at a local clock, as the wire carries it. */
const at = (date: string, clock: string): { startAt: string; endAt: string } => {
  const [hour, minute] = clock.split(":").map(Number) as [number, number];
  const start = new Date(`${date}T00:00:00.000Z`);
  start.setUTCHours(hour - 3, minute);
  return { startAt: start.toISOString(), endAt: new Date(start.getTime() + 30 * 60_000).toISOString() };
};

const aDay = (overrides: Partial<DayAvailabilityDto> = {}): DayAvailabilityDto => ({
  date: "2026-10-13",
  slots: [],
  emptyReason: null,
  openParts: ["MORNING", "NOON", "EVENING"],
  ...overrides,
});

const MORNING_AND_EVENING = aDay({
  slots: [at("2026-10-13", "09:30"), at("2026-10-13", "10:00"), at("2026-10-13", "17:00")],
});

describe("slotsIn — the times a part of the day keeps", () => {
  it("keeps every time for any time", () => {
    expect(slotsIn(MORNING_AND_EVENING, "any", ZONE)).toHaveLength(3);
  });

  it("keeps the morning's", () => {
    expect(slotsIn(MORNING_AND_EVENING, "morning", ZONE)).toHaveLength(2);
  });

  it("keeps the evening's, from 17:00 on", () => {
    expect(slotsIn(MORNING_AND_EVENING, "evening", ZONE)).toEqual([at("2026-10-13", "17:00")]);
  });

  it("keeps none at noon when nothing starts then", () => {
    expect(slotsIn(MORNING_AND_EVENING, "noon", ZONE)).toEqual([]);
  });
});

describe("markOf — what a day says before it is opened", () => {
  it("counts the free times", () => {
    expect(markOf(MORNING_AND_EVENING, "any", ZONE, TODAY, 60)).toEqual({ kind: "free", count: 3 });
  });

  it("counts only the chosen part", () => {
    expect(markOf(MORNING_AND_EVENING, "morning", ZONE, TODAY, 60)).toEqual({ kind: "free", count: 2 });
  });

  it("says none then when the day is free only at other times", () => {
    expect(markOf(MORNING_AND_EVENING, "noon", ZONE, TODAY, 60)).toEqual({ kind: "noneThen" });
  });

  it.each([
    ["FULLY_BOOKED", { kind: "full" }],
    ["CLOSED", { kind: "closed" }],
    ["TOO_SOON", { kind: "call" }],
    ["DAY_OVER", { kind: "over" }],
  ] as const)("names an empty day by its reason: %s", (reason, mark) => {
    expect(markOf(aDay({ emptyReason: reason }), "any", ZONE, TODAY, 60)).toEqual(mark);
  });

  it("keeps the reason whatever part is chosen", () => {
    expect(markOf(aDay({ emptyReason: "FULLY_BOOKED" }), "evening", ZONE, TODAY, 60)).toEqual({ kind: "full" });
  });

  it("says when a day past the horizon opens", () => {
    expect(markOf(aDay({ date: "2026-10-13", emptyReason: "BEYOND_HORIZON" }), "any", ZONE, TODAY, 7)).toEqual({
      kind: "later",
      when: { kind: "today" },
    });
  });

  it("is still loading while the day has not answered", () => {
    expect(markOf(undefined, "any", ZONE, TODAY, 60)).toEqual({ kind: "loading" });
  });

  it("reads a day with no times and no reason as full rather than inventing one", () => {
    expect(markOf(aDay(), "any", ZONE, TODAY, 60)).toEqual({ kind: "full" });
  });
});

describe("whenOpens — the day a date past the window opens", () => {
  it("is later today for the window's own last day", () => {
    expect(whenOpens("2026-10-13", TODAY, 7)).toEqual({ kind: "today" });
  });

  it("is tomorrow for the day after the window", () => {
    expect(whenOpens("2026-10-14", TODAY, 7)).toEqual({ kind: "tomorrow" });
  });

  it("is a date further out", () => {
    expect(whenOpens("2026-12-20", TODAY, 60)).toEqual({ kind: "on", date: "2026-10-21" });
  });

  it("is today, never the past, for a date already inside the window", () => {
    expect(whenOpens("2026-10-08", TODAY, 7)).toEqual({ kind: "today" });
  });
});

describe("lastBookableDay — where the window ends, in the business's zone", () => {
  it("is the date the horizon reaches from now", () => {
    expect(lastBookableDay(new Date("2026-10-06T11:30:00.000Z"), ZONE, 60)).toBe("2026-12-05");
  });

  it("is a week ahead for seven days", () => {
    expect(lastBookableDay(new Date("2026-10-06T11:30:00.000Z"), ZONE, 7)).toBe("2026-10-13");
  });

  it("reads the date in the business's zone, not the device's", () => {
    // 22:30 UTC on 6.10 is already 01:30 on 7.10 in Jerusalem.
    expect(lastBookableDay(new Date("2026-10-06T22:30:00.000Z"), ZONE, 1)).toBe("2026-10-08");
  });

  it("is tomorrow for a one-day horizon", () => {
    expect(lastBookableDay(new Date("2026-10-06T09:00:00.000Z"), ZONE, 1)).toBe("2026-10-07");
  });
});

describe("stripDates — how far the days run", () => {
  it("runs two weeks from today", () => {
    const dates = stripDates(TODAY, "2026-12-05", null);
    expect(dates[0]).toBe(TODAY);
    expect(dates).toHaveLength(14);
    expect(dates.at(-1)).toBe("2026-10-19");
  });

  it("stops at the window's last day, which is included even when only partly open", () => {
    const dates = stripDates(TODAY, "2026-10-13", null);
    expect(dates).toHaveLength(8);
    expect(dates.at(-1)).toBe("2026-10-13");
  });

  it("is a single day when the window ends today", () => {
    expect(stripDates(TODAY, TODAY, null)).toEqual([TODAY]);
  });

  it("runs on through the two-week page of a day picked further out", () => {
    const dates = stripDates(TODAY, "2026-12-05", "2026-10-27");
    expect(dates.at(-1)).toBe("2026-11-02");
    expect(dates).toHaveLength(28);
  });

  it("never runs past the window, however far the pick", () => {
    expect(stripDates(TODAY, "2026-12-05", "2026-12-05").at(-1)).toBe("2026-12-05");
  });

  it("ignores a pick inside the first two weeks", () => {
    expect(stripDates(TODAY, "2026-12-05", "2026-10-10")).toHaveLength(14);
  });
});

describe("pagesFor — what to ask the server for", () => {
  it("asks for the first two weeks as one request", () => {
    expect(pagesFor(TODAY, "2026-12-05", TODAY, "2026-10-19")).toEqual([{ from: TODAY, to: "2026-10-19" }]);
  });

  it("splits a longer span into two-week pages from today", () => {
    expect(pagesFor(TODAY, "2026-12-05", TODAY, "2026-11-02")).toEqual([
      { from: TODAY, to: "2026-10-19" },
      { from: "2026-10-20", to: "2026-11-02" },
    ]);
  });

  it("clips the last page to the window", () => {
    expect(pagesFor(TODAY, "2026-10-13", TODAY, "2026-10-13")).toEqual([{ from: TODAY, to: "2026-10-13" }]);
  });

  it("asks only for the pages that hold the span", () => {
    expect(pagesFor(TODAY, "2026-12-05", "2026-10-27", "2026-10-28")).toEqual([
      { from: "2026-10-20", to: "2026-11-02" },
    ]);
  });
});

describe("firstFree — the day the page opens on", () => {
  const days = {
    "2026-10-06": aDay({ date: "2026-10-06", emptyReason: "FULLY_BOOKED" }),
    "2026-10-07": aDay({ date: "2026-10-07", emptyReason: "CLOSED" }),
    "2026-10-08": aDay({ date: "2026-10-08", slots: [at("2026-10-08", "17:30")] }),
    "2026-10-09": aDay({ date: "2026-10-09", slots: [at("2026-10-09", "09:00")] }),
  };
  const dates = Object.keys(days);

  it("is the first day with a free time", () => {
    expect(firstFree(dates, days, "any", ZONE)).toBe("2026-10-08");
  });

  it("is the first with a free time in the chosen part", () => {
    expect(firstFree(dates, days, "morning", ZONE)).toBe("2026-10-09");
  });

  it("is nothing when no day has one", () => {
    expect(firstFree(dates, days, "noon", ZONE)).toBeNull();
  });

  it("does not skip past a day still loading", () => {
    expect(firstFree(["2026-10-05", ...dates], days, "any", ZONE)).toBeNull();
  });
});

describe("the month", () => {
  it("is offered only when the window runs past the two weeks", () => {
    expect(reachesPastStrip(TODAY, "2026-10-19")).toBe(false);
    expect(reachesPastStrip(TODAY, "2026-10-20")).toBe(true);
  });

  it("runs from this month to the window's last month", () => {
    expect(monthsOf(TODAY, "2026-12-05")).toEqual(["2026-10-01", "2026-11-01", "2026-12-01"]);
    expect(monthsOf(TODAY, "2026-10-20")).toEqual(["2026-10-01"]);
    expect(monthsOf("2026-12-20", "2027-02-01")).toEqual(["2026-12-01", "2027-01-01", "2027-02-01"]);
  });

  it("lays October 2026 out from Sunday, the first falling on a Thursday", () => {
    const weeks = monthWeeks("2026-10-01");
    expect(weeks[0]).toEqual([null, null, null, null, "2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(weeks.at(-1)).toEqual(["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]);
    expect(weeks).toHaveLength(5);
  });

  it("pads the last week of a month that ends mid-week", () => {
    const weeks = monthWeeks("2026-12-01");
    expect(weeks[0]?.slice(0, 3)).toEqual([null, null, "2026-12-01"]);
    expect(weeks.at(-1)).toEqual(["2026-12-27", "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", null, null]);
  });

  it("handles February in a leap year", () => {
    expect(monthWeeks("2028-02-01").flat().filter((date) => date !== null)).toHaveLength(29);
  });

  it("asks for only the window's part of a month", () => {
    expect(monthSpan("2026-10-01", TODAY, "2026-12-05")).toEqual({ from: TODAY, to: "2026-10-31" });
    expect(monthSpan("2026-11-01", TODAY, "2026-12-05")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(monthSpan("2026-12-01", TODAY, "2026-12-05")).toEqual({ from: "2026-12-01", to: "2026-12-05" });
    expect(monthSpan("2027-01-01", TODAY, "2026-12-05")).toBeNull();
  });

  it("tells past, open and not yet open days apart", () => {
    expect(cellOf("2026-10-05", TODAY, "2026-12-05")).toBe("past");
    expect(cellOf(TODAY, TODAY, "2026-12-05")).toBe("open");
    expect(cellOf("2026-12-05", TODAY, "2026-12-05")).toBe("open");
    expect(cellOf("2026-12-06", TODAY, "2026-12-05")).toBe("later");
  });
});

describe("readPart — the remembered Part of Day", () => {
  it.each(["any", "morning", "noon", "evening"] as const)("keeps %s", (part) => {
    expect(readPart(part)).toBe(part);
  });

  it.each([null, "", "night", "MORNING", "{}"])("falls back to any time for %s", (stored) => {
    expect(readPart(stored)).toBe("any");
  });
});

describe("firstWaitablePart — where waiting could still come to something", () => {
  // 14:30 in Jerusalem on 6.10.
  const now = new Date("2026-10-06T11:30:00.000Z");
  const after = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

  it("is the part the hour's notice ends in, today", () => {
    expect(firstWaitablePart(TODAY, after(60), ZONE)).toBe(1);
  });

  it("is the evening once the notice ends after five", () => {
    expect(firstWaitablePart(TODAY, after(3 * 60), ZONE)).toBe(2);
  });

  it("is none on a day wholly inside the notice", () => {
    expect(firstWaitablePart("2026-10-07", after(3 * 24 * 60), ZONE)).toBe(3);
  });

  it("is every part on a day past the notice", () => {
    expect(firstWaitablePart("2026-10-10", after(3 * 24 * 60), ZONE)).toBe(0);
  });

  it("is the part the notice ends in on the day it ends", () => {
    // Three days on, at 14:30: the morning is too soon, the afternoon is not.
    expect(firstWaitablePart("2026-10-09", after(3 * 24 * 60), ZONE)).toBe(1);
  });
});
