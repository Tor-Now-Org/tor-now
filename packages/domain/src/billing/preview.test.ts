import { describe, expect, it } from "vitest";
import { asId } from "../model/ids.ts";
import { money } from "../model/money.ts";
import { parseLocalDate } from "../time/local-date.ts";
import { planTerms, type PlanVersion } from "./plan.ts";
import { canPreview, checkPreviewExtension, checkPreviewStart, placePreview, stretchUndecided } from "./preview.ts";

const day = parseLocalDate;
const today = day("2026-09-28");
const edition = (plan: "SOLO" | "TEAM", features: ("REMINDERS" | "TEAM_ROLES" | "CUSTOMER_HISTORY")[]): PlanVersion => ({
  id: asId(`${plan}-1`),
  plan,
  number: 1,
  terms: planTerms({ features, resourceAllowance: 1, price: money(4900) }),
});
const current = [edition("SOLO", ["REMINDERS"]), edition("TEAM", ["REMINDERS", "CUSTOMER_HISTORY", "TEAM_ROLES"])];
const waiting = { feature: "WAITING_LIST" as const, endsOn: day("2026-11-25") };

describe("canPreview", () => {
  it("is for a Feature some Plan lacks and that is not in Preview already", () => {
    expect(canPreview("CUSTOMER_HISTORY", { current, previews: [], today })).toBe(true);
    expect(canPreview("REMINDERS", { current, previews: [], today })).toBe(false);
    expect(canPreview("WAITING_LIST", { current, previews: [waiting], today })).toBe(false);
    // An ended Preview no longer stands in the way.
    expect(canPreview("WAITING_LIST", { current, previews: [{ ...waiting, endsOn: day("2026-09-27") }], today })).toBe(true);
  });
});

describe("checkPreviewStart", () => {
  it("runs thirty days to a year", () => {
    const start = { feature: "CUSTOMER_HISTORY" as const, current, previews: [], today };
    expect(() => checkPreviewStart({ ...start, endsOn: day("2026-10-28") })).not.toThrow();
    expect(() => checkPreviewStart({ ...start, endsOn: day("2026-10-27") })).toThrow(/thirty days to a year/);
    expect(() => checkPreviewStart({ ...start, endsOn: day("2027-09-29") })).toThrow(/thirty days to a year/);
    expect(() => checkPreviewStart({ ...start, feature: "REMINDERS", endsOn: day("2026-11-28") })).toThrow(/Every Plan/);
  });
});

describe("checkPreviewExtension", () => {
  it("carries a running Preview later, within the year", () => {
    expect(() => checkPreviewExtension(waiting, day("2026-12-25"), today)).not.toThrow();
    expect(() => checkPreviewExtension(waiting, day("2026-11-25"), today)).toThrow(/later/);
    expect(() => checkPreviewExtension(waiting, day("2027-10-01"), today)).toThrow(/a year/);
  });
});

describe("placePreview", () => {
  it("keeps the end when it is thirty days or more away", () => {
    expect(placePreview(waiting, ["TEAM", "TEAM"], today)).toEqual({ keepOn: ["TEAM"], endsOn: "2026-11-25" });
  });

  it("moves a nearer end out to thirty days, so a Plan losing it is told in time", () => {
    expect(placePreview({ ...waiting, endsOn: day("2026-10-10") }, [], today).endsOn).toBe("2026-10-28");
  });
});

describe("stretchUndecided", () => {
  it("carries an undecided Preview thirty days further once its end is within thirty days", () => {
    // Thirty days left is still time to decide with full Notice; twenty-nine is not.
    expect(stretchUndecided({ ...waiting, placement: null }, day("2026-10-27"))).toBe("2026-12-25");
    expect(stretchUndecided({ ...waiting, placement: null }, day("2026-10-26"))).toBeNull();
  });

  it("leaves a decided Preview to end on its day", () => {
    expect(stretchUndecided({ ...waiting, placement: { keepOn: ["TEAM"] } }, day("2026-11-20"))).toBeNull();
  });
});

describe("a Preview that has already ended", () => {
  const ended = { ...waiting, endsOn: day("2026-09-27") };

  it("can be neither extended nor placed — it is over, and a new one would have to start", () => {
    expect(() => checkPreviewExtension(ended, day("2026-12-25"), today)).toThrow(/running Preview can be extended/);
    expect(() => placePreview(ended, ["TEAM"], today)).toThrow(/running Preview can be placed/);
  });

  it("is still running on its last day", () => {
    const lastDay = { ...waiting, endsOn: today };
    expect(() => checkPreviewExtension(lastDay, day("2026-12-25"), today)).not.toThrow();
    expect(() => placePreview(lastDay, ["TEAM"], today)).not.toThrow();
  });
});
