import { describe, expect, it } from "vitest";
import { asId, type PlanVersionId } from "../model/ids.ts";
import { money } from "../model/money.ts";
import { parseLocalDate } from "../time/local-date.ts";
import { backFromEdition, classifyChange, isEditionMove, moveToEdition, type EditionsOf } from "./catalogue-change.ts";
import { planTerms, type Plan } from "./plan.ts";
import type { Subscription } from "./subscription.ts";

const day = parseLocalDate;
const terms = (features: ("REMINDERS" | "TEAM_ROLES")[], allowance: number, price: number) =>
  planTerms({ features, resourceAllowance: allowance, price: money(price) });

const PLAN_OF: Record<string, Plan> = { "solo-1": "SOLO", "solo-2": "SOLO", "team-1": "TEAM" };
const planOf: EditionsOf = (id) => PLAN_OF[id] ?? null;
const id = (value: string): PlanVersionId => asId(value);

const subscription = (overrides: Partial<Subscription> = {}): Subscription => ({
  id: asId("subscription"),
  businessId: asId("business"),
  planVersionId: id("solo-1"),
  trialEndsOn: null,
  paidThrough: day("2026-10-15"),
  scheduledMove: null,
  ...overrides,
});

describe("classifyChange", () => {
  const solo = terms(["REMINDERS"], 1, 4900);

  it("finds nothing in the same terms", () => {
    expect(classifyChange(solo, terms(["REMINDERS"], 1, 4900)).kind).toBe("NONE");
  });

  it("gives when it only adds or lowers", () => {
    expect(classifyChange(solo, terms(["REMINDERS", "TEAM_ROLES"], 1, 4900)).kind).toBe("GIVES");
    expect(classifyChange(solo, terms(["REMINDERS"], 2, 4900)).kind).toBe("GIVES");
    expect(classifyChange(solo, terms(["REMINDERS"], 1, 3900)).kind).toBe("GIVES");
  });

  it("takes when it takes anything, even while giving something else", () => {
    expect(classifyChange(solo, terms(["REMINDERS"], 1, 5900)).kind).toBe("TAKES");
    expect(classifyChange(solo, terms([], 1, 4900)).kind).toBe("TAKES");
    expect(classifyChange(solo, terms(["REMINDERS", "TEAM_ROLES"], 1, 5900))).toMatchObject({
      kind: "TAKES",
      change: { featuresAdded: ["TEAM_ROLES"], price: { from: 4900, to: 5900 } },
    });
  });
});

describe("moveToEdition", () => {
  const input = { plan: "SOLO" as const, editionId: id("solo-2"), planOf, noticedOn: day("2026-09-28") };

  it("moves a Business on an older edition at its first renewal thirty days on", () => {
    // Renewals fall on 10-16, 11-15; the Notice needs 10-28 or later.
    expect(moveToEdition(subscription(), input)?.scheduledMove).toEqual({
      planVersionId: "solo-2",
      effectiveOn: "2026-11-15",
    });
  });

  it("moves a Trial at the Trial's end when that is thirty days on", () => {
    const trial = subscription({ paidThrough: null, trialEndsOn: day("2026-10-27") });
    expect(moveToEdition(trial, input)?.scheduledMove?.effectiveOn).toBe("2026-10-28");
  });

  it("leaves an owner who is leaving the Plan on their own move", () => {
    const leaving = subscription({ scheduledMove: { planVersionId: id("team-1"), effectiveOn: day("2026-10-16") } });
    expect(moveToEdition(leaving, input)).toBeNull();
  });

  it("carries an owner moving into the Plan onto the new edition, never sooner than the Notice allows", () => {
    const joining = subscription({
      planVersionId: id("team-1"),
      scheduledMove: { planVersionId: id("solo-1"), effectiveOn: day("2026-10-16") },
    });
    expect(moveToEdition(joining, input)?.scheduledMove).toEqual({ planVersionId: "solo-2", effectiveOn: "2026-11-15" });
    const later = subscription({
      planVersionId: id("team-1"),
      scheduledMove: { planVersionId: id("solo-1"), effectiveOn: day("2026-12-15") },
    });
    expect(moveToEdition(later, input)?.scheduledMove?.effectiveOn).toBe("2026-12-15");
  });

  it("does not reach another Plan's Businesses, or those already on the new edition", () => {
    expect(moveToEdition(subscription({ planVersionId: id("team-1") }), input)).toBeNull();
    expect(moveToEdition(subscription({ planVersionId: id("solo-2") }), input)).toBeNull();
  });
});

describe("backFromEdition", () => {
  const input = { withdrawnId: id("solo-2"), previousId: id("solo-1"), plan: "SOLO" as const, planOf };

  it("returns those who joined the new edition to the one before", () => {
    expect(backFromEdition(subscription({ planVersionId: id("solo-2") }), input)?.planVersionId).toBe("solo-1");
  });

  it("withdraws the move of those who were to move onto it", () => {
    const moving = subscription({ scheduledMove: { planVersionId: id("solo-2"), effectiveOn: day("2026-11-15") } });
    expect(backFromEdition(moving, input)?.scheduledMove).toBeNull();
  });

  it("keeps an owner moving into the Plan moving, onto the edition that stands again", () => {
    const joining = subscription({
      planVersionId: id("team-1"),
      scheduledMove: { planVersionId: id("solo-2"), effectiveOn: day("2026-11-15") },
    });
    expect(backFromEdition(joining, input)?.scheduledMove).toEqual({ planVersionId: "solo-1", effectiveOn: "2026-11-15" });
  });

  it("leaves everyone else alone", () => {
    expect(backFromEdition(subscription(), input)).toBeNull();
  });
});

describe("isEditionMove", () => {
  it("tells the Catalogue's move from the owner's", () => {
    expect(
      isEditionMove(subscription({ scheduledMove: { planVersionId: id("solo-2"), effectiveOn: day("2026-11-15") } }), planOf),
    ).toBe(true);
    expect(
      isEditionMove(subscription({ scheduledMove: { planVersionId: id("team-1"), effectiveOn: day("2026-11-15") } }), planOf),
    ).toBe(false);
    expect(isEditionMove(subscription(), planOf)).toBe(false);
  });
});
