import { describe, expect, it } from "vitest";
import {
  entitlementFor,
  hasFeature,
  requireFeature,
  requireRoomForResource,
  resourcesBeyondAllowance,
  type Grant,
} from "./entitlement.ts";
import { planTerms } from "./plan.ts";
import { asId } from "../model/ids.ts";
import { money } from "../model/money.ts";
import { isDomainError } from "../shared/errors.ts";
import { parseLocalDate } from "../time/local-date.ts";

const day = parseLocalDate;
const today = day("2026-10-10");

const solo = planTerms({ features: ["REMINDERS"], resourceAllowance: 1, price: money(4900) });

const grant = (overrides: Partial<Grant> = {}): Grant => ({
  id: asId("grant-1"),
  businessId: asId("business-1"),
  feature: "CUSTOMER_HISTORY",
  reason: "Early adopter",
  endsOn: day("2026-10-31"),
  grantedBy: asId("admin-1"),
  ...overrides,
});

describe("entitlementFor", () => {
  it("is the Plan Version's terms when nothing else applies", () => {
    const entitlement = entitlementFor({ terms: solo, grants: [], previews: [], today });
    expect(entitlement.features).toEqual(["REMINDERS"]);
    expect(entitlement.resourceAllowance).toBe(1);
  });

  it("adds a Grant up to and including its end date", () => {
    const on = (date: string) =>
      entitlementFor({ terms: solo, grants: [grant()], previews: [], today: day(date) });
    expect(hasFeature(on("2026-10-31"), "CUSTOMER_HISTORY")).toBe(true);
    expect(hasFeature(on("2026-11-01"), "CUSTOMER_HISTORY")).toBe(false);
  });

  it("offers a Preview on every Plan until it ends", () => {
    const previews = [{ feature: "WAITING_LIST" as const, endsOn: day("2026-10-10") }];
    expect(
      hasFeature(entitlementFor({ terms: solo, grants: [], previews, today }), "WAITING_LIST"),
    ).toBe(true);
    expect(
      hasFeature(
        entitlementFor({ terms: solo, grants: [], previews, today: day("2026-10-11") }),
        "WAITING_LIST",
      ),
    ).toBe(false);
  });

  it("lists a feature once however many ways it was granted", () => {
    const entitlement = entitlementFor({
      terms: solo,
      grants: [grant({ feature: "REMINDERS" })],
      previews: [{ feature: "REMINDERS", endsOn: today }],
      today,
    });
    expect(entitlement.features).toEqual(["REMINDERS"]);
  });
});

describe("requireFeature", () => {
  const entitlement = entitlementFor({ terms: solo, grants: [], previews: [], today });

  it("passes silently for a feature held", () => {
    expect(() => requireFeature(entitlement, "REMINDERS")).not.toThrow();
  });

  it("refuses with NOT_ENTITLED, naming the feature", () => {
    try {
      requireFeature(entitlement, "TEAM_ROLES");
      expect.unreachable();
    } catch (error) {
      expect(isDomainError(error) && error.code).toBe("NOT_ENTITLED");
      expect(isDomainError(error) && error.details).toEqual({ feature: "TEAM_ROLES" });
    }
  });
});

describe("the Resource Allowance", () => {
  const team = entitlementFor({
    terms: planTerms({ features: [], resourceAllowance: 5, price: money(8900) }),
    grants: [],
    previews: [],
    today,
  });

  it("makes room while calendars on offer are below it", () => {
    expect(() => requireRoomForResource(team, 4)).not.toThrow();
  });

  it("refuses a calendar that would go past it", () => {
    try {
      requireRoomForResource(team, 5);
      expect.unreachable();
    } catch (error) {
      expect(isDomainError(error) && error.code).toBe("NOT_ENTITLED");
      expect(isDomainError(error) && error.details).toEqual({ resourceAllowance: 5 });
    }
  });

  it("counts how many calendars sit beyond it", () => {
    expect(resourcesBeyondAllowance(team, 3)).toBe(0);
    expect(resourcesBeyondAllowance(team, 5)).toBe(0);
    expect(resourcesBeyondAllowance(team, 7)).toBe(2);
  });
});
