import { describe, expect, it } from "vitest";
import { parseLocalDate } from "@tor-now/domain";
import { closureBandsOf, type ShopDay } from "./closure-bands.ts";
import { parseLocalTime } from "@tor-now/domain";

const day = (date: string, shopClosed: boolean, shopNote: string | null = null): ShopDay => ({
  date: parseLocalDate(date),
  shopClosed,
  shopHours: [],
  shopNote,
});

/** A day the shop keeps hours of its own rather than closing. */
const shorter = (
  date: string,
  hours: { start: string; end: string }[],
  shopNote: string | null = null,
): ShopDay => ({
  date: parseLocalDate(date),
  shopClosed: false,
  shopHours: hours.map((range) => ({
    start: parseLocalTime(range.start),
    end: parseLocalTime(range.end),
  })),
  shopNote,
});

describe("reading a closure back off the month", () => {
  it("has nothing to say about a month that is open throughout", () => {
    expect(closureBandsOf([day("2026-09-01", false), day("2026-09-02", false)])).toEqual([]);
  });

  it("joins neighbouring shut days into one band", () => {
    const bands = closureBandsOf([
      day("2026-09-01", false),
      day("2026-09-02", true, "חופשה"),
      day("2026-09-03", true, "חופשה"),
      day("2026-09-04", true, "חופשה"),
      day("2026-09-05", false),
    ]);
    expect(bands).toEqual([
      {
        fromDate: "2026-09-02",
        toDate: "2026-09-04",
        days: 3,
        note: "חופשה",
        kind: "SHUT",
        hours: [],
      },
    ]);
  });

  it("keeps two closures apart when an open day sits between them", () => {
    const bands = closureBandsOf([
      day("2026-09-01", true),
      day("2026-09-02", false),
      day("2026-09-03", true),
    ]);
    expect(bands.map((band) => band.days)).toEqual([1, 1]);
  });

  it("keeps two closures apart when the reason changes", () => {
    // Passover ending and a plumber arriving on the Thursday are two
    // decisions, and one band saying "Passover" across both would be a lie
    // about the Thursday.
    const bands = closureBandsOf([
      day("2026-09-01", true, "פסח"),
      day("2026-09-02", true, "שיפוץ"),
    ]);
    expect(bands.map((band) => [band.days, band.note])).toEqual([
      [1, "פסח"],
      [1, "שיפוץ"],
    ]);
  });

  it("joins unstated reasons only to other unstated ones", () => {
    const bands = closureBandsOf([
      day("2026-09-01", true, null),
      day("2026-09-02", true, null),
      day("2026-09-03", true, "חתונה"),
    ]);
    expect(bands.map((band) => [band.days, band.note])).toEqual([
      [2, null],
      [1, "חתונה"],
    ]);
  });

  it("carries a single shut day as a band of one", () => {
    expect(closureBandsOf([day("2026-09-09", true, "יום כיפור")])).toEqual([
      {
        fromDate: "2026-09-09",
        toDate: "2026-09-09",
        days: 1,
        note: "יום כיפור",
        kind: "SHUT",
        hours: [],
      },
    ]);
  });

  it("does not join across the turn of a month", () => {
    // The month grid only ever holds one month, so a band is never asked to
    // cross one — but the arithmetic is dates, not offsets, and this is what
    // proves it.
    const bands = closureBandsOf([day("2026-09-30", true), day("2026-10-02", true)]);
    expect(bands).toHaveLength(2);
  });

  it("reads a short day back as its own band, which is what makes it undoable", () => {
    // A half-day used to produce nothing at all: the square went pale and
    // there was no band to open, nothing to read and no way out of it.
    const bands = closureBandsOf([shorter("2026-09-15", [{ start: "09:00", end: "12:00" }], "ערב חג")]);
    expect(bands).toHaveLength(1);
    expect(bands[0]?.kind).toBe("HOURS");
    expect(bands[0]?.note).toBe("ערב חג");
    expect(bands[0]?.hours).toHaveLength(1);
  });

  it("joins short days that keep the same hours for the same reason", () => {
    const bands = closureBandsOf([
      shorter("2026-09-15", [{ start: "09:00", end: "12:00" }], "ערב חג"),
      shorter("2026-09-16", [{ start: "09:00", end: "12:00" }], "ערב חג"),
    ]);
    expect(bands).toHaveLength(1);
    expect(bands[0]?.days).toBe(2);
  });

  it("keeps two short days apart when the hours differ", () => {
    const bands = closureBandsOf([
      shorter("2026-09-15", [{ start: "09:00", end: "12:00" }]),
      shorter("2026-09-16", [{ start: "10:00", end: "14:00" }]),
    ]);
    expect(bands).toHaveLength(2);
  });

  it("never joins a shut day to a short one", () => {
    const bands = closureBandsOf([
      day("2026-09-15", true, "חג"),
      shorter("2026-09-16", [{ start: "09:00", end: "12:00" }], "חג"),
    ]);
    expect(bands.map((band) => band.kind)).toEqual(["SHUT", "HOURS"]);
  });
});
