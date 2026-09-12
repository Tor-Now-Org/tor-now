import { describe, expect, it } from "vitest";
import { parseLocalDate } from "@tor-now/domain";
import { closureBandsOf, type ShutDay } from "./closure-bands.ts";

const day = (date: string, shopClosed: boolean, shopNote: string | null = null): ShutDay => ({
  date: parseLocalDate(date),
  shopClosed,
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
      { fromDate: "2026-09-02", toDate: "2026-09-04", days: 3, note: "חופשה" },
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
    expect(bands).toEqual([
      { fromDate: "2026-09-01", toDate: "2026-09-01", days: 1, note: "פסח" },
      { fromDate: "2026-09-02", toDate: "2026-09-02", days: 1, note: "שיפוץ" },
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
      { fromDate: "2026-09-09", toDate: "2026-09-09", days: 1, note: "יום כיפור" },
    ]);
  });

  it("does not join across the turn of a month", () => {
    // The month grid only ever holds one month, so a band is never asked to
    // cross one — but the arithmetic is dates, not offsets, and this is what
    // proves it.
    const bands = closureBandsOf([day("2026-09-30", true), day("2026-10-02", true)]);
    expect(bands).toHaveLength(2);
  });
});
