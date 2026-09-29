import { describe, expect, it } from "vitest";
import { asId, type RunningCostId } from "../model/ids.ts";
import { money } from "../model/money.ts";
import { parseLocalDate } from "../time/local-date.ts";
import { microShekels, type UnitRate } from "./cost.ts";
import {
  amountOn,
  checkRunningCostAmount,
  checkRunningCostName,
  MAX_RUNNING_COST_MINOR,
  platformCost,
  runningOn,
  type RunningCost,
} from "./platform-cost.ts";
import { costOfUsage, NO_USAGE_COST } from "./usage-cost.ts";

const day = parseLocalDate;
const id = (value: string) => asId<"RunningCost">(value) as RunningCostId;
const hosting: RunningCost = {
  id: id("hosting"),
  name: "Supabase",
  amounts: [
    { effectiveFrom: day("2026-08-01"), amount: money(9_250), source: "invoice July" },
    { effectiveFrom: day("2026-10-01"), amount: money(11_100), source: "invoice September" },
  ],
};
const domainName: RunningCost = {
  id: id("domain"),
  name: "Domain",
  amounts: [{ effectiveFrom: day("2026-09-15"), amount: money(500), source: "₪60 a year" }],
};
const stopped: RunningCost = {
  id: id("old"),
  name: "Old host",
  amounts: [
    { effectiveFrom: day("2026-01-01"), amount: money(5_000), source: "invoice" },
    { effectiveFrom: day("2026-09-01"), amount: money(0), source: "cancelled" },
  ],
};

describe("running costs", () => {
  it("counts the amount in force on the day: none before the first, the latest after", () => {
    expect(amountOn(hosting, day("2026-07-31"))).toBeNull();
    expect(amountOn(hosting, day("2026-08-01"))?.amount).toBe(9_250);
    expect(amountOn(hosting, day("2026-09-30"))?.amount).toBe(9_250);
    expect(amountOn(hosting, day("2026-10-01"))?.amount).toBe(11_100);
  });

  it("finds the latest whatever order the amounts come in", () => {
    const shuffled = { ...hosting, amounts: [...hosting.amounts].reverse() };
    expect(amountOn(shuffled, day("2026-10-05"))?.amount).toBe(11_100);
  });

  it("leaves out a cost not started yet, and one stopped at zero", () => {
    expect(runningOn([hosting, domainName, stopped], day("2026-09-10"))).toEqual([
      { id: "hosting", name: "Supabase", amount: 9_250, since: "2026-08-01", source: "invoice July" },
    ]);
    expect(runningOn([hosting, domainName, stopped], day("2026-09-20")).map((line) => line.id)).toEqual([
      "hosting",
      "domain",
    ]);
  });

  it("takes a name of 2 to 60 characters, trimmed, not already listed in any case", () => {
    expect(checkRunningCostName("  Vercel  ", ["Supabase"])).toBe("Vercel");
    expect(() => checkRunningCostName("V", [])).toThrow(/name/);
    expect(() => checkRunningCostName("x".repeat(61), [])).toThrow(/name/);
    expect(() => checkRunningCostName(" supabase ", ["Supabase"])).toThrow(/already/);
  });

  it("takes whole agorot from zero, up to a year ahead, with where the figure came from", () => {
    const today = day("2026-09-29");
    expect(
      checkRunningCostAmount({ effectiveFrom: day("2026-09-01"), amount: money(0), source: "  cancelled  " }, today),
    ).toEqual({ effectiveFrom: "2026-09-01", amount: 0, source: "cancelled" });
    expect(() =>
      checkRunningCostAmount({ effectiveFrom: day("2026-09-01"), amount: 12.5 as never, source: "invoice" }, today),
    ).toThrow(/amount/);
    expect(() =>
      checkRunningCostAmount(
        { effectiveFrom: day("2026-09-01"), amount: (MAX_RUNNING_COST_MINOR + 1) as never, source: "invoice" },
        today,
      ),
    ).toThrow(/amount/);
    expect(() =>
      checkRunningCostAmount({ effectiveFrom: day("2027-09-30"), amount: money(100), source: "invoice" }, today),
    ).toThrow(/year ahead/);
    expect(() =>
      checkRunningCostAmount({ effectiveFrom: day("2026-09-01"), amount: money(100), source: " a " }, today),
    ).toThrow(/came from/);
  });
});

describe("platformCost", () => {
  const RATES: UnitRate[] = [
    {
      unit: "WHATSAPP_AUTHENTICATION",
      effectiveFrom: day("2026-09-01"),
      perUnit: microShekels(20_000),
      source: "card",
    },
  ];
  const codes = costOfUsage(
    [
      {
        businessId: null,
        source: "SIGN_IN",
        unit: "WHATSAPP_AUTHENTICATION",
        day: day("2026-09-10"),
        quantity: 100,
        messages: 100,
      },
    ],
    RATES,
  );

  it("adds the measured sign-in codes to every running cost in force, and shares it over the paying", () => {
    const cost = platformCost({ usage: codes, running: [hosting, domainName], day: day("2026-09-29"), paying: 4 });
    expect(cost.signIn).toEqual({ codes: 100, cost: 2_000_000, unpricedUnits: 0 });
    expect(cost.running.map((line) => line.amount)).toEqual([9_250, 500]);
    expect(cost.total).toBe(2_000_000 + (9_250 + 500) * 10_000);
    expect(cost.perPaying).toBe(Math.round(cost.total / 4));
  });

  it("has no share when nobody pays, rather than dividing by nobody", () => {
    expect(platformCost({ usage: NO_USAGE_COST, running: [], day: day("2026-09-29"), paying: 0 })).toEqual({
      signIn: { codes: 0, cost: 0, unpricedUnits: 0 },
      running: [],
      total: 0,
      perPaying: null,
    });
  });
});
