import { describe, expect, it } from "vitest";
import { bookedAtShortNotice, busiestDay, changeOf, daysCompared, monthAsked, monthsBetween } from "./statistics-model.ts";

const day = (date: string, completed: number) => ({ date, completed, lost: 0, upcoming: 0, open: true });

describe("the month in the address", () => {
  it("reads a year and a month", () => {
    expect(monthAsked("2026-09", "2026-10-01")).toBe("2026-09-01");
  });

  it("falls back on anything else", () => {
    for (const asked of [null, "", "2026-13", "2026-9", "2026-09-01", "september"]) {
      expect(monthAsked(asked, "2026-10-01"), String(asked)).toBe("2026-10-01");
    }
  });
});

describe("the month list", () => {
  it("runs newest first, back to the month the business opened, across a new year", () => {
    expect(monthsBetween("2025-11-01", "2026-02-01")).toEqual(["2026-02-01", "2026-01-01", "2025-12-01", "2025-11-01"]);
  });

  it("is the one month when the business opened this month", () => {
    expect(monthsBetween("2026-10-01", "2026-10-01")).toEqual(["2026-10-01"]);
  });
});

describe("the change since last month", () => {
  it("is in percent for a count, rounded", () => {
    expect(changeOf(150, 100, false)).toEqual({ kind: "up", amount: 50 });
    expect(changeOf(2, 3, false)).toEqual({ kind: "down", amount: 33 });
  });

  it("is in points for a rate", () => {
    expect(changeOf(0.62, 0.5, true)).toEqual({ kind: "up", amount: 12 });
  });

  it("calls a sliver no change", () => {
    expect(changeOf(1005, 1000, false)).toEqual({ kind: "same" });
    expect(changeOf(0.503, 0.5, true)).toEqual({ kind: "same" });
    expect(changeOf(0, 0, false)).toEqual({ kind: "same" });
  });

  it("is a full hundred percent up from nothing", () => {
    expect(changeOf(4, 0, false)).toEqual({ kind: "up", amount: 100 });
  });

  it("is nothing to show without both figures", () => {
    expect(changeOf(0.5, null, true)).toEqual({ kind: "none" });
    expect(changeOf(null, 0.5, true)).toEqual({ kind: "none" });
  });
});

describe("the busiest day", () => {
  it("is the first day with the most completed", () => {
    expect(busiestDay([day("2026-09-01", 2), day("2026-09-02", 5), day("2026-09-03", 5)])?.date).toBe("2026-09-02");
  });

  it("is none while nothing has been completed", () => {
    expect(busiestDay([day("2026-09-01", 0)])).toBeNull();
    expect(busiestDay([])).toBeNull();
  });
});

describe("booking at short notice", () => {
  it("is the same day and the next, out of everything booked", () => {
    expect(bookedAtShortNotice([1, 2, 3, 4, 0, 0])).toBeCloseTo(0.3);
  });

  it("is none with nothing booked", () => {
    expect(bookedAtShortNotice([0, 0, 0, 0, 0, 0])).toBeNull();
  });
});

describe("the days a running month is compared on", () => {
  // ICU spaces the dash differently between locales and versions; the days are what matter.
  const compared = (month: string, today: string) => {
    const result = daysCompared(month, today, "en-GB");
    return result && { now: result.now.replace(/\s*–\s*/, "–"), before: result.before.replace(/\s*–\s*/, "–") };
  };

  it("names the same days of both months", () => {
    expect(compared("2026-10-01", "2026-10-03")).toEqual({ now: "1–3 October", before: "1–3 September" });
  });

  it("stops at the last day of a shorter month, across a new year", () => {
    expect(compared("2026-03-01", "2026-03-31")).toEqual({ now: "1–31 March", before: "1–28 February" });
    expect(compared("2026-01-01", "2026-01-01")).toEqual({ now: "1 January", before: "1 December" });
  });

  it("is null for a month already over", () => {
    expect(compared("2026-09-01", "2026-10-03")).toBeNull();
  });
});
