import { describe, expect, it } from "vitest";
import {
  compareTerms,
  planThatFits,
  extendTerms,
  givesValue,
  planTerms,
  takesValueAway,
  type PlanTerms,
  type PlanVersion,
} from "./plan.ts";
import { asId } from "../model/ids.ts";
import { money } from "../model/money.ts";
import { isDomainError } from "../shared/errors.ts";

const solo = (overrides: Partial<PlanTerms> = {}): PlanTerms =>
  planTerms({
    features: ["REMINDERS"],
    resourceAllowance: 1,
    price: money(4900),
    ...overrides,
  });

describe("planTerms", () => {
  it("keeps each feature once, in the catalogue's order", () => {
    const terms = solo({ features: ["WAITING_LIST", "REMINDERS", "WAITING_LIST"] });
    expect(terms.features).toEqual(["REMINDERS", "WAITING_LIST"]);
  });

  it("refuses an allowance below one calendar", () => {
    expect(() => solo({ resourceAllowance: 0 })).toThrow(/at least one/);
  });

  it("refuses a fractional allowance", () => {
    const attempt = () => solo({ resourceAllowance: 1.5 });
    expect(attempt).toThrow();
    try {
      attempt();
    } catch (error) {
      expect(isDomainError(error) && error.code).toBe("VALIDATION_FAILED");
    }
  });

  it("refuses an unknown feature", () => {
    expect(() => solo({ features: ["TELEPORT" as never] })).toThrow(/Unknown feature/);
  });
});

describe("compareTerms", () => {
  it("finds nothing between identical terms", () => {
    const change = compareTerms(solo(), solo());
    expect(givesValue(change)).toBe(false);
    expect(takesValueAway(change)).toBe(false);
  });

  it("treats an added feature as giving value", () => {
    const change = compareTerms(solo(), solo({ features: ["REMINDERS", "WAITING_LIST"] }));
    expect(change.featuresAdded).toEqual(["WAITING_LIST"]);
    expect(givesValue(change)).toBe(true);
    expect(takesValueAway(change)).toBe(false);
  });

  it("treats a removed feature as taking value away", () => {
    const change = compareTerms(solo(), solo({ features: [] }));
    expect(change.featuresRemoved).toEqual(["REMINDERS"]);
    expect(takesValueAway(change)).toBe(true);
  });

  it("treats a lower price as giving and a higher one as taking", () => {
    expect(givesValue(compareTerms(solo(), solo({ price: money(3900) })))).toBe(true);
    expect(takesValueAway(compareTerms(solo(), solo({ price: money(5900) })))).toBe(true);
  });

  it("treats a larger allowance as giving and a smaller one as taking", () => {
    const team = solo({ resourceAllowance: 5 });
    expect(givesValue(compareTerms(team, solo({ resourceAllowance: 6 })))).toBe(true);
    expect(takesValueAway(compareTerms(team, solo({ resourceAllowance: 4 })))).toBe(true);
  });

  it("counts a change that both gives and takes as taking — it needs a Notice", () => {
    const change = compareTerms(
      solo(),
      solo({ features: ["REMINDERS", "WAITING_LIST"], price: money(5900) }),
    );
    expect(givesValue(change)).toBe(true);
    expect(takesValueAway(change)).toBe(true);
  });
});

describe("extendTerms", () => {
  it("carries only what was given onto an older edition", () => {
    const older = solo({ price: money(3900) });
    const change = compareTerms(
      solo(),
      solo({ features: ["REMINDERS", "WAITING_LIST"], resourceAllowance: 2, price: money(5900) }),
    );
    const extended = extendTerms(older, change);
    expect(extended.features).toEqual(["REMINDERS", "WAITING_LIST"]);
    expect(extended.resourceAllowance).toBe(2);
    // A price rise is taken away, never given: the older edition keeps its own.
    expect(extended.price).toBe(3900);
  });

  it("lowers an older edition's price only when the new one is lower still", () => {
    const change = compareTerms(solo(), solo({ price: money(4500) }));
    expect(extendTerms(solo({ price: money(3900) }), change).price).toBe(3900);
    expect(extendTerms(solo({ price: money(5900) }), change).price).toBe(4500);
  });

  it("never shrinks an older edition's allowance", () => {
    const change = compareTerms(solo({ resourceAllowance: 5 }), solo({ resourceAllowance: 6 }));
    expect(extendTerms(solo({ resourceAllowance: 8 }), change).resourceAllowance).toBe(8);
  });

  it("does not remove a feature the older edition has", () => {
    const change = compareTerms(solo(), solo({ features: [] }));
    expect(extendTerms(solo(), change).features).toEqual(["REMINDERS"]);
  });

  it("returns a new value rather than changing the one it was given", () => {
    const older = solo();
    const change = compareTerms(solo(), solo({ features: ["REMINDERS", "TEAM_ROLES"] }));
    extendTerms(older, change);
    expect(older.features).toEqual(["REMINDERS"]);
  });
});

describe("planThatFits", () => {
  const edition = (plan: "SOLO" | "TEAM", allowance: number, price: number): PlanVersion => ({
    id: asId(plan),
    plan,
    number: 1,
    terms: planTerms({ features: [], resourceAllowance: allowance, price: money(price) }),
  });
  const solo = edition("SOLO", 1, 4900);
  const team = edition("TEAM", 5, 8900);

  it("picks the cheapest plan with room", () => {
    expect(planThatFits([team, solo], 1)?.plan).toBe("SOLO");
    expect(planThatFits([team, solo], 2)?.plan).toBe("TEAM");
    expect(planThatFits([team, solo], 5)?.plan).toBe("TEAM");
  });

  it("finds none when no plan has room", () => {
    expect(planThatFits([team, solo], 6)).toBeNull();
  });
});
