import { beforeEach, describe, expect, it } from "vitest";
import { addDays, asId, microShekels, parseInstant, parseLocalDate, type NoticeKind } from "@tor-now/domain";
import { harness, signIn, type Harness } from "../infrastructure/testing/harness.ts";
import { anEstablishedBusiness } from "../infrastructure/testing/scenarios.ts";

/**
 * The Catalogue editor's first part (ADR 0021, ADR 0022): correcting what a
 * unit of messaging cost, and giving a Business Features beyond its Plan.
 * The harness's today is 25 August 2026.
 */
describe("the Catalogue editor: rates and Grants", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  type Shop = Awaited<ReturnType<typeof anEstablishedBusiness>>;
  const anAdministrator = async () => (await signIn(test, "+972500000000", "שקד")).administrator;
  const aSoloShop = () => anEstablishedBusiness(test, { plan: "SOLO" });
  const endsOn = parseLocalDate("2026-11-23");

  const noticeKinds = (shop: Shop): NoticeKind[] =>
    test.store.notices
      .filter((entry) => entry.notice.businessId === shop.business.id)
      .map((entry) => entry.notice.facts.kind);

  describe("rates", () => {
    const correction = {
      unit: "WHATSAPP_UTILITY" as const,
      effectiveFrom: parseLocalDate("2026-08-01"),
      perUnit: microShekels(20_300),
      source: "  חשבונית Twilio לאוגוסט  ",
    };

    it("takes a correction from a past day, says who checked it, and audits it", async () => {
      const admin = await anAdministrator();

      const rates = await test.services.catalogueAdmin.setRate(admin, correction);

      expect(rates.find((rate) => rate.unit === "WHATSAPP_UTILITY" && rate.effectiveFrom === "2026-08-01")).toMatchObject({
        perUnit: 20_300,
        source: "חשבונית Twilio לאוגוסט",
        checkedBy: "שקד",
      });
      expect(test.store.audit.some((entry) => entry.action === "UNIT_RATE_SET")).toBe(true);
    });

    it("is the administrators' alone", async () => {
      const owner = await signIn(test, "+972500000001");
      await expect(test.services.catalogueAdmin.rates(owner.actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(test.services.catalogueAdmin.setRate(owner.actor, correction)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("refuses a figure with no source", async () => {
      await expect(
        test.services.catalogueAdmin.setRate(await anAdministrator(), { ...correction, source: " " }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    });
  });

  describe("Grants", () => {
    it("gives several Features at once, each its own Grant, and tells the owner once", async () => {
      const shop = await aSoloShop();
      const admin = await anAdministrator();

      const features = await test.services.catalogueAdmin.grantFeatures(admin, shop.business.id, {
        features: ["TEAM_ROLES", "CUSTOMER_HISTORY"],
        endsOn,
        reason: "פיילוט",
      });

      expect(features.map(({ feature, source }) => [feature, source])).toEqual([
        ["REMINDERS", "PLAN"],
        ["CUSTOMER_HISTORY", "GRANT"],
        ["TEAM_ROLES", "GRANT"],
        ["WAITING_LIST", "PREVIEW"],
      ]);
      expect(features[1]?.grant).toMatchObject({ reason: "פיילוט", grantedByName: "שקד", endsOn });
      expect(test.store.grants).toHaveLength(2);
      expect(test.store.audit.filter((entry) => entry.action === "GRANT_GIVEN")).toHaveLength(2);
      expect(noticeKinds(shop)).toContain("FEATURES_GRANTED");
      const told = test.store.notices.find((entry) => entry.notice.facts.kind === "FEATURES_GRANTED");
      expect(told?.notice.facts).toEqual({ kind: "FEATURES_GRANTED", features: ["CUSTOMER_HISTORY", "TEAM_ROLES"], endsOn });
      // Nothing about a Grant goes to WhatsApp.
      expect(test.store.outbox).toEqual([]);
    });

    it("lets the owner use what was granted", async () => {
      const shop = await aSoloShop();
      await test.services.catalogueAdmin.grantFeatures(await anAdministrator(), shop.business.id, {
        features: ["TEAM_ROLES"],
        endsOn,
        reason: "פיילוט",
      });

      await expect(
        test.services.business.inviteUser(shop.owner.actor, shop.business.id, {
          phone: "+972500000044",
          givenName: "מנהלת",
          role: "MANAGER",
          resourceIds: [],
        }),
      ).resolves.toBeDefined();
    });

    it("refuses what the Business already has, and anything past a year", async () => {
      const shop = await aSoloShop();
      const admin = await anAdministrator();
      await expect(
        test.services.catalogueAdmin.grantFeatures(admin, shop.business.id, {
          features: ["REMINDERS"],
          endsOn,
          reason: "פיילוט",
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { features: ["REMINDERS"] } });
      await expect(
        test.services.catalogueAdmin.grantFeatures(admin, shop.business.id, {
          features: ["TEAM_ROLES"],
          endsOn: parseLocalDate("2027-08-26"),
          reason: "פיילוט",
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      expect(test.store.grants).toEqual([]);
    });

    it("extends one Grant, leaving the others, and ends the reminder of it", async () => {
      const shop = await aSoloShop();
      const admin = await anAdministrator();
      const given = await test.services.catalogueAdmin.grantFeatures(admin, shop.business.id, {
        features: ["TEAM_ROLES", "CUSTOMER_HISTORY"],
        endsOn: parseLocalDate("2026-09-01"),
        reason: "פיילוט",
      });
      await test.services.admin.announceDueNotices({ kind: "SYSTEM" });
      expect(noticeKinds(shop)).toContain("GRANT_ENDING");
      const teamRoles = given.find((source) => source.feature === "TEAM_ROLES")?.grant;
      if (teamRoles === null || teamRoles === undefined) throw new Error("Not granted");

      const features = await test.services.catalogueAdmin.extendGrant(admin, shop.business.id, teamRoles.id, {
        endsOn: parseLocalDate("2026-10-01"),
        reason: "עוד חודש",
      });

      expect(features.find((source) => source.feature === "TEAM_ROLES")).toMatchObject({ endsOn: "2026-10-01" });
      expect(features.find((source) => source.feature === "CUSTOMER_HISTORY")).toMatchObject({ endsOn: "2026-09-01" });
      expect(noticeKinds(shop)).toContain("GRANT_EXTENDED");
      const reminder = test.store.notices.find((entry) => entry.notice.facts.kind === "GRANT_ENDING");
      expect(reminder?.notice.clearedAt).not.toBeNull();
    });

    it("ends a Grant now: new use stops, and the owner is told", async () => {
      const shop = await aSoloShop();
      const admin = await anAdministrator();
      const given = await test.services.catalogueAdmin.grantFeatures(admin, shop.business.id, {
        features: ["TEAM_ROLES"],
        endsOn,
        reason: "פיילוט",
      });
      const grant = given.find((source) => source.feature === "TEAM_ROLES")?.grant;
      if (grant === null || grant === undefined) throw new Error("Not granted");

      const features = await test.services.catalogueAdmin.endGrant(admin, shop.business.id, grant.id);

      expect(features.find((source) => source.feature === "TEAM_ROLES")?.source).toBe("NONE");
      expect(test.store.grants[0]?.endsOn).toBe("2026-08-24");
      expect(noticeKinds(shop)).toContain("GRANT_ENDED");
      await expect(
        test.services.business.inviteUser(shop.owner.actor, shop.business.id, {
          phone: "+972500000045",
          givenName: "עובד",
          role: "WORKER",
          resourceIds: [],
        }),
      ).rejects.toMatchObject({ code: "NOT_ENTITLED" });
      // Ending it twice is refused: it has already ended.
      await expect(test.services.catalogueAdmin.endGrant(admin, shop.business.id, grant.id)).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
    });

    it("refuses a Grant that is not this Business's", async () => {
      const shop = await aSoloShop();
      await expect(
        test.services.catalogueAdmin.endGrant(
          await anAdministrator(),
          shop.business.id,
          asId("00000000-0000-4000-8000-000000000999"),
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("reminds the owner a week before Grants end, once for everything ending that day", async () => {
      const shop = await aSoloShop();
      await test.services.catalogueAdmin.grantFeatures(await anAdministrator(), shop.business.id, {
        features: ["TEAM_ROLES", "CUSTOMER_HISTORY"],
        endsOn,
        reason: "פיילוט",
      });

      test.travelTo(parseInstant(`${addDays(endsOn, -8)}T06:00:00.000Z`));
      await test.services.admin.announceDueNotices({ kind: "SYSTEM" });
      expect(noticeKinds(shop)).not.toContain("GRANT_ENDING");
      test.travelTo(parseInstant(`${addDays(endsOn, -7)}T06:00:00.000Z`));
      await test.services.admin.announceDueNotices({ kind: "SYSTEM" });
      await test.services.admin.announceDueNotices({ kind: "SYSTEM" });

      const reminders = test.store.notices.filter((entry) => entry.notice.facts.kind === "GRANT_ENDING");
      expect(reminders.map((entry) => entry.notice.facts)).toEqual([
        { kind: "GRANT_ENDING", features: ["CUSTOMER_HISTORY", "TEAM_ROLES"], endsOn },
      ]);
    });

    it("shows the administrator each Grant's reason, and the owner only its day", async () => {
      const shop = await aSoloShop();
      const admin = await anAdministrator();
      await test.services.catalogueAdmin.grantFeatures(admin, shop.business.id, {
        features: ["TEAM_ROLES"],
        endsOn,
        reason: "הטרדות חוזרות",
      });

      const forAdmin = await test.services.admin.subscriptionFor(admin, shop.business.id);
      const roles = forAdmin.features.find((source) => source.feature === "TEAM_ROLES");
      expect(roles?.grant).toMatchObject({ reason: "הטרדות חוזרות" });

      const forOwner = await test.services.business.subscription(shop.owner.actor, shop.business.id);
      const owned = forOwner.features.find((source) => source.feature === "TEAM_ROLES");
      expect(owned).toMatchObject({ source: "GRANT", endsOn });
      expect(owned?.grant).not.toHaveProperty("reason");
    });
  });
});
