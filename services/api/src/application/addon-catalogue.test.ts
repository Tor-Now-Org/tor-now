import { beforeEach, describe, expect, it } from "vitest";
import { parseInstant, parseLocalDate, type NoticeKind } from "@tor-now/domain";
import { harness, signIn, type Harness } from "../infrastructure/testing/harness.ts";
import { anEstablishedBusiness } from "../infrastructure/testing/scenarios.ts";
import { isBillingNotice } from "../ports/notifier.ts";

/**
 * The Catalogue's side of Add-ons (ADR 0021). The harness's today is 25 August
 * 2026. A new Business's Trial ends on 23 September; paying on the day it
 * opens covers it to 23 October, so its next renewal is on the 24th.
 */
describe("selling Add-ons", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  type Shop = Awaited<ReturnType<typeof anEstablishedBusiness>>;
  const anAdministrator = async () => (await signIn(test, "+972500000000", "שקד")).administrator;
  const factsOf = (shop: Shop, kind: NoticeKind) =>
    test.store.notices.filter((entry) => entry.notice.businessId === shop.business.id && entry.notice.facts.kind === kind).at(-1)
      ?.notice.facts;
  const whatsappKinds = () =>
    test.store.outbox.map((entry) => entry.message).filter(isBillingNotice).map((message) => message.payload.facts.kind);
  const viewOf = (views: readonly { feature: string }[], feature: string) => views.find((view) => view.feature === feature);

  /** A paying Solo shop and a Team shop, the Team one owned by someone else. */
  const twoShops = async () => {
    const admin = await anAdministrator();
    const solo = await anEstablishedBusiness(test, { plan: "SOLO" });
    await test.services.admin.recordPayment(admin, solo.business.id, { amountMinor: 4900, paidOn: "2026-08-25", note: null });
    const owner = await signIn(test, "+972500000088", "נוי");
    const teamBusiness = await test.services.business.register(owner.actor, {
      name: "סטודיו נוי",
      phone: "+972500000088",
      description: null,
      address: "רחוב הרצל 2",
      latitude: 32.0853,
      longitude: 34.7818,
      categories: ["barbershop"],
      plan: "TEAM",
      resourceNames: ["נוי"],
      services: [{ name: "תספורת", durationMinutes: 30, priceMinor: 8000, bufferMinutes: null }],
      workingHours: [{ dayOfWeek: 2, start: "09:00", end: "17:00" }],
    });
    return { admin, solo, team: { ...solo, owner, business: teamBusiness } };
  };

  it("puts a Feature on sale and tells only the Businesses whose Plan lacks it", async () => {
    const { admin, solo, team } = await twoShops();

    const views = await test.services.addonCatalogue.sell(admin, "CUSTOMER_HISTORY", 1900);

    expect(viewOf(views, "CUSTOMER_HISTORY")).toMatchObject({ addon: { price: 1900, stoppedOn: null, rise: null }, canSell: false });
    expect(factsOf(solo, "ADDON_OFFERED")).toEqual({ kind: "ADDON_OFFERED", feature: "CUSTOMER_HISTORY", priceMinor: 1900 });
    expect(factsOf(team, "ADDON_OFFERED")).toBeUndefined();
    expect(whatsappKinds()).not.toContain("ADDON_OFFERED");
    expect(test.store.audit.some((entry) => entry.action === "ADDON_OFFER_CHANGED")).toBe(true);
  });

  it("refuses a Feature every Plan has, and one in Preview", async () => {
    const { admin } = await twoShops();
    await expect(test.services.addonCatalogue.sell(admin, "REMINDERS", 900)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(test.services.addonCatalogue.sell(admin, "WAITING_LIST", 900)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("keeps a Feature on sale out of Preview, which would give for nothing what some pay for", async () => {
    const { admin } = await twoShops();
    const views = await test.services.addonCatalogue.sell(admin, "CUSTOMER_HISTORY", 1900);
    expect(viewOf(views, "CUSTOMER_HISTORY")).toMatchObject({ canPreview: false });
    await expect(
      test.services.featureCatalogue.startPreview(admin, "CUSTOMER_HISTORY", parseLocalDate("2026-10-24")),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("is the administrators' alone", async () => {
    const { solo } = await twoShops();
    await expect(test.services.addonCatalogue.sell(solo.owner.actor, "CUSTOMER_HISTORY", 1900)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  describe("prices", () => {
    const holding = async () => {
      const shops = await twoShops();
      await test.services.addonCatalogue.sell(shops.admin, "CUSTOMER_HISTORY", 1900);
      await test.services.addons.addMine(shops.solo.owner.actor, shops.solo.business.id, "CUSTOMER_HISTORY");
      return shops;
    };

    it("a rise reaches a holder at their first renewal thirty days on, told on WhatsApp — new buyers pay it at once", async () => {
      const { admin, solo } = await holding();

      const views = await test.services.addonCatalogue.changePrice(admin, "CUSTOMER_HISTORY", 2400);

      expect(viewOf(views, "CUSTOMER_HISTORY")).toMatchObject({
        addon: { price: 2400, rise: { from: 1900, firstOn: "2026-10-24", lastOn: "2026-10-24" } },
      });
      expect(test.store.addonHoldings[0]).toMatchObject({ price: 1900, nextPrice: { price: 2400, effectiveOn: "2026-10-24" } });
      expect(factsOf(solo, "ADDON_PRICE_RISING")).toEqual({
        kind: "ADDON_PRICE_RISING",
        feature: "CUSTOMER_HISTORY",
        priceFrom: 1900,
        priceTo: 2400,
        effectiveOn: "2026-10-24",
      });
      expect(whatsappKinds()).toContain("ADDON_PRICE_RISING");
      const board = await test.services.addons.mine(solo.owner.actor, solo.business.id);
      expect(board.nextPayment.total).toBe(4900 + 2400);

      // A week before, the owner is reminded; a second rise waits until this one has landed.
      test.travelTo(parseInstant("2026-10-18T06:00:00.000Z"));
      await test.services.admin.announceDueNotices({ kind: "SYSTEM" });
      expect(factsOf(solo, "ADDON_PRICE_SOON")).toMatchObject({ priceTo: 2400, effectiveOn: "2026-10-24" });
      await expect(test.services.addonCatalogue.changePrice(admin, "CUSTOMER_HISTORY", 2900)).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });

    it("a rise is withdrawn, until the first holder pays it, and everyone is back on the old price", async () => {
      const { admin, solo } = await holding();
      await test.services.addonCatalogue.changePrice(admin, "CUSTOMER_HISTORY", 2400);

      const views = await test.services.addonCatalogue.cancelRise(admin, "CUSTOMER_HISTORY");

      expect(viewOf(views, "CUSTOMER_HISTORY")).toMatchObject({ addon: { price: 1900, rise: null } });
      expect(test.store.addonHoldings[0]).toMatchObject({ price: 1900, nextPrice: null });
      expect(factsOf(solo, "ADDON_RISE_CANCELLED")).toEqual({ kind: "ADDON_RISE_CANCELLED", feature: "CUSTOMER_HISTORY", priceMinor: 1900 });
      expect(whatsappKinds()).toEqual(expect.arrayContaining(["ADDON_PRICE_RISING", "ADDON_RISE_CANCELLED"]));

      await test.services.addonCatalogue.changePrice(admin, "CUSTOMER_HISTORY", 2400);
      test.travelTo(parseInstant("2026-10-24T06:00:00.000Z"));
      await expect(test.services.addonCatalogue.cancelRise(admin, "CUSTOMER_HISTORY")).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("a drop reaches everyone at once", async () => {
      const { admin, solo } = await holding();
      await test.services.addonCatalogue.changePrice(admin, "CUSTOMER_HISTORY", 1500);
      expect(test.store.addonHoldings[0]).toMatchObject({ price: 1500, nextPrice: null });
      expect(factsOf(solo, "ADDON_PRICE_LOWERED")).toEqual({
        kind: "ADDON_PRICE_LOWERED",
        feature: "CUSTOMER_HISTORY",
        priceFrom: 1900,
        priceTo: 1500,
      });
      expect(whatsappKinds()).not.toContain("ADDON_PRICE_LOWERED");
    });

    it("stopping the sale keeps it for those who hold it, and nobody new adds it", async () => {
      const { admin, solo } = await holding();
      const views = await test.services.addonCatalogue.stop(admin, "CUSTOMER_HISTORY");
      expect(viewOf(views, "CUSTOMER_HISTORY")).toMatchObject({ addon: null, counts: { ADDON: 1 }, canSell: true });
      const board = await test.services.addons.mine(solo.owner.actor, solo.business.id);
      expect(board.addons[0]).toMatchObject({ feature: "CUSTOMER_HISTORY", onSale: false, holding: expect.objectContaining({ ending: null }) });

      const other = await anEstablishedBusiness(test, { plan: "SOLO" });
      await expect(test.services.addons.addMine(other.owner.actor, other.business.id, "CUSTOMER_HISTORY")).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
    });
  });

  describe("which plans", () => {
    it("including a Feature gives: every edition has it now, and what was an Add-on ends", async () => {
      const { admin, solo } = await twoShops();
      await test.services.addonCatalogue.sell(admin, "CUSTOMER_HISTORY", 1900);
      await test.services.addons.addMine(solo.owner.actor, solo.business.id, "CUSTOMER_HISTORY");

      const views = await test.services.addonCatalogue.setPlans(admin, "CUSTOMER_HISTORY", ["SOLO", "TEAM"]);

      expect(viewOf(views, "CUSTOMER_HISTORY")).toMatchObject({
        plans: [
          { plan: "SOLO", number: 1, included: true },
          { plan: "TEAM", number: 1, included: true },
        ],
        addon: null,
        counts: { PLAN: 2, ADDON: 0 },
      });
      expect(test.store.addonHoldings[0]).toMatchObject({ ending: "INCLUDED" });
      expect(factsOf(solo, "ADDON_INCLUDED")).toEqual({ kind: "ADDON_INCLUDED", feature: "CUSTOMER_HISTORY", plan: "SOLO" });
      expect(factsOf(solo, "PLAN_IMPROVED")).toMatchObject({ gained: ["CUSTOMER_HISTORY"] });
      expect(test.store.addonOffers[0]?.stoppedOn).toBe("2026-08-25");
    });

    it("leaving one out takes: a new edition, with thirty days' Notice on WhatsApp too", async () => {
      const { admin, team } = await twoShops();

      const views = await test.services.addonCatalogue.setPlans(admin, "CUSTOMER_HISTORY", []);

      expect(viewOf(views, "CUSTOMER_HISTORY")).toMatchObject({
        plans: [
          { plan: "SOLO", number: 1, included: false },
          { plan: "TEAM", number: 2, included: false },
        ],
      });
      expect(factsOf(team, "EDITION_ANNOUNCED")).toMatchObject({ plan: "TEAM", lost: ["CUSTOMER_HISTORY"] });
      expect(whatsappKinds()).toContain("EDITION_ANNOUNCED");
    });

    it("refuses nothing changed, and a Feature in Preview", async () => {
      const { admin } = await twoShops();
      await expect(test.services.addonCatalogue.setPlans(admin, "TEAM_ROLES", ["TEAM"])).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
      await expect(test.services.addonCatalogue.setPlans(admin, "WAITING_LIST", ["TEAM"])).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
    });
  });

  it("at a Preview's end, sells its Feature to the Plans losing it, and the Notice says what keeping it costs", async () => {
    const { admin, solo } = await twoShops();

    const views = await test.services.featureCatalogue.placePreview(admin, "WAITING_LIST", ["TEAM"], 1500);

    expect(viewOf(views, "WAITING_LIST")).toMatchObject({ addon: { price: 1500 } });
    expect(factsOf(solo, "PREVIEW_LEAVING")).toMatchObject({ plan: "SOLO", addonPriceMinor: 1500 });
    // Added while the Preview still gives it: paid only from the first payment after it ends.
    const board = await test.services.addons.addMine(solo.owner.actor, solo.business.id, "WAITING_LIST");
    expect(board.addons[0]?.holding).toMatchObject({ paysFrom: "2026-10-24" });
    expect(test.store.previews.find((preview) => preview.feature === "WAITING_LIST")?.endsOn).toBe("2026-10-23");
  });
});
