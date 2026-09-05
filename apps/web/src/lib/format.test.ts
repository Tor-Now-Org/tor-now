import { describe, expect, it } from "vitest";
import { dayIn } from "./format.ts";

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
