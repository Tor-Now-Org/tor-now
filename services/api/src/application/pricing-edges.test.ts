import { beforeEach, describe, expect, it } from "vitest";
import { asId, microShekels, parseLocalDate } from "@tor-now/domain";
import { harness, signIn, type Harness } from "../infrastructure/testing/harness.ts";
import { anEstablishedBusiness } from "../infrastructure/testing/scenarios.ts";
import { announce } from "./notices.ts";

/**
 * The edges of the pricing services that the scenario tests walk past: what
 * each refuses when what it is pointed at is not there, not on sale, or not
 * running, and the administrator's read-only views. The harness's today is
 * 25 August 2026.
 */
describe("pricing at its edges", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  const anAdministrator = async () => (await signIn(test, "+972500000000", "שקד")).administrator;
  const nowhere = asId<"Business">("00000000-0000-4000-8000-00000000beef");

  describe("the Add-on catalogue", () => {
    it("says a Feature not on sale is not found, to reprice", async () => {
      const admin = await anAdministrator();
      await expect(test.services.addonCatalogue.changePrice(admin, "CUSTOMER_BLOCKING", 1_200)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await test.services.addonCatalogue.sell(admin, "CUSTOMER_BLOCKING", 900);
      await test.services.addonCatalogue.stop(admin, "CUSTOMER_BLOCKING");
      // Stopped is not on sale either: its buyers keep it, nobody reprices it.
      await expect(test.services.addonCatalogue.changePrice(admin, "CUSTOMER_BLOCKING", 1_200)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("refuses a Plan that does not exist when choosing which Plans include a Feature", async () => {
      await expect(
        test.services.addonCatalogue.setPlans(await anAdministrator(), "CUSTOMER_HISTORY", ["SOLO", "GOLD" as never]),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { field: "plans" } });
    });
  });

  describe("Add-ons", () => {
    it("refuses an owner an Add-on that is not on sale, and one whose sale has stopped", async () => {
      const shop = await anEstablishedBusiness(test, { plan: "SOLO" });
      await expect(
        test.services.addons.addMine(shop.owner.actor, shop.business.id, "CUSTOMER_BLOCKING"),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { field: "feature" } });
      const admin = await anAdministrator();
      await test.services.addonCatalogue.sell(admin, "CUSTOMER_BLOCKING", 900);
      await test.services.addonCatalogue.stop(admin, "CUSTOMER_BLOCKING");
      await expect(
        test.services.addons.addMine(shop.owner.actor, shop.business.id, "CUSTOMER_BLOCKING"),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    });

    it("shows an administrator the same payment board the owner sees", async () => {
      const admin = await anAdministrator();
      const shop = await anEstablishedBusiness(test, { plan: "SOLO" });
      await test.services.addonCatalogue.sell(admin, "CUSTOMER_BLOCKING", 900);
      const theirs = await test.services.addons.mine(shop.owner.actor, shop.business.id);
      const ours = await test.services.addons.of(admin, shop.business.id);
      expect(ours).toEqual(theirs);
      expect(ours.addons.map((addon) => addon.feature)).toContain("CUSTOMER_BLOCKING");
    });

    it("says a Business that does not exist is not found, to an administrator acting for it", async () => {
      const admin = await anAdministrator();
      await expect(test.services.addons.of(admin, nowhere)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(test.services.addons.addFor(admin, nowhere, "CUSTOMER_BLOCKING")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("the administrator's billing actions", () => {
    it("say a Business that does not exist is not found", async () => {
      const admin = await anAdministrator();
      await expect(test.services.admin.subscriptionFor(admin, nowhere)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(test.services.admin.changePlan(admin, nowhere, "TEAM")).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        test.services.admin.recordPayment(admin, nowhere, { amountMinor: 4_900, paidOn: "2026-08-25", note: null }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(test.services.admin.calendarsOf(admin, nowhere)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(test.services.admin.keepCalendars(admin, nowhere, [])).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("are the administrators' alone", async () => {
      const shop = await anEstablishedBusiness(test, { plan: "SOLO" });
      const owner = shop.owner.actor;
      await expect(test.services.admin.subscriptionFor(owner, shop.business.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(test.services.admin.changePlan(owner, shop.business.id, "TEAM")).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        test.services.admin.recordPayment(owner, shop.business.id, { amountMinor: 4_900, paidOn: "2026-08-25", note: null }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(test.services.admin.businessRow(owner, shop.business.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("open one Business as the directory shows it, and say one that is missing is not found", async () => {
      const admin = await anAdministrator();
      const shop = await anEstablishedBusiness(test, { plan: "SOLO" });
      const row = await test.services.admin.businessRow(admin, shop.business.id);
      expect(row).toMatchObject({ business: { id: shop.business.id }, planVersion: { plan: "SOLO" } });
      expect(row.standing.status).toBe("TRIAL");
      await expect(test.services.admin.businessRow(admin, nowhere)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("the Catalogue editor's reads", () => {
    it("lists every rate, the defaults included, to an administrator only", async () => {
      const rates = await test.services.catalogueAdmin.rates(await anAdministrator());
      expect(rates.map((rate) => rate.unit).sort()).toEqual(["SMS_SEGMENT", "WHATSAPP_AUTHENTICATION", "WHATSAPP_UTILITY"]);
      expect(rates.every((rate) => rate.checkedBy === null)).toBe(true);
      const owner = await signIn(test, "+972500000009");
      await expect(test.services.catalogueAdmin.rates(owner.actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("shows where each of a Business's Features comes from, and says a missing one is not found", async () => {
      const admin = await anAdministrator();
      const shop = await anEstablishedBusiness(test, { plan: "SOLO" });
      const features = await test.services.catalogueAdmin.features(admin, shop.business.id);
      expect(features.find((feature) => feature.feature === "REMINDERS")?.source).toBe("PLAN");
      expect(features.find((feature) => feature.feature === "CUSTOMER_HISTORY")?.source).toBe("NONE");
      await expect(test.services.catalogueAdmin.features(admin, nowhere)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        test.services.catalogueAdmin.grantFeatures(admin, nowhere, {
          features: ["TEAM_ROLES"],
          endsOn: parseLocalDate("2026-10-01"),
          reason: "פיילוט",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("keeps a rate's day and replaces only the rate for that same day", async () => {
      const admin = await anAdministrator();
      const correction = {
        unit: "SMS_SEGMENT" as const,
        effectiveFrom: parseLocalDate("2026-09-01"),
        perUnit: microShekels(900_000),
        source: "חשבונית Twilio",
      };
      await test.services.catalogueAdmin.setRate(admin, correction);
      const rates = await test.services.catalogueAdmin.setRate(admin, { ...correction, perUnit: microShekels(910_000) });
      const sms = rates.filter((rate) => rate.unit === "SMS_SEGMENT");
      expect(sms).toHaveLength(1);
      expect(sms[0]?.perUnit).toBe(910_000);
    });
  });

  describe("Notices on WhatsApp", () => {
    const trialEnding = (businessId: string) => ({
      businessId: asId<"Business">(businessId),
      facts: { kind: "TRIAL_ENDING" as const, trialEndsOn: parseLocalDate("2026-09-24") },
      at: test.clock.now(),
    });

    it("go to the owner who has owned the Business longest", async () => {
      const shop = await anEstablishedBusiness(test, { plan: "SOLO" });
      const outboxBefore = test.store.outbox.length;
      await test.unitOfWork.run({ kind: "SYSTEM" }, (session) => announce(session, trialEnding(shop.business.id)));
      const sent = test.store.outbox.slice(outboxBefore);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.message.recipientPhone).toBe("+972500000001");
    });

    it("tell a Business nobody owns any more nothing on WhatsApp, and keep the Notice for whoever comes", async () => {
      const shop = await anEstablishedBusiness(test, { plan: "SOLO" });
      test.store.memberships = test.store.memberships.filter((membership) => membership.businessId !== shop.business.id);
      const outboxBefore = test.store.outbox.length;
      const notice = await test.unitOfWork.run({ kind: "SYSTEM" }, (session) => announce(session, trialEnding(shop.business.id)));
      expect(notice?.facts.kind).toBe("TRIAL_ENDING");
      expect(test.store.outbox.length).toBe(outboxBefore);
    });
  });
});
