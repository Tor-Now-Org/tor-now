import { describe, expect, it } from "vitest";
import { standingOf, TRIAL_ENDING_DAYS, type StandingInput } from "./standing.ts";
import { asId } from "../model/ids.ts";
import { parseLocalDate } from "../time/local-date.ts";

const day = parseLocalDate;
const today = day("2026-09-16");

const input = (overrides: Partial<StandingInput> = {}): StandingInput => ({
  subscription: {
    trialEndsOn: null,
    paidThrough: day("2026-10-23"),
    scheduledMove: null,
  },
  businessActive: true,
  resourcesOnOffer: 1,
  resourceAllowance: 1,
  today,
  ...overrides,
});

const withSubscription = (subscription: Partial<StandingInput["subscription"]>) =>
  input({ subscription: { ...input().subscription, ...subscription } });

describe("standingOf — the status", () => {
  it("is PAID with paid time running, dated by the paid-through day", () => {
    expect(standingOf(input())).toMatchObject({ status: "PAID", nextDate: "2026-10-23" });
  });

  it("is TRIAL during an unpaid Trial, dated by its last day", () => {
    const standing = standingOf(withSubscription({ trialEndsOn: day("2026-09-30"), paidThrough: null }));
    expect(standing).toMatchObject({ status: "TRIAL", nextDate: "2026-09-30" });
  });

  it("is IN_GRACE once paid time is over, dated by the grace period's last day", () => {
    const standing = standingOf(withSubscription({ paidThrough: day("2026-09-14") }));
    expect(standing).toMatchObject({ status: "IN_GRACE", nextDate: "2026-09-17" });
  });

  it("is LAPSED after the grace period, dated by the first day it no longer covered", () => {
    const standing = standingOf(withSubscription({ paidThrough: day("2026-08-20") }));
    expect(standing).toMatchObject({ status: "LAPSED", nextDate: "2026-08-24" });
  });

  it("is LAPSED the day after an unpaid Trial", () => {
    const standing = standingOf(withSubscription({ trialEndsOn: day("2026-09-15"), paidThrough: null }));
    expect(standing).toMatchObject({ status: "LAPSED", nextDate: "2026-09-16" });
  });

  it("is LAPSED with no date when there was neither Trial nor payment", () => {
    const standing = standingOf(withSubscription({ paidThrough: null }));
    expect(standing).toMatchObject({ status: "LAPSED", nextDate: null });
  });

  it("is DEACTIVATED when an administrator switched off a Business that is not lapsed", () => {
    expect(standingOf(input({ businessActive: false })).status).toBe("DEACTIVATED");
  });

  it("stays LAPSED, not DEACTIVATED, when it was switched off for not paying", () => {
    const standing = standingOf(
      input({ businessActive: false, subscription: { ...input().subscription, paidThrough: day("2026-08-01") } }),
    );
    expect(standing.status).toBe("LAPSED");
  });
});

describe("standingOf — the flags", () => {
  it("flags a Trial ending within seven days, and not one further off", () => {
    expect(TRIAL_ENDING_DAYS).toBe(7);
    const ending = standingOf(withSubscription({ trialEndsOn: day("2026-09-23"), paidThrough: null }));
    const later = standingOf(withSubscription({ trialEndsOn: day("2026-09-24"), paidThrough: null }));
    expect(ending.flags).toContain("TRIAL_ENDING");
    expect(later.flags).not.toContain("TRIAL_ENDING");
  });

  it("flags a scheduled move", () => {
    const standing = standingOf(
      withSubscription({ scheduledMove: { planVersionId: asId("solo-2"), effectiveOn: day("2026-10-24") } }),
    );
    expect(standing.flags).toEqual(["MOVE_PENDING"]);
  });

  it("flags more calendars on offer than the plan allows", () => {
    expect(standingOf(input({ resourcesOnOffer: 3, resourceAllowance: 1 })).flags).toEqual(["OVER_ALLOWANCE"]);
    expect(standingOf(input({ resourcesOnOffer: 1, resourceAllowance: 1 })).flags).toEqual([]);
  });
});
