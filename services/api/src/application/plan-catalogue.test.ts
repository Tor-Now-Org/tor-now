import { beforeEach, describe, expect, it } from "vitest";
import { parseInstant, type NoticeKind } from "@tor-now/domain";
import { harness, signIn, type Harness } from "../infrastructure/testing/harness.ts";
import { anEstablishedBusiness } from "../infrastructure/testing/scenarios.ts";
import { isBillingNotice } from "../ports/notifier.ts";

/**
 * Editing Plans (ADR 0020, ADR 0021). The harness opens every Business on
 * 25 August 2026, so a Trial runs to 23 September and renews on the 24th —
 * exactly thirty days on, the first day a change announced today may land.
 */
describe("editing Plans", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  type Shop = Awaited<ReturnType<typeof anEstablishedBusiness>>;
  const anAdministrator = async () => (await signIn(test, "+972500000000", "שקד")).administrator;
  const solo = { priceMinor: 4900, resourceAllowance: 1, features: ["REMINDERS"] as const };
  const team = {
    priceMinor: 8900,
    resourceAllowance: 5,
    features: ["REMINDERS", "CUSTOMER_HISTORY", "TEAM_ROLES"] as const,
  };

  const kindsOf = (shop: Shop): NoticeKind[] =>
    test.store.notices
      .filter((entry) => entry.notice.businessId === shop.business.id)
      .map((entry) => entry.notice.facts.kind);
  const whatsappKinds = () =>
    test.store.outbox.map((entry) => entry.message).filter(isBillingNotice).map((message) => message.payload.facts.kind);
  const subscriptionOf = (shop: Shop) => test.store.subscriptions.find((s) => s.businessId === shop.business.id);
  const editionOf = (shop: Shop) =>
    test.store.planVersions.find((edition) => edition.id === subscriptionOf(shop)?.planVersionId);
  const on = (date: string) => test.travelTo(parseInstant(`${date}T06:00:00.000Z`));
  const dailyRun = async () => {
    await test.services.admin.applyDueMoves({ kind: "SYSTEM" });
    await test.services.admin.announceDueNotices({ kind: "SYSTEM" });
  };

  describe("a change that gives", () => {
    it("applies to every edition at once, tells everyone on the Plan in the app, and publishes nothing", async () => {
      const shop = await anEstablishedBusiness(test);
      const result = await test.services.planCatalogue.changePlan(await anAdministrator(), "TEAM", {
        ...team,
        resourceAllowance: 8,
      });

      expect(result.kind).toBe("GIVES");
      expect(test.store.planVersions.filter((edition) => edition.plan === "TEAM")).toHaveLength(1);
      expect(editionOf(shop)?.terms.resourceAllowance).toBe(8);
      expect(test.store.notices.find((entry) => entry.notice.facts.kind === "PLAN_IMPROVED")?.notice.facts).toEqual({
        kind: "PLAN_IMPROVED",
        plan: "TEAM",
        priceFrom: 8900,
        priceTo: 8900,
        allowanceFrom: 5,
        allowanceTo: 8,
        gained: [],
      });
      expect(whatsappKinds()).toEqual([]);
      expect(test.store.audit.some((entry) => entry.action === "PLAN_TERMS_IMPROVED")).toBe(true);
    });

    it("counts a lower price as giving", async () => {
      await anEstablishedBusiness(test, { plan: "SOLO" });
      const result = await test.services.planCatalogue.changePlan(await anAdministrator(), "SOLO", {
        ...solo,
        priceMinor: 3900,
      });
      expect(result.kind).toBe("GIVES");
      expect(test.store.planVersions.find((edition) => edition.plan === "SOLO")?.terms.price).toBe(3900);
    });
  });

  describe("a change that takes", () => {
    const raiseSolo = async () =>
      test.services.planCatalogue.changePlan(await anAdministrator(), "SOLO", { ...solo, priceMinor: 5900 });

    it("publishes a new edition, moves existing Businesses at their renewal, and tells them on WhatsApp", async () => {
      const shop = await anEstablishedBusiness(test, { plan: "SOLO" });

      const result = await raiseSolo();

      expect(result.kind).toBe("TAKES");
      const v2 = test.store.planVersions.find((edition) => edition.plan === "SOLO" && edition.number === 2);
      expect(v2?.terms.price).toBe(5900);
      expect(v2?.firstMoveOn).toBe("2026-09-24");
      expect(subscriptionOf(shop)?.scheduledMove).toEqual({ planVersionId: v2?.id, effectiveOn: "2026-09-24" });
      expect(editionOf(shop)?.number).toBe(1);
      expect(test.store.notices.find((entry) => entry.notice.facts.kind === "EDITION_ANNOUNCED")?.notice.facts).toMatchObject({
        plan: "SOLO",
        effectiveOn: "2026-09-24",
        priceFrom: 4900,
        priceTo: 5900,
      });
      expect(whatsappKinds()).toEqual(["EDITION_ANNOUNCED"]);
      const view = result.plans.find((plan) => plan.plan === "SOLO");
      expect(view?.pending).toMatchObject({ cancellable: true, moving: [{ effectiveOn: "2026-09-24" }] });
    });

    it("lets new Businesses join the new edition at once", async () => {
      await anEstablishedBusiness(test, { plan: "SOLO" });
      await raiseSolo();
      const current = await test.services.catalogue.current({ kind: "ANONYMOUS" });
      expect(current.plans.find((plan) => plan.plan === "SOLO")?.number).toBe(2);
    });

    it("refuses a second change while the first waits", async () => {
      await anEstablishedBusiness(test, { plan: "SOLO" });
      await raiseSolo();
      await expect(
        test.services.planCatalogue.changePlan(await anAdministrator(), "SOLO", { ...solo, priceMinor: 6900 }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("never lets an owner withdraw it by choosing their Plan again", async () => {
      const shop = await anEstablishedBusiness(test, { plan: "SOLO" });
      await raiseSolo();
      const before = subscriptionOf(shop)?.scheduledMove;
      await test.services.business.changePlan(shop.owner.actor, shop.business.id, "SOLO", undefined);
      expect(subscriptionOf(shop)?.scheduledMove).toEqual(before);
    });

    it("reminds a week ahead, and says so on the day it lands", async () => {
      const shop = await anEstablishedBusiness(test, { plan: "SOLO" });
      await raiseSolo();
      await test.services.admin.recordPayment(await anAdministrator(), shop.business.id, {
        amountMinor: 4900,
        paidOn: "2026-08-25",
        note: null,
      });

      on("2026-09-17");
      await dailyRun();
      expect(kindsOf(shop)).toContain("EDITION_SOON");
      on("2026-09-24");
      await dailyRun();
      expect(kindsOf(shop)).toContain("EDITION_APPLIED");
      expect(kindsOf(shop)).not.toContain("MOVE_APPLIED");
      expect(editionOf(shop)?.number).toBe(2);
    });
  });

  describe("cancelling", () => {
    it("puts everyone back as if it never was, and tells them all", async () => {
      const existing = await anEstablishedBusiness(test, { plan: "SOLO" });
      const admin = await anAdministrator();
      await test.services.planCatalogue.changePlan(admin, "SOLO", { ...solo, priceMinor: 5900 });
      const joined = await (async () => {
        const owner = await signIn(test, "+972500000077", "נוי");
        return test.services.business.register(owner.actor, {
          name: "סטודיו נוי",
          phone: "+972500000077",
          description: null,
          address: "רחוב הרצל 2",
          latitude: 32.0853,
          longitude: 34.7818,
          category: "barbershop",
          plan: "SOLO",
          resourceNames: ["נוי"],
          services: [{ name: "תספורת", durationMinutes: 30, priceMinor: 8000, bufferMinutes: null }],
          workingHours: [{ dayOfWeek: 2, start: "09:00", end: "17:00" }],
        });
      })();
      expect(test.store.planVersions.find((e) => e.id === test.store.subscriptions.find((s) => s.businessId === joined.id)?.planVersionId)?.number).toBe(2);

      const result = await test.services.planCatalogue.cancelChange(admin, "SOLO");

      expect(subscriptionOf(existing)?.scheduledMove).toBeNull();
      const joinedEdition = test.store.planVersions.find(
        (edition) => edition.id === test.store.subscriptions.find((s) => s.businessId === joined.id)?.planVersionId,
      );
      expect(joinedEdition?.number).toBe(1);
      expect(test.store.planVersions.find((edition) => edition.number === 2)?.withdrawnAt).not.toBeNull();
      expect(result.plans.find((plan) => plan.plan === "SOLO")?.current.number).toBe(1);
      expect(whatsappKinds().filter((kind) => kind === "EDITION_CANCELLED")).toHaveLength(2);
      expect(test.store.audit.some((entry) => entry.action === "PLAN_EDITION_WITHDRAWN")).toBe(true);
    });

    it("is refused once the first Business has moved", async () => {
      await anEstablishedBusiness(test, { plan: "SOLO" });
      const admin = await anAdministrator();
      await test.services.planCatalogue.changePlan(admin, "SOLO", { ...solo, priceMinor: 5900 });
      on("2026-09-24");
      await expect(test.services.planCatalogue.cancelChange(admin, "SOLO")).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("is refused when nothing waits", async () => {
      await expect(test.services.planCatalogue.cancelChange(await anAdministrator(), "TEAM")).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });
  });

  describe("what the editor refuses", () => {
    it("a change that changes nothing, a Feature still in Preview, and anyone but an administrator", async () => {
      const admin = await anAdministrator();
      await expect(test.services.planCatalogue.changePlan(admin, "TEAM", team)).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
      await expect(
        test.services.planCatalogue.changePlan(admin, "TEAM", { ...team, features: [...team.features, "WAITING_LIST"] }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { features: ["WAITING_LIST"] } });
      const owner = await signIn(test, "+972500000001");
      await expect(test.services.planCatalogue.plans(owner.actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("the Plans view", () => {
    it("counts Businesses per edition, and says when a change published today would land", async () => {
      await anEstablishedBusiness(test, { plan: "SOLO" });
      const { plans } = await test.services.planCatalogue.plans(await anAdministrator());
      const soloView = plans.find((plan) => plan.plan === "SOLO");
      expect(soloView?.editions.map((edition) => [edition.edition.number, edition.businesses, edition.current])).toEqual([
        [1, 1, true],
      ]);
      expect(soloView?.pending).toBeNull();
      expect(soloView?.ifTakenToday).toEqual({ firstMoveOn: "2026-09-24", lastMoveOn: "2026-09-24", businesses: 1 });
    });
  });
});
