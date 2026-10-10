import { describe, expect, it } from "vitest";
import {
  applyDueMove,
  applyPayment,
  BILLING_PERIOD_DAYS,
  changePlan,
  GRACE_PERIOD_DAYS,
  graceEndsOn,
  moveTakesEffectOn,
  nextDeactivationRun,
  NOTICE_DAYS,
  renewalOn,
  scheduleMove,
  shouldDeactivate,
  subscriptionStateOn,
  TRIAL_DAYS,
  trialEndsOn,
  type Subscription,
} from "./subscription.ts";
import { planTerms, type PlanVersion } from "./plan.ts";
import { asId } from "../model/ids.ts";
import { parseInstant } from "../time/instant.ts";
import { formatLocalTime } from "../time/local-time.ts";
import { instantToZoned, timeZone } from "../time/zone.ts";
import { money } from "../model/money.ts";
import { parseLocalDate } from "../time/local-date.ts";

const day = parseLocalDate;

const paid = (overrides: Partial<Subscription> = {}): Subscription => ({
  id: asId("subscription-1"),
  businessId: asId("business-1"),
  planVersionId: asId("solo-1"),
  trialEndsOn: null,
  paidThrough: day("2026-09-30"),
  scheduledMove: null,
  ...overrides,
});

const inTrial = (overrides: Partial<Subscription> = {}): Subscription =>
  paid({ trialEndsOn: day("2026-09-30"), paidThrough: null, ...overrides });

const version = (id: string, plan: "SOLO" | "TEAM", allowance: number, price: number): PlanVersion => ({
  id: asId(id),
  plan,
  number: 1,
  terms: planTerms({ features: ["REMINDERS"], resourceAllowance: allowance, price: money(price) }),
});

const solo = version("solo-1", "SOLO", 1, 4900);
const team = version("team-1", "TEAM", 5, 8900);

describe("trialEndsOn", () => {
  it("covers thirty days counting the day the Business opened", () => {
    expect(TRIAL_DAYS).toBe(30);
    expect(trialEndsOn(day("2026-09-01"), { ownerHadTrial: false })).toBe("2026-09-30");
  });

  it("is never given twice to one owner", () => {
    expect(trialEndsOn(day("2026-09-01"), { ownerHadTrial: true })).toBeNull();
  });
});

describe("subscriptionStateOn", () => {
  it("is in trial up to and including the trial's last day", () => {
    expect(subscriptionStateOn(inTrial(), day("2026-09-30"))).toBe("TRIAL");
  });

  it("lapses the day after an unpaid trial, with no grace period", () => {
    expect(subscriptionStateOn(inTrial(), day("2026-10-01"))).toBe("LAPSED");
  });

  it("is lapsed from the start when there was neither trial nor payment", () => {
    expect(subscriptionStateOn(paid({ paidThrough: null }), day("2026-09-01"))).toBe("LAPSED");
  });

  it("is current up to and including the paid-through date", () => {
    expect(subscriptionStateOn(paid(), day("2026-09-30"))).toBe("CURRENT");
  });

  it("enters the grace period the day after, once it has been paid", () => {
    expect(subscriptionStateOn(paid(), day("2026-10-01"))).toBe("IN_GRACE");
  });

  it("stays in grace for three days", () => {
    expect(GRACE_PERIOD_DAYS).toBe(3);
    expect(graceEndsOn({ paidThrough: day("2026-09-30") })).toBe("2026-10-03");
    expect(subscriptionStateOn(paid(), day("2026-10-03"))).toBe("IN_GRACE");
  });

  it("lapses once the grace period elapses", () => {
    expect(subscriptionStateOn(paid(), day("2026-10-04"))).toBe("LAPSED");
  });

  it("is current, not in trial, once a trial has been paid for", () => {
    const paidDuringTrial = applyPayment(inTrial(), day("2026-09-10"));
    expect(subscriptionStateOn(paidDuringTrial, day("2026-09-15"))).toBe("CURRENT");
  });
});

describe("shouldDeactivate", () => {
  it("holds off during the grace period and fires after it", () => {
    expect(shouldDeactivate(paid(), day("2026-10-03"))).toBe(false);
    expect(shouldDeactivate(paid(), day("2026-10-04"))).toBe(true);
  });

  it("fires the day after an unpaid trial", () => {
    expect(shouldDeactivate(inTrial(), day("2026-09-30"))).toBe(false);
    expect(shouldDeactivate(inTrial(), day("2026-10-01"))).toBe(true);
  });
});

describe("applyPayment", () => {
  it("extends from the paid-through date when paying early", () => {
    expect(BILLING_PERIOD_DAYS).toBe(30);
    expect(applyPayment(paid(), day("2026-09-20")).paidThrough).toBe("2026-10-30");
  });

  it("extends from the payment date when paying late, without crediting the lapse", () => {
    expect(applyPayment(paid(), day("2026-10-20")).paidThrough).toBe("2026-11-19");
  });

  it("keeps the rest of a trial when paying during it", () => {
    expect(applyPayment(inTrial(), day("2026-09-10")).paidThrough).toBe("2026-10-30");
  });

  it("runs from the payment date when there was never a trial", () => {
    expect(applyPayment(paid({ paidThrough: null }), day("2026-09-10")).paidThrough).toBe(
      "2026-10-10",
    );
  });

  it("returns a new subscription rather than mutating the original", () => {
    const original = paid();
    const extended = applyPayment(original, day("2026-09-20"));
    expect(original.paidThrough).toBe("2026-09-30");
    expect(extended).not.toBe(original);
  });
});

