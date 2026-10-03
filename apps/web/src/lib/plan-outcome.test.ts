import { describe, expect, it } from "vitest";
import type { PlanDto, SubscriptionDto } from "@/lib/api/types.ts";
import { outcomeOf } from "./plan-outcome.ts";

const solo: PlanDto = { plan: "SOLO", planVersion: 1, priceMinor: 4900, price: 49, resourceAllowance: 1, features: ["REMINDERS"] };
const team: PlanDto = {
  plan: "TEAM",
  planVersion: 1,
  priceMinor: 8900,
  price: 89,
  resourceAllowance: 5,
  features: ["REMINDERS", "CUSTOMER_HISTORY", "TEAM_ROLES"],
};

const on = (plan: PlanDto, paidThrough: string | null): SubscriptionDto => ({
  id: "s",
  businessId: "b",
  plan: plan.plan,
  planVersion: plan.planVersion,
  priceMinor: plan.priceMinor,
  price: plan.price,
  resourceAllowance: plan.resourceAllowance,
  features: plan.features,
  trialEndsOn: paidThrough === null ? "2026-09-30" : null,
  paidThrough,
  scheduledMove: null,
});

describe("outcomeOf", () => {
  it("says nothing changes for the plan already held", () => {
    expect(outcomeOf(on(solo, null), solo)).toEqual({ kind: "SAME" });
  });

  it("upgrades at once, though Team costs more", () => {
    expect(outcomeOf(on(solo, "2026-10-23"), team)).toEqual({ kind: "UPGRADE_NOW" });
  });

  it("downgrades a paying Business on the day after its paid time", () => {
    expect(outcomeOf(on(team, "2026-10-23"), solo)).toEqual({ kind: "DOWNGRADE_AT", on: "2026-10-24" });
  });

  it("downgrades at once when nothing was paid for", () => {
    expect(outcomeOf(on(team, null), solo)).toEqual({ kind: "DOWNGRADE_NOW" });
  });
});
