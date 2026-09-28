import { beforeEach, describe, expect, it } from "vitest";
import { parseInstant, type NoticeKind } from "@tor-now/domain";
import { entitlementToday } from "./billing.ts";
import { harness, signIn, type Harness } from "../infrastructure/testing/harness.ts";
import { anEstablishedBusiness } from "../infrastructure/testing/scenarios.ts";
import { inMemoryRepositories } from "../infrastructure/testing/in-memory-repositories.ts";

/**
 * Add-ons as a Business holds them (ADR 0021). The harness's today is 25
 * August 2026; a new Business's Trial ends on 23 September, and paying for
 * it covers it to 23 October — so its next payment is on the 24th.
 */
describe("Add-ons held", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  type Shop = Awaited<ReturnType<typeof anEstablishedBusiness>>;
  const anAdministrator = async () => (await signIn(test, "+972500000000", "שקד")).administrator;
  const travelTo = (day: string) => test.travelTo(parseInstant(`${day}T06:00:00.000Z`));
  const kindsOf = (shop: Shop): NoticeKind[] =>
    test.store.notices.filter((entry) => entry.notice.businessId === shop.business.id).map((entry) => entry.notice.facts.kind);
  const factsOf = (shop: Shop, kind: NoticeKind) =>
    test.store.notices.filter((entry) => entry.notice.businessId === shop.business.id && entry.notice.facts.kind === kind).at(-1)
      ?.notice.facts;
  const entitled = async (shop: Shop) =>
    (await entitlementToday(inMemoryRepositories(test.store), shop.business.id, test.clock)).features;

  /** A Solo shop that paid on the day it opened, with Customer history on sale at ₪19. */
  const aPayingSoloShop = async () => {
    const shop = await anEstablishedBusiness(test, { plan: "SOLO" });
    const admin = await anAdministrator();
    await test.services.admin.recordPayment(admin, shop.business.id, { amountMinor: 4900, paidOn: "2026-08-25", note: null });
    await test.services.addonCatalogue.sell(admin, "CUSTOMER_HISTORY", 1900);
    return { shop, admin };
  };

  it("the first time: at once, paid from the next payment, with nothing owed for the days before it", async () => {
    const { shop } = await aPayingSoloShop();

    const board = await test.services.addons.addMine(shop.owner.actor, shop.business.id, "CUSTOMER_HISTORY");

    expect(board.addons).toEqual([
      expect.objectContaining({ feature: "CUSTOMER_HISTORY", price: 1900, holding: expect.objectContaining({ paysFrom: "2026-10-24" }) }),
    ]);
    expect(board.nextPayment).toEqual({
      on: "2026-10-24",
      lines: [
        { kind: "PLAN", plan: "SOLO", amount: 4900 },
        { kind: "ADDON", feature: "CUSTOMER_HISTORY", amount: 1900 },
      ],
      total: 6800,
    });
    expect(await entitled(shop)).toContain("CUSTOMER_HISTORY");
    expect(factsOf(shop, "ADDON_ADDED")).toEqual({
      kind: "ADDON_ADDED",
      feature: "CUSTOMER_HISTORY",
      by: "OWNER",
      priceMinor: 1900,
      paysFrom: "2026-10-24",
      owedMinor: 0,
    });
    expect(test.store.daysOwed).toEqual([]);
    expect(test.store.audit.some((entry) => entry.action === "ADDON_ADDED")).toBe(true);
  });

  it("cancelling keeps it to the end of what is paid for, and adding it then just withdraws the cancellation", async () => {
    const { shop } = await aPayingSoloShop();
    await test.services.addons.addMine(shop.owner.actor, shop.business.id, "CUSTOMER_HISTORY");

    const cancelled = await test.services.addons.cancelMine(shop.owner.actor, shop.business.id, "CUSTOMER_HISTORY");
    expect(cancelled.addons[0]?.holding).toMatchObject({ endsOn: "2026-10-23", ending: "CANCELLED" });
    expect(cancelled.nextPayment.total).toBe(4900);
    expect(kindsOf(shop)).toContain("ADDON_CANCELLED");
    expect(await entitled(shop)).toContain("CUSTOMER_HISTORY");

    const resumed = await test.services.addons.addMine(shop.owner.actor, shop.business.id, "CUSTOMER_HISTORY");
    expect(resumed.addons[0]?.holding).toMatchObject({ endsOn: null, ending: null });
    expect(test.store.addonHoldings).toHaveLength(1);
    expect(test.store.daysOwed).toEqual([]);
  });

  it("adding it back after it ended owes the days until the next payment — adding, cancelling and adding again is never free", async () => {
    const { shop, admin } = await aPayingSoloShop();
    await test.services.addons.addMine(shop.owner.actor, shop.business.id, "CUSTOMER_HISTORY");
    await test.services.addons.cancelMine(shop.owner.actor, shop.business.id, "CUSTOMER_HISTORY");
    travelTo("2026-10-24");
    await test.services.admin.recordPayment(admin, shop.business.id, { amountMinor: 4900, paidOn: "2026-10-24", note: null });
    expect(await entitled(shop)).not.toContain("CUSTOMER_HISTORY");
    travelTo("2026-11-06");

    const before = await test.services.addons.mine(shop.owner.actor, shop.business.id);
    expect(before.addons[0]).toMatchObject({
      hadBefore: true,
      ifAdded: { paysFrom: "2026-11-24", owed: { amount: 1140, from: "2026-11-06", through: "2026-11-23" } },
    });
    const board = await test.services.addons.addMine(shop.owner.actor, shop.business.id, "CUSTOMER_HISTORY");

    expect(test.store.daysOwed).toEqual([
      expect.objectContaining({ kind: "ADDON_DAYS", subject: "CUSTOMER_HISTORY", amount: 1140, paymentId: null }),
    ]);
    expect(board.nextPayment.total).toBe(4900 + 1900 + 1140);
    expect(factsOf(shop, "ADDON_ADDED")).toMatchObject({ owedMinor: 1140, paysFrom: "2026-11-24" });

    // The next payment settles what was owed.
    await test.services.admin.recordPayment(admin, shop.business.id, { amountMinor: 7940, paidOn: "2026-11-24", note: null });
    expect(test.store.daysOwed[0]?.paymentId).not.toBeNull();
    expect((await test.services.addons.mine(shop.owner.actor, shop.business.id)).nextPayment.total).toBe(6800);
  });

  it("is included in a Trial while it lasts, and paid from the Trial's end if kept", async () => {
    const shop = await anEstablishedBusiness(test, { plan: "SOLO" });
    await test.services.addonCatalogue.sell(await anAdministrator(), "CUSTOMER_HISTORY", 1900);

    expect(await entitled(shop)).toContain("CUSTOMER_HISTORY");
    const board = await test.services.addons.mine(shop.owner.actor, shop.business.id);
    expect(board.addons[0]).toMatchObject({ inTrialUntil: "2026-09-23", ifAdded: { paysFrom: "2026-09-24", owed: null } });

    travelTo("2026-09-24");
    expect(await entitled(shop)).not.toContain("CUSTOMER_HISTORY");
  });

  it("an administrator adds and cancels one for an owner who phones in, by the same rules, and says so", async () => {
    const { shop, admin } = await aPayingSoloShop();

    await test.services.addons.addFor(admin, shop.business.id, "CUSTOMER_HISTORY");
    expect(factsOf(shop, "ADDON_ADDED")).toMatchObject({ by: "ADMINISTRATOR" });
    await test.services.addons.cancelFor(admin, shop.business.id, "CUSTOMER_HISTORY");
    expect(factsOf(shop, "ADDON_CANCELLED")).toMatchObject({ by: "ADMINISTRATOR", endsOn: "2026-10-23" });

    await expect(test.services.addons.addFor(shop.owner.actor, shop.business.id, "CUSTOMER_HISTORY")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const stranger = await signIn(test, "+972500000077", "זר");
    await expect(test.services.addons.addMine(stranger.actor, shop.business.id, "CUSTOMER_HISTORY")).rejects.toMatchObject({
      code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/),
    });
  });

  it("refuses what the Plan has, what is not on sale, and what is held already", async () => {
    const { shop } = await aPayingSoloShop();
    await expect(test.services.addons.addMine(shop.owner.actor, shop.business.id, "TEAM_ROLES")).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await test.services.addons.addMine(shop.owner.actor, shop.business.id, "CUSTOMER_HISTORY");
    await expect(test.services.addons.addMine(shop.owner.actor, shop.business.id, "CUSTOMER_HISTORY")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(test.services.addons.cancelMine(shop.owner.actor, shop.business.id, "TEAM_ROLES")).rejects.toMatchObject({
      code: "CONFLICT",
    });

    const team = await anEstablishedBusiness(test, { plan: "TEAM" });
    expect((await test.services.addons.mine(team.owner.actor, team.business.id)).addons).toEqual([]);
  });

  describe("moving between Plans", () => {
    it("ends an Add-on the new Plan includes, so it is no longer paid for", async () => {
      const { shop } = await aPayingSoloShop();
      await test.services.addons.addMine(shop.owner.actor, shop.business.id, "CUSTOMER_HISTORY");

      await test.services.business.changePlan(shop.owner.actor, shop.business.id, "TEAM", undefined);

      expect(test.store.addonHoldings[0]).toMatchObject({ endsOn: "2026-08-24", ending: "INCLUDED" });
      expect(factsOf(shop, "ADDON_INCLUDED")).toEqual({ kind: "ADDON_INCLUDED", feature: "CUSTOMER_HISTORY", plan: "TEAM" });
      const board = await test.services.addons.mine(shop.owner.actor, shop.business.id);
      expect(board.nextPayment.lines).toEqual([{ kind: "PLAN", plan: "TEAM", amount: 8900 }]);
      expect(test.store.daysOwed).toEqual([]);
    });

    it("moving up again to a Plan left before owes the difference for the days already paid for", async () => {
      const { shop, admin } = await aPayingSoloShop();
      const { owner, business } = shop;
      await test.services.business.changePlan(owner.actor, business.id, "TEAM", undefined);
      await test.services.business.changePlan(owner.actor, business.id, "SOLO", undefined);
      travelTo("2026-10-24");
      await test.services.admin.applyDueMoves({ kind: "SYSTEM" });
      await test.services.admin.recordPayment(admin, business.id, { amountMinor: 4900, paidOn: "2026-10-24", note: null });
      travelTo("2026-11-06");

      const before = await test.services.addons.mine(owner.actor, business.id);
      expect(before.moveUpOwed).toEqual([{ plan: "TEAM", owed: { amount: 2400, from: "2026-11-06", through: "2026-11-23" } }]);
      await test.services.business.changePlan(owner.actor, business.id, "TEAM", undefined);

      expect(test.store.daysOwed).toEqual([expect.objectContaining({ kind: "PLAN_DAYS", subject: "TEAM", amount: 2400 })]);
      expect((await test.services.addons.mine(owner.actor, business.id)).nextPayment.total).toBe(8900 + 2400);
    });
  });
});