describe("renewalOn", () => {
  it("is the day after the paid-through date", () => {
    expect(renewalOn(paid())).toBe("2026-10-01");
  });

  it("is the day after the trial when nothing was paid", () => {
    expect(renewalOn(inTrial())).toBe("2026-10-01");
  });

  it("does not exist without a trial or a payment", () => {
    expect(renewalOn(paid({ paidThrough: null }))).toBeNull();
  });
});

describe("moveTakesEffectOn", () => {
  it("is the first renewal at least thirty days after the Notice", () => {
    expect(NOTICE_DAYS).toBe(30);
    // Renewals fall on 10-01, 10-31, 11-30. A Notice on 09-05 needs 10-05 or later.
    expect(moveTakesEffectOn(paid(), day("2026-09-05"))).toBe("2026-10-31");
  });

  it("uses a renewal that falls exactly thirty days after the Notice", () => {
    expect(moveTakesEffectOn(paid(), day("2026-09-01"))).toBe("2026-10-01");
  });

  it("is thirty days after the Notice when there is no renewal to wait for", () => {
    expect(moveTakesEffectOn(paid({ paidThrough: null }), day("2026-09-05"))).toBe("2026-10-05");
  });
});

describe("changePlan", () => {
  it("upgrades at once", () => {
    const changed = changePlan(paid(), { from: solo, to: team });
    expect(changed.planVersionId).toBe("team-1");
    expect(changed.scheduledMove).toBeNull();
  });

  it("downgrades at the next renewal, keeping what was paid for", () => {
    const changed = changePlan(paid({ planVersionId: team.id }), { from: team, to: solo });
    expect(changed.planVersionId).toBe("team-1");
    expect(changed.scheduledMove).toEqual({ planVersionId: "solo-1", effectiveOn: "2026-10-01" });
  });

  it("downgrades at once when there is nothing paid to keep", () => {
    const changed = changePlan(paid({ planVersionId: team.id, paidThrough: null }), {
      from: team,
      to: solo,
    });
    expect(changed.planVersionId).toBe("solo-1");
    expect(changed.scheduledMove).toBeNull();
  });

  it("cancels a pending downgrade when the owner picks their current plan again", () => {
    const pending = changePlan(paid({ planVersionId: team.id }), { from: team, to: solo });
    const back = changePlan(pending, { from: team, to: team });
    expect(back.planVersionId).toBe("team-1");
    expect(back.scheduledMove).toBeNull();
  });
});

describe("changePlan and the Catalogue's moves", () => {
  const soloV2: PlanVersion = { ...solo, id: asId("solo-2"), number: 2 };
  const moving = paid({ scheduledMove: { planVersionId: soloV2.id, effectiveOn: day("2026-10-31") } });

  it("never lets an owner withdraw a move onto a new edition by choosing their Plan again", () => {
    expect(changePlan(moving, { from: solo, to: soloV2, scheduled: soloV2 })).toBe(moving);
  });

  it("still lets an owner leave the Plan: the new edition no longer matters", () => {
    expect(changePlan(moving, { from: solo, to: team, scheduled: soloV2 })).toMatchObject({
      planVersionId: "team-1",
      scheduledMove: null,
    });
  });

  it("withdraws the owner's own move to another Plan", () => {
    const leaving = paid({ planVersionId: team.id, scheduledMove: { planVersionId: solo.id, effectiveOn: day("2026-10-01") } });
    expect(changePlan(leaving, { from: team, to: team, scheduled: solo }).scheduledMove).toBeNull();
  });
});

describe("changePlan and older editions", () => {
  it("keeps a Business on its older edition when its own Plan is chosen again", () => {
    const soloV2: PlanVersion = { ...solo, id: asId("solo-2"), number: 2 };
    const pending = paid({ scheduledMove: { planVersionId: asId("team-1"), effectiveOn: day("2026-10-01") } });
    const kept = changePlan(pending, { from: solo, to: soloV2 });
    expect(kept.planVersionId).toBe("solo-1");
    expect(kept.scheduledMove).toBeNull();
  });
});

describe("scheduleMove and applyDueMove", () => {
  it("moves nothing before the date and everything on it", () => {
    const scheduled = scheduleMove(paid(), asId("solo-2"), day("2026-09-01"));
    expect(scheduled.scheduledMove?.effectiveOn).toBe("2026-10-01");
    expect(applyDueMove(scheduled, day("2026-09-30"))).toBe(scheduled);
    const moved = applyDueMove(scheduled, day("2026-10-01"));
    expect(moved.planVersionId).toBe("solo-2");
    expect(moved.scheduledMove).toBeNull();
  });

  it("leaves a subscription with nothing scheduled as it is", () => {
    const untouched = paid();
    expect(applyDueMove(untouched, day("2030-01-01"))).toBe(untouched);
  });
});

describe("nextDeactivationRun", () => {
  const jerusalem = timeZone("Asia/Jerusalem");
  const at = (iso: string) => instantToZoned(parseInstant(iso), jerusalem);

  it("is the coming morning for a Business opened in the afternoon", () => {
    expect(nextDeactivationRun(parseInstant("2026-10-03T11:00:00.000Z"), jerusalem)).toEqual(
      at("2026-10-04T04:00:00.000Z"),
    );
  });

  it("is the same morning for one opened after midnight, before the run", () => {
    const run = nextDeactivationRun(parseInstant("2026-10-03T23:30:00.000Z"), jerusalem);
    expect(run).toEqual(at("2026-10-04T04:00:00.000Z"));
    expect(formatLocalTime(run.time)).toBe("07:00");
  });

  it("moves an hour earlier on the clock once Israel leaves summer time", () => {
    expect(formatLocalTime(nextDeactivationRun(parseInstant("2026-11-03T11:00:00.000Z"), jerusalem).time)).toBe("06:00");
  });
});
