import { describe, expect, it } from "vitest";
import { countdownTo, dayIn, formatRate, microShekelsOf, shekelsOf } from "./format.ts";

const JERUSALEM = "Asia/Jerusalem";

describe("the day an appointment falls on", () => {
  const NOW = new Date("2026-09-08T09:00:00Z");

  it("says the weekday and the date, and leaves this year unsaid", () => {
    const said = dayIn("2026-09-08T06:00:00Z", JERUSALEM, "he", NOW);
    expect(said).toContain("8 בספטמבר");
    expect(said).not.toContain("2026");
  });

  it("carries the year once it is not this one", () => {
    expect(dayIn("2025-09-08T06:00:00Z", JERUSALEM, "en", NOW)).toContain("2025");
  });

  /**
   * Midnight UTC on the first of January is still the previous year in some
   * zones and the next in others, so the comparison has to be made in the
   * business's own — not the machine's.
   */
  it("decides the year in the business's timezone, not the machine's", () => {
    // 21:30 UTC on New Year's Eve is already 2027 in Jerusalem.
    expect(dayIn("2026-12-31T22:30:00Z", JERUSALEM, "en", NOW)).toContain("2027");
  });
});

describe("how far off an appointment is", () => {
  const NOW = new Date("2026-09-17T10:00:00Z");

  it("counts in minutes inside the hour", () => {
    expect(countdownTo("2026-09-17T10:20:00Z", "en", NOW)).toBe("in 20 minutes");
  });

  /** The boundary the unit is chosen on: 240 minutes has to read as 4 hours. */
  it("switches to hours once the hour is up", () => {
    expect(countdownTo("2026-09-17T14:00:00Z", "en", NOW)).toBe("in 4 hours");
  });

  it("switches to days once the day is up, and names tomorrow", () => {
    expect(countdownTo("2026-09-18T14:00:00Z", "en", NOW)).toBe("tomorrow");
    expect(countdownTo("2026-09-20T10:00:00Z", "en", NOW)).toBe("in 3 days");
  });

  it("says it in the reader's language", () => {
    expect(countdownTo("2026-09-17T14:00:00Z", "he", NOW)).toContain("4");
  });
});

describe("rates", () => {
  it("reads a typed price exactly, to four decimals", () => {
    expect(microShekelsOf("0.0203")).toBe(20_300);
    expect(microShekelsOf(" 0.9528 ")).toBe(952_800);
    expect(microShekelsOf("1")).toBe(1_000_000);
    expect(microShekelsOf("0.1")).toBe(100_000);
  });

  it("refuses more decimals, words, and negatives", () => {
    expect(microShekelsOf("0.02031")).toBeNull();
    expect(microShekelsOf("abc")).toBeNull();
    expect(microShekelsOf("-1")).toBeNull();
    expect(microShekelsOf("")).toBeNull();
  });

  it("shows a rate to four decimals, and gives it back as typed", () => {
    expect(formatRate(19_610, "en")).toBe("₪0.0196");
    expect(shekelsOf(20_300)).toBe("0.0203");
  });
});
