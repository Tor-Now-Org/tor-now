import { describe, expect, it } from "vitest";
import { asId } from "../model/ids.ts";
import { money } from "../model/money.ts";
import { parseLocalDate } from "../time/local-date.ts";
import {
  addAddon,
  cancelAddon,
  checkAddonSale,
  checkPriceChange,
  endIncluded,
  MAX_ADDONS_ON_SALE,
  priceDrop,
  priceOn,
  priceRise,
  resumeAddon,
  riseCancelled,
  type AddonHolding,
  type AddonOffer,
} from "./addon.ts";
import { planTerms, type PlanVersion } from "./plan.ts";

const day = parseLocalDate;
const today = day("2026-10-02");

const edition = (plan: "SOLO" | "TEAM", features: PlanVersion["terms"]["features"]): PlanVersion => ({
  id: asId(`${plan}-1`),
  plan,
  number: 1,
  terms: planTerms({ features, resourceAllowance: plan === "SOLO" ? 1 : 5, price: money(plan === "SOLO" ? 4900 : 8900) }),
});
const editions = [
  edition("SOLO", ["REMINDERS"]),
  edition("TEAM", ["REMINDERS", "CUSTOMER_HISTORY", "TEAM_ROLES"]),
];

const offer = (overrides: Partial<AddonOffer> = {}): AddonOffer => ({
  feature: "CUSTOMER_HISTORY",
  price: money(1900),
  since: day("2026-09-28"),
  stoppedOn: null,
  rise: null,
  ...overrides,
});

const holding = (overrides: Partial<AddonHolding> = {}): AddonHolding => ({
  id: asId("h1"),
  businessId: asId("b1"),
  feature: "CUSTOMER_HISTORY",
  addedOn: day("2026-10-02"),
  paysFrom: day("2026-11-27"),
  price: money(1900),
  nextPrice: null,
  endsOn: null,
  ending: null,
  ...overrides,
});

/** Paid through 26 November. */
const paid = { trialEndsOn: null, paidThrough: day("2026-11-26") };

describe("checkAddonSale", () => {
  const sale = { feature: "CUSTOMER_HISTORY" as const, price: 1900, offers: [], editions, previewing: [], today };

  it("puts a Feature some Plan lacks on sale at a whole, positive price", () => {
    expect(checkAddonSale(sale)).toBe(1900);
  });

  it("refuses a Feature every Plan has, one in Preview, one on sale already, and a third", () => {
    expect(() => checkAddonSale({ ...sale, feature: "REMINDERS" })).toThrow(/every plan/i);
    expect(() => checkAddonSale({ ...sale, previewing: ["CUSTOMER_HISTORY"] })).toThrow(/preview/i);
    expect(() => checkAddonSale({ ...sale, offers: [offer()] })).toThrow(/already/i);
    const two = [offer({ feature: "WAITING_LIST" }), offer({ feature: "TEAM_ROLES" })];
    expect(two).toHaveLength(MAX_ADDONS_ON_SALE);
    expect(() => checkAddonSale({ ...sale, offers: two })).toThrow(/two/i);
  });

  it("counts only what is still on sale, and lets a Preview's end open one", () => {
    const stopped = [offer({ feature: "REMINDERS", stoppedOn: day("2026-09-30") }), offer({ feature: "TEAM_ROLES" })];
    expect(checkAddonSale({ ...sale, offers: stopped })).toBe(1900);
    expect(checkAddonSale({ ...sale, feature: "WAITING_LIST", previewing: ["WAITING_LIST"], placing: true })).toBe(1900);
  });

  it("refuses a price that is not a positive whole number of agorot", () => {
    expect(() => checkAddonSale({ ...sale, price: 0 })).toThrow(/price/i);
    expect(() => checkAddonSale({ ...sale, price: 19.5 })).toThrow(/price/i);
  });
});

describe("addAddon", () => {
  const input = { offer: offer(), history: [], planFeatures: ["REMINDERS"] as const, subscription: paid, previewEndsOn: null, today };

  it("the first time: at once, paid from the next payment, nothing for the days before it", () => {
    expect(addAddon(input)).toEqual({ kind: "NEW", price: 1900, paysFrom: "2026-11-27", owed: null });
  });

  it("again after it ended: at once, and the days until the next payment are owed", () => {
    const ended = holding({ endsOn: day("2026-09-30"), ending: "CANCELLED" });
    expect(addAddon({ ...input, history: [ended], today: day("2026-11-12") })).toEqual({
      kind: "NEW",
      price: 1900,
      paysFrom: "2026-11-27",
      owed: { amount: 950, from: "2026-11-12", through: "2026-11-26" },
    });
  });

  it("while a cancellation has not landed yet: the cancellation is withdrawn, nothing more", () => {
    const cancelled = holding({ endsOn: day("2026-11-26"), ending: "CANCELLED" });
    expect(addAddon({ ...input, history: [cancelled] })).toEqual({ kind: "RESUME", holding: cancelled });
  });

  it("during a Trial: paid from the Trial's end, never charged for days", () => {
    const trial = { trialEndsOn: day("2026-10-20"), paidThrough: null };
    const ended = holding({ endsOn: day("2026-10-01"), ending: "CANCELLED" });
    expect(addAddon({ ...input, subscription: trial, history: [ended] })).toEqual({
      kind: "NEW",
      price: 1900,
      paysFrom: "2026-10-21",
      owed: null,
    });
  });

  it("while a Preview still gives it: paid from the first payment after the Preview ends", () => {
    const leaving = offer({ feature: "WAITING_LIST" });
    expect(
      addAddon({ ...input, offer: leaving, previewEndsOn: day("2026-12-10") }),
    ).toMatchObject({ kind: "NEW", paysFrom: "2026-12-27" });
  });

  it("refuses what the Plan has, what is held already, and what is not on sale", () => {
    expect(() => addAddon({ ...input, planFeatures: ["CUSTOMER_HISTORY"] })).toThrow(/plan/i);
    expect(() => addAddon({ ...input, history: [holding()] })).toThrow(/already/i);
    expect(() => addAddon({ ...input, offer: null })).toThrow(/sale/i);
    expect(() => addAddon({ ...input, offer: offer({ stoppedOn: day("2026-10-01") }) })).toThrow(/sale/i);
  });
});

