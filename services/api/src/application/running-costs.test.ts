import { beforeEach, describe, expect, it } from "vitest";
import { asId, money, parseLocalDate, type RunningCostAmount } from "@tor-now/domain";
import { anAdministrator, costHarness } from "../infrastructure/testing/cost-fixtures.ts";
import { signIn, type Harness } from "../infrastructure/testing/harness.ts";

/**
 * Running costs (ADR 0023): what the platform pays whatever the Businesses do,
 * entered by hand like a Unit Rate — a monthly amount from a day, with where
 * the figure came from. Today is 20 September 2026.
 */
describe("running costs", () => {
  let test: Harness;

  beforeEach(() => {
    test = costHarness();
  });

  const amount = (from: string, minor: number, source = "invoice August"): RunningCostAmount => ({
    effectiveFrom: parseLocalDate(from),
    amount: money(minor),
    source,
  });

  it("adds one under a trimmed name with its first amount, and audits it", async () => {
    const admin = await anAdministrator(test);
    const costs = await test.services.costs.addRunningCost(admin, {
      name: "  Supabase ",
      amount: amount("2026-09-01", 9_250, "  חשבונית אוגוסט "),
    });
    expect(costs).toEqual([
      {
        id: expect.any(String),
        name: "Supabase",
        amounts: [{ effectiveFrom: "2026-09-01", amount: 9_250, source: "חשבונית אוגוסט" }],
      },
    ]);
    expect(test.store.audit.filter((entry) => entry.action === "RUNNING_COST_SET")).toHaveLength(1);
  });

  it("takes a new amount from a day, keeps the old one, and replaces one for the same day", async () => {
    const admin = await anAdministrator(test);
    const [hosting] = await test.services.costs.addRunningCost(admin, { name: "Supabase", amount: amount("2026-09-01", 9_250) });
    const id = hosting?.id ?? asId("");
    await test.services.costs.setRunningCostAmount(admin, id, amount("2026-10-01", 11_100, "new plan"));
    const [corrected] = await test.services.costs.setRunningCostAmount(admin, id, amount("2026-09-01", 9_990, "corrected"));
    expect(corrected?.amounts).toEqual([
      { effectiveFrom: "2026-09-01", amount: 9_990, source: "corrected" },
      { effectiveFrom: "2026-10-01", amount: 11_100, source: "new plan" },
    ]);
    const audited = test.store.audit.filter((entry) => entry.action === "RUNNING_COST_SET");
    expect(audited).toHaveLength(3);
    expect(audited[2]?.before).toMatchObject({ amounts: [{ amount: 9_250 }, { amount: 11_100 }] });
  });

  it("stops one with zero from a day, and a stopped one no longer counts", async () => {
    const admin = await anAdministrator(test);
    const [hosting] = await test.services.costs.addRunningCost(admin, { name: "Heroku", amount: amount("2026-08-01", 5_000) });
    await test.services.costs.setRunningCostAmount(admin, hosting?.id ?? asId(""), amount("2026-09-01", 0, "cancelled"));
    const month = await test.services.costs.month(admin, null);
    expect(month.platform.running).toEqual([]);
    const august = await test.services.costs.month(admin, parseLocalDate("2026-08-01"));
    expect(august.platform.running.map((line) => line.amount)).toEqual([5_000]);
  });

  it("refuses a name already listed, in any case", async () => {
    const admin = await anAdministrator(test);
    await test.services.costs.addRunningCost(admin, { name: "Vercel", amount: amount("2026-09-01", 7_400) });
    await expect(
      test.services.costs.addRunningCost(admin, { name: " vercel ", amount: amount("2026-09-01", 1) }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { field: "name" } });
  });

  it("refuses an amount below zero or in fractions, more than a year ahead, or with no source", async () => {
    const admin = await anAdministrator(test);
    const add = (value: RunningCostAmount) => test.services.costs.addRunningCost(admin, { name: "Twilio", amount: value });
    await expect(add({ ...amount("2026-09-01", 1), amount: -1 as never })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(add({ ...amount("2026-09-01", 1), amount: 12.5 as never })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(add(amount("2027-09-21", 100))).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: { field: "effectiveFrom" },
    });
    await expect(add(amount("2026-09-01", 100, "  "))).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: { field: "source" },
    });
    expect(await test.services.costs.runningCosts(admin)).toEqual([]);
  });

  it("says a cost that does not exist is not found", async () => {
    await expect(
      test.services.costs.setRunningCostAmount(await anAdministrator(test), asId("missing"), amount("2026-09-01", 100)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is the administrators' alone", async () => {
    const owner = (await signIn(test, "+972500000009")).actor;
    await expect(test.services.costs.runningCosts(owner)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      test.services.costs.addRunningCost(owner, { name: "x y", amount: amount("2026-09-01", 1) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      test.services.costs.setRunningCostAmount(owner, asId("x"), amount("2026-09-01", 1)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
