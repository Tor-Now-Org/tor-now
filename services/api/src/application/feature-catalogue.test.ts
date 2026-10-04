import { beforeEach, describe, expect, it } from "vitest";
import { parseInstant, parseLocalDate, type NoticeKind } from "@tor-now/domain";
import { harness, signIn, type Harness } from "../infrastructure/testing/harness.ts";
import { anEstablishedBusiness } from "../infrastructure/testing/scenarios.ts";
import { isBillingNotice } from "../ports/notifier.ts";
import { NO_FILTER } from "./business-directory.ts";

/**
 * The Features tab and Previews (ADR 0020, ADR 0021). The harness's today is
 * 25 August 2026, and the seeded waiting-list Preview ends 59 days on, on 23 October.
 */
describe("Features and Previews", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  type Shop = Awaited<ReturnType<typeof anEstablishedBusiness>>;
  const anAdministrator = async () => (await signIn(test, "+972500000000", "שקד")).administrator;
  const kindsOf = (shop: Shop): NoticeKind[] =>
    test.store.notices.filter((entry) => entry.notice.businessId === shop.business.id).map((entry) => entry.notice.facts.kind);
  const whatsappKinds = () =>
    test.store.outbox.map((entry) => entry.message).filter(isBillingNotice).map((message) => message.payload.facts.kind);
  const day = parseLocalDate;

  /** A Solo shop and a Team shop, each with its own owner. */
  const twoShops = async () => {
    const solo = await anEstablishedBusiness(test, { plan: "SOLO" });
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
    const team = { ...solo, owner, business: teamBusiness };
    return { solo, team };
  };

  it("says where each Feature is sold and who has it", async () => {
    const { solo } = await twoShops();
    const admin = await anAdministrator();
    await test.services.catalogueAdmin.grantFeatures(admin, solo.business.id, {
      features: ["CUSTOMER_HISTORY"],
      endsOn: day("2026-10-01"),
      reason: "פיילוט",
    });

    const features = await test.services.featureCatalogue.features(admin);
    const history = features.find((view) => view.feature === "CUSTOMER_HISTORY");
    expect(history?.plans).toEqual([
      { plan: "SOLO", number: 1, included: false },
      { plan: "TEAM", number: 1, included: true },
    ]);
    expect(history?.counts).toEqual({ PLAN: 1, ADDON: 0, GRANT: 1, PREVIEW: 0 });
    expect(history?.canSell).toBe(true);
    expect(history?.addon).toBeNull();
    expect(history?.canPreview).toBe(true);
    const waiting = features.find((view) => view.feature === "WAITING_LIST");
    expect(waiting?.preview).toMatchObject({ endsOn: "2026-10-23", placement: null });
    expect(waiting?.counts.PREVIEW).toBe(2);
    expect(waiting?.canPreview).toBe(false);
    expect(features.find((view) => view.feature === "REMINDERS")?.canPreview).toBe(false);
  });

  describe("starting a Preview", () => {
    it("gives the Feature to every Plan that lacks it, and tells only those Businesses", async () => {
      const { solo, team } = await twoShops();

      await test.services.featureCatalogue.startPreview(await anAdministrator(), "CUSTOMER_HISTORY", day("2026-10-24"));

      expect(kindsOf(solo)).toContain("PREVIEW_STARTED");
      expect(kindsOf(team)).not.toContain("PREVIEW_STARTED");
      const record = await test.services.calendar.customerRecord(solo.owner.actor, solo.business.id, solo.owner.user.id).catch(() => null);
      expect(record === null || record.historyIncluded).toBe(true);
      expect(test.store.audit.some((entry) => entry.action === "PREVIEW_STARTED")).toBe(true);
    });

    it("refuses a Feature every Plan has, one in Preview already, and one shorter than thirty days", async () => {
      await twoShops();
      const admin = await anAdministrator();
      await expect(test.services.featureCatalogue.startPreview(admin, "REMINDERS", day("2026-10-24"))).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
      await expect(test.services.featureCatalogue.startPreview(admin, "WAITING_LIST", day("2026-12-24"))).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
      await expect(
        test.services.featureCatalogue.startPreview(admin, "CUSTOMER_HISTORY", day("2026-09-20")),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    });
  });

  it("extends a Preview later, and tells the Businesses it reaches", async () => {
    const { solo } = await twoShops();
    const admin = await anAdministrator();
    const features = await test.services.featureCatalogue.extendPreview(admin, "WAITING_LIST", day("2026-11-22"));
    expect(features.find((view) => view.feature === "WAITING_LIST")?.preview?.endsOn).toBe("2026-11-22");
    expect(kindsOf(solo)).toContain("PREVIEW_EXTENDED");
    await expect(test.services.featureCatalogue.extendPreview(admin, "WAITING_LIST", day("2026-11-01"))).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  describe("deciding where a Preview's Feature goes", () => {
    it("puts it on the Plans that keep it at once, and tells the others ahead, on WhatsApp too", async () => {
      const { solo, team } = await twoShops();
      const admin = await anAdministrator();

      await test.services.featureCatalogue.placePreview(admin, "WAITING_LIST", ["TEAM"]);

      const teamEdition = test.store.planVersions.find((edition) => edition.plan === "TEAM");
      expect(teamEdition?.terms.features).toContain("WAITING_LIST");
      expect(kindsOf(team)).toContain("PREVIEW_KEPT");
      expect(kindsOf(solo)).toContain("PREVIEW_LEAVING");
      expect(whatsappKinds()).toEqual(["PREVIEW_LEAVING"]);
      const leaving = test.store.notices.find((entry) => entry.notice.facts.kind === "PREVIEW_LEAVING");
      expect(leaving?.notice.facts).toEqual({
        kind: "PREVIEW_LEAVING",
        feature: "WAITING_LIST",
        plan: "SOLO",
        endsOn: "2026-10-23",
        addonPriceMinor: null,
      });
    });

    it("moves a nearer end out to thirty days, so the Plans losing it are told in time", async () => {
      await twoShops();
      test.travelTo(parseInstant("2026-10-10T06:00:00.000Z"));
      const features = await test.services.featureCatalogue.placePreview(await anAdministrator(), "WAITING_LIST", []);
      expect(features.find((view) => view.feature === "WAITING_LIST")?.preview?.endsOn).toBe("2026-11-09");
    });

    it("is decided once", async () => {
      await twoShops();
      const admin = await anAdministrator();
      await test.services.featureCatalogue.placePreview(admin, "WAITING_LIST", ["TEAM"]);
      await expect(test.services.featureCatalogue.placePreview(admin, "WAITING_LIST", ["SOLO", "TEAM"])).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });

    it("reminds the Businesses losing it a week before it ends", async () => {
      const { solo } = await twoShops();
      await test.services.featureCatalogue.placePreview(await anAdministrator(), "WAITING_LIST", ["TEAM"]);
      test.travelTo(parseInstant("2026-10-15T06:00:00.000Z"));
      await test.services.admin.announceDueNotices({ kind: "SYSTEM" });
      expect(kindsOf(solo)).not.toContain("PREVIEW_ENDING");
      test.travelTo(parseInstant("2026-10-16T06:00:00.000Z"));
      await test.services.admin.announceDueNotices({ kind: "SYSTEM" });
      expect(kindsOf(solo)).toContain("PREVIEW_ENDING");
    });
  });

  it("carries an undecided Preview on before its end comes close, and a decided one not", async () => {
    await twoShops();
    test.travelTo(parseInstant("2026-09-23T06:00:00.000Z"));
    expect(await test.services.featureCatalogue.stretchUndecidedPreviews({ kind: "SYSTEM" })).toEqual([]);
    test.travelTo(parseInstant("2026-09-24T06:00:00.000Z"));
    expect(await test.services.featureCatalogue.stretchUndecidedPreviews({ kind: "SYSTEM" })).toEqual(["WAITING_LIST"]);
    expect(test.store.previews.find((preview) => preview.feature === "WAITING_LIST")?.endsOn).toBe("2026-11-22");
  });

  it("filters the Businesses by a Feature and where it comes from", async () => {
    const { solo } = await twoShops();
    const admin = await anAdministrator();
    await test.services.catalogueAdmin.grantFeatures(admin, solo.business.id, {
      features: ["CUSTOMER_HISTORY"],
      endsOn: day("2026-10-01"),
      reason: "פיילוט",
    });

    const granted = await test.services.admin.listBusinesses(admin, {
      ...NO_FILTER,
      feature: "CUSTOMER_HISTORY",
      featureSource: "GRANT",
    });
    expect(granted.rows.map((row) => row.business.id)).toEqual([solo.business.id]);
    expect(granted.counts.featureSources).toEqual({ ANY: 2, PLAN: 1, ADDON: 0, GRANT: 1, PREVIEW: 0 });
    expect(granted.counts.features.WAITING_LIST).toBe(2);
  });

  it("is the administrators' alone", async () => {
    const owner = await signIn(test, "+972500000001");
    await expect(test.services.featureCatalogue.features(owner.actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
