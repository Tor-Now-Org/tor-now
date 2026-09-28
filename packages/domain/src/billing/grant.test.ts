import { describe, expect, it } from "vitest";
import { parseLocalDate } from "../time/local-date.ts";
import {
  checkExtension,
  checkGrants,
  endedGrantEndsOn,
  featureSources,
  grantableFeatures,
  MAX_GRANT_DAYS,
} from "./grant.ts";

const day = parseLocalDate;
/** No Add-on held, and no Trial giving them. */
const noAddons = { addons: [], trialAddons: null } as const;
const today = day("2026-09-27");
const solo = { features: ["REMINDERS"] as const };
const waitingPreview = { feature: "WAITING_LIST" as const, endsOn: day("2026-11-25") };

describe("featureSources", () => {
  it("names one place each Feature comes from, the Plan first", () => {
    const sources = featureSources({
      ...noAddons,
      terms: solo,
      grants: [
        { feature: "CUSTOMER_HISTORY", endsOn: day("2026-10-02") },
        { feature: "REMINDERS", endsOn: day("2026-12-31") },
      ],
      previews: [waitingPreview],
      today,
    });
    expect(sources.map(({ feature, source, endsOn }) => ({ feature, source, endsOn }))).toEqual([
      { feature: "REMINDERS", source: "PLAN", endsOn: null },
      { feature: "CUSTOMER_HISTORY", source: "GRANT", endsOn: "2026-10-02" },
      { feature: "CUSTOMER_BLOCKING", source: "NONE", endsOn: null },
      { feature: "TEAM_ROLES", source: "NONE", endsOn: null },
      { feature: "WAITING_LIST", source: "PREVIEW", endsOn: "2026-11-25" },
    ]);
  });

  it("carries the Grant it comes from, the longest running of several", () => {
    const short = { feature: "TEAM_ROLES" as const, endsOn: day("2026-10-01"), id: "a" };
    const long = { feature: "TEAM_ROLES" as const, endsOn: day("2026-12-01"), id: "b" };
    const [, , , teamRoles] = featureSources({ ...noAddons, terms: solo, grants: [short, long], previews: [], today });
    expect(teamRoles?.grant).toBe(long);
  });

  it("puts an Add-on after the Plan and before a Grant, and a Trial's Add-ons with it", () => {
    const sources = featureSources({
      terms: solo,
      grants: [{ feature: "CUSTOMER_HISTORY", endsOn: day("2026-12-31") }],
      previews: [waitingPreview],
      addons: [
        { feature: "CUSTOMER_HISTORY", addedOn: day("2026-09-01"), endsOn: null },
        { feature: "REMINDERS", addedOn: day("2026-09-01"), endsOn: null },
        { feature: "TEAM_ROLES", addedOn: day("2026-09-01"), endsOn: day("2026-09-26") },
      ],
      trialAddons: { features: ["WAITING_LIST"], endsOn: day("2026-10-10") },
      today,
    });
    expect(sources.map(({ feature, source, endsOn }) => ({ feature, source, endsOn }))).toEqual([
      { feature: "REMINDERS", source: "PLAN", endsOn: null },
      { feature: "CUSTOMER_HISTORY", source: "ADDON", endsOn: null },
      { feature: "CUSTOMER_BLOCKING", source: "NONE", endsOn: null },
      { feature: "TEAM_ROLES", source: "NONE", endsOn: null },
      { feature: "WAITING_LIST", source: "ADDON", endsOn: "2026-10-10" },
    ]);
    expect(grantableFeatures(sources)).toEqual(["CUSTOMER_BLOCKING", "TEAM_ROLES"]);
  });

  it("forgets a Grant or a Preview once it has ended", () => {
    const sources = featureSources({
      ...noAddons,
      terms: solo,
      grants: [{ feature: "TEAM_ROLES", endsOn: day("2026-09-26") }],
      previews: [{ feature: "WAITING_LIST", endsOn: day("2026-09-26") }],
      today,
    });
    expect(grantableFeatures(sources)).toEqual(["CUSTOMER_HISTORY", "CUSTOMER_BLOCKING", "TEAM_ROLES", "WAITING_LIST"]);
  });
});

describe("checkGrants", () => {
  const sources = featureSources({ ...noAddons, terms: solo, grants: [], previews: [waitingPreview], today });
  const valid = { features: ["TEAM_ROLES", "CUSTOMER_HISTORY"] as const, endsOn: day("2026-12-26"), reason: "  פיילוט  ", sources, today };

  it("keeps several Features in catalogue order, once each, with the reason trimmed", () => {
    expect(checkGrants({ ...valid, features: ["TEAM_ROLES", "CUSTOMER_HISTORY", "TEAM_ROLES"] })).toEqual({
      features: ["CUSTOMER_HISTORY", "TEAM_ROLES"],
      reason: "פיילוט",
    });
  });

  it("refuses what the Business already has, and says which", () => {
    expect(() => checkGrants({ ...valid, features: ["REMINDERS", "WAITING_LIST", "TEAM_ROLES"] })).toThrow(
      expect.objectContaining({ details: expect.objectContaining({ features: ["REMINDERS", "WAITING_LIST"] }) }),
    );
  });

  it("refuses nothing chosen, no reason, a past end, and more than a year", () => {
    expect(() => checkGrants({ ...valid, features: [] })).toThrow(/at least one/);
    expect(() => checkGrants({ ...valid, reason: " a " })).toThrow(/reason/);
    expect(() => checkGrants({ ...valid, endsOn: day("2026-09-26") })).toThrow(/today or later/);
    expect(checkGrants({ ...valid, endsOn: today }).features).toHaveLength(2);
    expect(() => checkGrants({ ...valid, endsOn: day("2027-09-28") })).toThrow(/a year/);
    expect(MAX_GRANT_DAYS).toBe(365);
  });
});

describe("checkExtension", () => {
  const grant = { feature: "TEAM_ROLES" as const, endsOn: day("2026-10-02") };

  it("carries a running Grant later, within the year", () => {
    expect(checkExtension({ grant, endsOn: day("2026-11-01"), reason: "עוד חודש", today })).toBe("עוד חודש");
    expect(() => checkExtension({ grant, endsOn: day("2026-10-02"), reason: "עוד חודש", today })).toThrow(/later/);
    expect(() => checkExtension({ grant, endsOn: day("2027-10-01"), reason: "עוד חודש", today })).toThrow(/a year/);
    expect(() =>
      checkExtension({ grant: { ...grant, endsOn: day("2026-09-01") }, endsOn: day("2026-11-01"), reason: "עוד", today }),
    ).toThrow(/running/);
  });
});

describe("ending a Grant now", () => {
  it("makes yesterday its last day, so it stops today", () => {
    expect(endedGrantEndsOn(today)).toBe("2026-09-26");
  });
});
