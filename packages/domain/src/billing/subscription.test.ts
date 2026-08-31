import { describe, expect, it } from "vitest";
import {
  applyPayment,
  GRACE_PERIOD_DAYS,
  graceEndsOn,
  shouldDeactivate,
  subscriptionStateOn,
  type Subscription,
} from "./subscription.ts";
import { asId } from "../model/ids.ts";
import { money } from "../model/money.ts";
import { parseLocalDate } from "../time/local-date.ts";

const day = parseLocalDate;

const subscription = (overrides: Partial<Subscription> = {}): Subscription => ({
  id: asId("subscription-1"),
  businessId: asId("business-1"),
  plan: "STANDARD",
  amount: money(9900),
  billingPeriod: "MONTHLY",
  paidThrough: day("2026-09-30"),
  ...overrides,
});

describe("subscriptionStateOn", () => {
  it("is current up to and including the paid-through date", () => {
    expect(subscriptionStateOn(subscription(), day("2026-09-30"))).toBe("CURRENT");
  });

  it("enters the grace period the day after", () => {
    expect(subscriptionStateOn(subscription(), day("2026-10-01"))).toBe("IN_GRACE");
  });

  it("stays in grace for fourteen days", () => {
    expect(graceEndsOn(subscription())).toBe("2026-10-14");
    expect(GRACE_PERIOD_DAYS).toBe(14);
    expect(subscriptionStateOn(subscription(), day("2026-10-14"))).toBe("IN_GRACE");
  });

  it("lapses once the grace period elapses", () => {
    expect(subscriptionStateOn(subscription(), day("2026-10-15"))).toBe("LAPSED");
  });

  it("never lapses on a free plan", () => {
    expect(
      subscriptionStateOn(subscription({ plan: "FREE" }), day("2030-01-01")),
    ).toBe("CURRENT");
  });
});

describe("shouldDeactivate", () => {
  it("holds off during the grace period and fires after it", () => {
    expect(shouldDeactivate(subscription(), day("2026-10-14"))).toBe(false);
    expect(shouldDeactivate(subscription(), day("2026-10-15"))).toBe(true);
  });
});

describe("applyPayment", () => {
  it("extends from the paid-through date when paying early", () => {
    const extended = applyPayment(subscription(), day("2026-09-20"));
    expect(extended.paidThrough).toBe("2026-10-30");
  });

  it("extends from the payment date when paying late, without crediting the lapse", () => {
    const extended = applyPayment(subscription(), day("2026-10-20"));
    expect(extended.paidThrough).toBe("2026-11-19");
  });

  it("extends by a year on a yearly period", () => {
    const extended = applyPayment(
      subscription({ billingPeriod: "YEARLY" }),
      day("2026-09-20"),
    );
    expect(extended.paidThrough).toBe("2027-09-30");
  });

  it("returns a new subscription rather than mutating the original", () => {
    const original = subscription();
    const extended = applyPayment(original, day("2026-09-20"));
    expect(original.paidThrough).toBe("2026-09-30");
    expect(extended).not.toBe(original);
  });
});