describe("cancelAddon and resumeAddon", () => {
  it("keeps it until the end of what was paid for", () => {
    expect(cancelAddon({ holding: holding(), subscription: paid, today })).toEqual({ endsOn: "2026-11-26" });
  });

  it("stops it at once when nothing covers today", () => {
    const lapsed = { trialEndsOn: null, paidThrough: day("2026-09-20") };
    expect(cancelAddon({ holding: holding(), subscription: lapsed, today })).toEqual({ endsOn: "2026-10-01" });
  });

  it("refuses what is cancelled already, and resumes only what still runs", () => {
    const cancelled = holding({ endsOn: day("2026-11-26"), ending: "CANCELLED" });
    expect(() => cancelAddon({ holding: cancelled, subscription: paid, today })).toThrow(/cancelled/i);
    expect(() => resumeAddon({ holding: cancelled, today: day("2026-11-27") })).toThrow(/ended/i);
    expect(() => resumeAddon({ holding: holding(), today })).toThrow(/not cancelled/i);
    expect(() => resumeAddon({ holding: cancelled, today })).not.toThrow();
  });
});

describe("prices", () => {
  const subscriptions = new Map([
    [asId<"Business">("b1"), { trialEndsOn: null, paidThrough: day("2026-10-26") }],
    [asId<"Business">("b2"), { trialEndsOn: null, paidThrough: day("2026-11-10") }],
  ]);
  const b1 = holding({ id: asId("h1"), businessId: asId("b1") });
  const b2 = holding({ id: asId("h2"), businessId: asId("b2") });

  it("a rise reaches each holder at their first renewal thirty days on, and new buyers at once", () => {
    const risen = priceRise({ offer: offer(), to: money(2400), holdings: [b1, b2], subscriptions, today });
    expect(risen.offer).toEqual({
      ...offer(),
      price: 2400,
      rise: { from: 1900, announcedOn: "2026-10-02", firstOn: "2026-11-11", lastOn: "2026-11-26" },
    });
    expect(risen.holdings).toEqual([
      { id: "h1", nextPrice: { price: 2400, effectiveOn: "2026-11-26" } },
      { id: "h2", nextPrice: { price: 2400, effectiveOn: "2026-11-11" } },
    ]);
  });

  it("a rise with nobody holding it only changes the price for new buyers", () => {
    const risen = priceRise({ offer: offer(), to: money(2400), holdings: [], subscriptions, today });
    expect(risen.offer.rise).toBeNull();
    expect(risen.offer.price).toBe(2400);
  });

  it("a holder pays the new price from the day it reaches them", () => {
    const rising = holding({ nextPrice: { price: money(2400), effectiveOn: day("2026-11-27") } });
    expect(priceOn(rising, day("2026-11-26"))).toBe(1900);
    expect(priceOn(rising, day("2026-11-27"))).toBe(2400);
  });

  it("only one rise waits at a time, and it can be cancelled until the first holder moves", () => {
    const rising = offer({ price: money(2400), rise: { from: money(1900), announcedOn: today, firstOn: day("2026-11-11"), lastOn: day("2026-11-26") } });
    expect(() => checkPriceChange({ offer: rising, to: 2900, today })).toThrow(/rise/i);
    expect(checkPriceChange({ offer: rising, to: 1500, today })).toBe(1500);
    expect(riseCancelled({ offer: rising, today })).toEqual({ ...offer(), price: 1900, rise: null });
    expect(() => riseCancelled({ offer: rising, today: day("2026-11-11") })).toThrow(/moved/i);
    expect(checkPriceChange({ offer: rising, to: 2900, today: day("2026-11-27") })).toBe(2900);
  });

  it("refuses the same price, and a change to what is no longer sold", () => {
    expect(() => checkPriceChange({ offer: offer(), to: 1900, today })).toThrow(/same/i);
    expect(() => checkPriceChange({ offer: offer({ stoppedOn: today }), to: 1500, today })).toThrow(/sale/i);
  });

  it("a drop applies to everyone at once, and swallows a rise it undercuts", () => {
    const rising = offer({ price: money(2400), rise: { from: money(1900), announcedOn: today, firstOn: day("2026-11-11"), lastOn: day("2026-11-26") } });
    const heldRising = holding({ nextPrice: { price: money(2400), effectiveOn: day("2026-11-26") } });
    const partly = priceDrop({ offer: rising, to: money(2200), holdings: [heldRising] });
    expect(partly.offer.rise).not.toBeNull();
    expect(partly.holdings).toEqual([{ id: "h1", price: 1900, nextPrice: { price: 2200, effectiveOn: "2026-11-26" } }]);
    const below = priceDrop({ offer: rising, to: money(1500), holdings: [heldRising] });
    expect(below.offer).toEqual({ ...rising, price: 1500, rise: null });
    expect(below.holdings).toEqual([{ id: "h1", price: 1500, nextPrice: null }]);
  });
});

describe("endIncluded", () => {
  it("ends an Add-on the Plan now gives, from today", () => {
    expect(endIncluded(today)).toEqual({ endsOn: "2026-10-01", ending: "INCLUDED" });
  });
});
