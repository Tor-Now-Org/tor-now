import { describe, expect, it } from "vitest";
import type { BusinessDto, FeatureName } from "./api/types.ts";
import { customersInBusiness, readsStatistics, sectionsFor } from "./roles.ts";

const staffedAs = (role: "OWNER" | "MANAGER" | "WORKER", features: FeatureName[]) =>
  ({ role, entitlement: { features, resourceAllowance: 5 } }) as unknown as BusinessDto;

const withStatistics = (role: "OWNER" | "MANAGER" | "WORKER") => staffedAs(role, ["TEAM_ROLES", "STATISTICS"]);
const without = (role: "OWNER" | "MANAGER" | "WORKER") => staffedAs(role, ["TEAM_ROLES"]);

describe("the bottom bar", () => {
  it("is as it always was where the plan does not give Statistics", () => {
    expect(sectionsFor(without("OWNER"))).toEqual(["day", "schedule", "business", "customers"]);
    expect(sectionsFor(without("MANAGER"))).toEqual(["day", "schedule", "business", "customers"]);
  });

  it("gives the owner Statistics in place of Customers, keeping four tabs", () => {
    expect(sectionsFor(withStatistics("OWNER"))).toEqual(["day", "schedule", "business", "statistics"]);
  });

  it("gives a manager no Statistics, and their customers under the business", () => {
    expect(sectionsFor(withStatistics("MANAGER"))).toEqual(["day", "schedule", "business"]);
    expect(customersInBusiness(withStatistics("MANAGER"))).toBe(true);
  });

  it("leaves a worker with their calendar and schedule, whatever the plan", () => {
    expect(sectionsFor(withStatistics("WORKER"))).toEqual(["day", "schedule"]);
    expect(sectionsFor(without("WORKER"))).toEqual(["day", "schedule"]);
    expect(customersInBusiness(withStatistics("WORKER"))).toBe(false);
  });
});

describe("who reads Statistics", () => {
  it("is the owner, and only while the plan gives it", () => {
    expect(readsStatistics(withStatistics("OWNER"))).toBe(true);
    expect(readsStatistics(without("OWNER"))).toBe(false);
    expect(readsStatistics(withStatistics("MANAGER"))).toBe(false);
  });
});
