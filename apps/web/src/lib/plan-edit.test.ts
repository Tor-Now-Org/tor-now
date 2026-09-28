import { describe, expect, it } from "vitest";
import type { PlanEditionDto } from "@/lib/api/types.ts";
import { effectOf, priceMinorOf } from "./plan-edit.ts";

const solo: PlanEditionDto = {
  id: "solo-1",
  plan: "SOLO",
  number: 1,
  priceMinor: 4900,
  resourceAllowance: 1,
  features: ["REMINDERS"],
  publishedAt: "2026-09-01T00:00:00.000Z",
  firstMoveOn: null,
};

describe("effectOf", () => {
  it("says nothing changed for the same terms", () => {
    expect(effectOf(solo, { priceMinor: 4900, resourceAllowance: 1, features: ["REMINDERS"] }).kind).toBe("NONE");
  });

  it("says a higher price takes, a lower one gives", () => {
    expect(effectOf(solo, { priceMinor: 5900, resourceAllowance: 1, features: ["REMINDERS"] }).kind).toBe("TAKES");
    expect(effectOf(solo, { priceMinor: 3900, resourceAllowance: 1, features: ["REMINDERS"] }).kind).toBe("GIVES");
  });

  it("says adding a Feature gives, and adding one while raising the price takes", () => {
    expect(effectOf(solo, { priceMinor: 4900, resourceAllowance: 1, features: ["REMINDERS", "TEAM_ROLES"] })).toMatchObject({
      kind: "GIVES",
      change: { featuresAdded: ["TEAM_ROLES"] },
    });
    expect(effectOf(solo, { priceMinor: 5900, resourceAllowance: 1, features: ["REMINDERS", "TEAM_ROLES"] }).kind).toBe("TAKES");
  });

  it("is invalid without a price or with no calendar", () => {
    expect(effectOf(solo, { priceMinor: null, resourceAllowance: 1, features: [] }).kind).toBe("INVALID");
    expect(effectOf(solo, { priceMinor: 4900, resourceAllowance: 0, features: [] }).kind).toBe("INVALID");
  });
});

describe("priceMinorOf", () => {
  it("reads whole shekels", () => {
    expect(priceMinorOf("59")).toBe(5900);
    expect(priceMinorOf(" 0 ")).toBe(0);
    expect(priceMinorOf("59.5")).toBeNull();
    expect(priceMinorOf("")).toBeNull();
  });
});
