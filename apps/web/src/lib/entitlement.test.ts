import { describe, expect, it } from "vitest";
import { calendarsFull, cheapestRoomierThan, cheapestWith, includes } from "./entitlement.ts";
import type { PlanDto } from "@/lib/api/types.ts";

const solo = { entitlement: { features: ["REMINDERS" as const], resourceAllowance: 1 } };

describe("includes", () => {
  it("answers from the plan when the API sent one", () => {
    expect(includes(solo, "REMINDERS")).toBe(true);
    expect(includes(solo, "TEAM_ROLES")).toBe(false);
  });

  it("reads a Business with no Entitlement as holding everything", () => {
    expect(includes({}, "TEAM_ROLES")).toBe(true);
  });
});

describe("calendarsFull", () => {
  it("is full once the calendars on offer reach the allowance", () => {
    expect(calendarsFull(solo, 0)).toBe(false);
    expect(calendarsFull(solo, 1)).toBe(true);
    expect(calendarsFull(solo, 2)).toBe(true);
  });

  it("is never full without an Entitlement to say so", () => {
    expect(calendarsFull({}, 9)).toBe(false);
  });
});

const plans: PlanDto[] = [
  { plan: "TEAM", planVersion: 1, priceMinor: 8900, price: 89, resourceAllowance: 5, features: ["REMINDERS", "TEAM_ROLES"] },
  { plan: "SOLO", planVersion: 1, priceMinor: 4900, price: 49, resourceAllowance: 1, features: ["REMINDERS"] },
];

describe("the plan a lock points to", () => {
  it("is the cheapest one that includes the Feature", () => {
    expect(cheapestWith(plans, "REMINDERS")?.plan).toBe("SOLO");
    expect(cheapestWith(plans, "TEAM_ROLES")?.plan).toBe("TEAM");
    expect(cheapestWith(plans, "WAITING_LIST")).toBeNull();
  });

  it("is the cheapest one with room for another calendar", () => {
    expect(cheapestRoomierThan(plans, 1)?.plan).toBe("TEAM");
    expect(cheapestRoomierThan(plans, 5)).toBeNull();
  });
});
