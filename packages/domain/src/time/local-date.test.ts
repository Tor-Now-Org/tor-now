import { describe, expect, it } from "vitest";
import {
  addDays,
  datesBetween,
  dayOfWeekOf,
  daysBetween,
  nextMonthStartOf,
  parseLocalDate,
  utcStartOf,
} from "./local-date.ts";
import { DomainError } from "../shared/errors.ts";

const date = parseLocalDate;

describe("LocalDate", () => {
  it("rejects dates that do not exist", () => {
    expect(() => date("2026-02-30")).toThrow(DomainError);
    expect(() => date("2026-13-01")).toThrow(DomainError);
    expect(() => date("26-01-01")).toThrow(DomainError);
  });

  it("accepts a real leap day", () => {
    expect(date("2028-02-29")).toBe("2028-02-29");
  });

  it("treats Sunday as day zero", () => {
    // 2026-08-30 is a Sunday.
    expect(dayOfWeekOf(date("2026-08-30"))).toBe(0);
    expect(dayOfWeekOf(date("2026-09-05"))).toBe(6);
  });

  it("adds days across a month boundary", () => {
    expect(addDays(date("2026-01-31"), 1)).toBe("2026-02-01");
    expect(addDays(date("2026-03-01"), -1)).toBe("2026-02-28");
  });

  it("counts days between dates in both directions", () => {
    expect(daysBetween(date("2026-01-01"), date("2026-01-31"))).toBe(30);
    expect(daysBetween(date("2026-01-31"), date("2026-01-01"))).toBe(-30);
  });

  it("enumerates an inclusive range, and nothing for a reversed one", () => {
    expect(datesBetween(date("2026-01-01"), date("2026-01-03"))).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
    ]);
    expect(datesBetween(date("2026-01-03"), date("2026-01-01"))).toEqual([]);
  });
});

describe("months and UTC days", () => {
  it("finds the first of the next month, across a year's end and a short February", () => {
    expect(nextMonthStartOf(date("2026-09-29"))).toBe("2026-10-01");
    expect(nextMonthStartOf(date("2026-12-31"))).toBe("2027-01-01");
    expect(nextMonthStartOf(date("2028-02-29"))).toBe("2028-03-01");
    expect(nextMonthStartOf(date("2026-01-01"))).toBe("2026-02-01");
  });

  it("starts a day at midnight UTC, the day a provider bills by", () => {
    expect(new Date(utcStartOf(date("2026-09-01"))).toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(utcStartOf(date("2026-09-02")) - utcStartOf(date("2026-09-01"))).toBe(86_400_000);
  });
});
