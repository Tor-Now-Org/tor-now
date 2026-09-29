import { beforeEach, describe, expect, it } from "vitest";
import { asId, parseInstant } from "@tor-now/domain";
import {
  anAdministrator,
  aShop,
  AUTHENTICATION,
  costHarness,
  holding,
  IN_SEPTEMBER,
  paidThrough,
  sent,
  SMS_PART,
  WHATSAPP,
} from "../infrastructure/testing/cost-fixtures.ts";
import { signIn, type Harness } from "../infrastructure/testing/harness.ts";

/**
 * Fair Use (ADR 0023): who is over a limit is read from this month's usage
 * whenever an administrator looks. Nothing is stored about it. Today is
 * 20 September 2026, 09:00 UTC — 12:00 in Israel.
 */
describe("Fair Use", () => {
  let test: Harness;

  beforeEach(() => {
    test = costHarness();
  });

  const shops = async () => {
    const noa = await aShop(test, "סטודיו נועה", "TEAM");
    const ran = await aShop(test, "מספרת רן", "SOLO");
    const fresh = await aShop(test, "חדשים", "TEAM");
    paidThrough(test, noa.business.id, "2026-10-10");
    paidThrough(test, ran.business.id, "2026-10-10");
    // Waiting list: Noa ₪28.58 and a Trial ₪11.43 — both over ₪10; Ran ₪0.20.
    sent(test, noa.business.id, "WAITING_LIST", "SMS_SEGMENT", IN_SEPTEMBER, 15, 2);
    sent(test, fresh.business.id, "WAITING_LIST", "SMS_SEGMENT", IN_SEPTEMBER, 6, 2);
    sent(test, ran.business.id, "WAITING_LIST", "WHATSAPP_UTILITY", IN_SEPTEMBER, 10);
    sent(test, ran.business.id, "BOOKING", "WHATSAPP_UTILITY", IN_SEPTEMBER, 200);
    return { noa, ran, fresh };
  };

  describe("the view", () => {
    it("reads each cause against its limit: the highest this month, and everyone over, the most first", async () => {
      const { noa, ran, fresh } = await shops();
      const view = await test.services.fairUse.fairUse(await anAdministrator(test));

      expect(view.span).toEqual({ first: "2026-09-01", through: "2026-09-20", current: true });
      const [booking, reminders, waiting] = view.sources;
      expect(booking).toEqual({
        source: "BOOKING",
        limit: 12_000,
        top: { businessId: ran.business.id, name: "מספרת רן", cost: 200 * WHATSAPP },
        over: [],
      });
      expect(reminders).toEqual({ source: "REMINDERS", limit: 10_000, top: null, over: [] });
      expect(waiting?.top).toEqual({ businessId: noa.business.id, name: "סטודיו נועה", cost: 30 * SMS_PART });
      expect(waiting?.over).toEqual([
        { businessId: noa.business.id, name: "סטודיו נועה", plan: "TEAM", cost: 30 * SMS_PART, whatsapp: 0, smsMessages: 15 },
        // A Trial can run up a bill as well as a paying Business.
        { businessId: fresh.business.id, name: "חדשים", plan: "TEAM", cost: 12 * SMS_PART, whatsapp: 0, smsMessages: 6 },
      ]);
    });

    it("counts today's sign-in codes, Israel's day, against the daily limit, beside the thirty days before", async () => {
      // 20 September starts at 21:00 UTC on the 19th in Israel.
      sent(test, null, "SIGN_IN", "WHATSAPP_AUTHENTICATION", "2026-09-19T20:59:00.000Z", 60);
      sent(test, null, "SIGN_IN", "WHATSAPP_AUTHENTICATION", "2026-09-19T21:00:00.000Z", 301);
      sent(test, null, "SIGN_IN", "SMS_SEGMENT", "2026-09-20T08:00:00.000Z", 1);
      const view = await test.services.fairUse.fairUse(await anAdministrator(test));
      expect(view.signIn).toEqual({
        today: 302,
        cost: 301 * AUTHENTICATION + SMS_PART,
        limit: 300,
        over: true,
        averagePerDay: 2,
      });
    });

    it("is not over at the limit itself", async () => {
      sent(test, null, "SIGN_IN", "WHATSAPP_AUTHENTICATION", "2026-09-20T08:00:00.000Z", 300);
      expect((await test.services.fairUse.fairUse(await anAdministrator(test))).signIn.over).toBe(false);
    });
  });

  describe("the alerts, for the banner", () => {
    it("counts each Business over any limit once, says which causes, and whether codes are over today", async () => {
      const { noa } = await shops();
      sent(test, noa.business.id, "BOOKING", "SMS_SEGMENT", IN_SEPTEMBER, 70, 2);
      sent(test, null, "SIGN_IN", "WHATSAPP_AUTHENTICATION", "2026-09-20T08:00:00.000Z", 12);
      const alerts = await test.services.fairUse.alerts(await anAdministrator(test));
      expect(alerts).toEqual({
        businessesOver: 2,
        sourcesOver: ["BOOKING", "WAITING_LIST"],
        signIn: { today: 12, limit: 300, over: false },
      });
    });

    it("has nothing to say when nothing is over", async () => {
      await aShop(test, "שקט", "SOLO");
      expect(await test.services.fairUse.alerts(await anAdministrator(test))).toEqual({
        businessesOver: 0,
        sourcesOver: [],
        signIn: { today: 0, limit: 300, over: false },
      });
    });
  });

  describe("worked out when looked at, never stored", () => {
    it("moves who is over the moment a limit changes, either way, and audits the change", async () => {
      const { ran } = await shops();
      const admin = await anAdministrator(test);

      const lowered = await test.services.fairUse.setBusinessLimit(admin, "BOOKING", 100);
      expect(lowered.sources[0]?.over.map((one) => one.businessId)).toEqual([ran.business.id]);
      expect(lowered.limits.perBusiness.BOOKING).toBe(100);

      const raised = await test.services.fairUse.setBusinessLimit(admin, "WAITING_LIST", 100_000);
      expect(raised.sources[2]?.over).toEqual([]);

      const audited = test.store.audit.filter((entry) => entry.action === "FAIR_USE_LIMIT_SET");
      expect(audited.map((entry) => entry.entityId)).toEqual(["BOOKING", "WAITING_LIST"]);
    });

    it("starts a new month clean with nothing written: October has no one over", async () => {
      await shops();
      const admin = await anAdministrator(test);
      expect((await test.services.fairUse.alerts(admin)).businessesOver).toBe(2);
      const auditBefore = test.store.audit.length;

      test.travelTo(parseInstant("2026-10-01T09:00:00.000Z"));

      expect(await test.services.fairUse.alerts(admin)).toMatchObject({ businessesOver: 0, sourcesOver: [] });
      expect(test.store.audit.length).toBe(auditBefore);
    });

    it("changes the daily sign-in limit, and the reading with it", async () => {
      sent(test, null, "SIGN_IN", "WHATSAPP_AUTHENTICATION", "2026-09-20T08:00:00.000Z", 50);
      const view = await test.services.fairUse.setSignInLimit(await anAdministrator(test), 40);
      expect(view.signIn).toMatchObject({ today: 50, limit: 40, over: true });
      expect(test.store.audit.find((entry) => entry.action === "FAIR_USE_LIMIT_SET")?.entityId).toBe("SIGN_IN");
    });

    it("refuses a limit that is not a whole number above zero", async () => {
      const admin = await anAdministrator(test);
      await expect(test.services.fairUse.setBusinessLimit(admin, "BOOKING", 0)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      await expect(test.services.fairUse.setBusinessLimit(admin, "BOOKING", 10.5)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      await expect(test.services.fairUse.setSignInLimit(admin, 0)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      expect(test.store.audit.some((entry) => entry.action === "FAIR_USE_LIMIT_SET")).toBe(false);
    });
  });

  describe("a Business's usage this month", () => {
    it("reads each cause against its limit, with its messages, total and what it pays", async () => {
      const { noa } = await shops();
      holding(test, noa.business.id, "WAITING_LIST", 1_900, "2026-09-01");
      const usage = await test.services.fairUse.businessUsage(await anAdministrator(test), noa.business.id);
      expect(usage).toEqual({
        span: { first: "2026-09-01", through: "2026-09-20", current: true },
        readings: [
          { source: "BOOKING", limit: 12_000, cost: 0, over: false },
          { source: "REMINDERS", limit: 10_000, cost: 0, over: false },
          { source: "WAITING_LIST", limit: 1_000, cost: 30 * SMS_PART, over: true },
        ],
        whatsapp: 0,
        smsMessages: 15,
        total: 30 * SMS_PART,
        unpricedUnits: 0,
        monthlyPrice: 8_900 + 1_900,
      });
    });

    it("reads a Business that sent nothing as nothing", async () => {
      const { business } = await aShop(test, "שקט", "SOLO");
      const usage = await test.services.fairUse.businessUsage(await anAdministrator(test), business.id);
      expect(usage).toMatchObject({ total: 0, whatsapp: 0, smsMessages: 0 });
      expect(usage.readings.every((reading) => !reading.over)).toBe(true);
    });

    it("says a Business that does not exist is not found", async () => {
      await expect(
        test.services.fairUse.businessUsage(await anAdministrator(test), asId("missing")),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  it("is the administrators' alone", async () => {
    const { business } = await aShop(test, "שקט", "SOLO");
    const owner = (await signIn(test, "+972500000009")).actor;
    await expect(test.services.fairUse.fairUse(owner)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(test.services.fairUse.alerts(owner)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(test.services.fairUse.setBusinessLimit(owner, "BOOKING", 1)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(test.services.fairUse.setSignInLimit(owner, 1)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(test.services.fairUse.businessUsage(owner, business.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
