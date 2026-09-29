import { beforeEach, describe, expect, it } from "vitest";
import { asId, money, parseLocalDate, type CalculatorUse } from "@tor-now/domain";
import {
  AGORA,
  anAdministrator,
  aShop,
  costHarness,
  IN_SEPTEMBER,
  paidThrough,
  sent,
} from "../infrastructure/testing/cost-fixtures.ts";
import { signIn, type Harness } from "../infrastructure/testing/harness.ts";

/**
 * The Cost Calculator's basis and its saved Businesses (ADR 0023). The
 * measured examples look back thirty days from 20 September 2026.
 */
describe("the Cost Calculator", () => {
  let test: Harness;

  beforeEach(() => {
    test = costHarness();
  });

  const use = (calendars: number, booking: number): CalculatorUse => ({
    calendars,
    BOOKING: { whatsapp: booking, sms: 1 },
    REMINDERS: { whatsapp: 0, sms: 0 },
    WAITING_LIST: { whatsapp: 0, sms: 0 },
    BILLING: { whatsapp: 2, sms: 0 },
  });

  describe("what it starts from", () => {
    it("prices by today's rates and the current Plans, with SMS parts measured from what was sent", async () => {
      const ran = await aShop(test, "מספרת רן", "SOLO");
      paidThrough(test, ran.business.id, "2026-10-10");
      // Seven parts over three messages: 2.3 a message.
      sent(test, ran.business.id, "BOOKING", "SMS_SEGMENT", IN_SEPTEMBER, 2, 2);
      sent(test, ran.business.id, "BOOKING", "SMS_SEGMENT", IN_SEPTEMBER, 1, 3);

      const basis = await test.services.costs.calculator(await anAdministrator(test));

      expect(basis.rates).toEqual({ whatsapp: 19_610, smsPart: 952_750, partsPerSms: 2.3 });
      expect(basis.plans).toEqual([
        { plan: "SOLO", price: 4_900, allowance: 1 },
        { plan: "TEAM", price: 8_900, allowance: 5 },
      ]);
      expect(basis.saved.map((saved) => saved.name)).toEqual(["בינוני", "עמוס"]);
    });

    it("averages the paying Businesses only, and names the one that cost the most", async () => {
      const ran = await aShop(test, "מספרת רן", "SOLO");
      const noa = await aShop(test, "סטודיו נועה", "TEAM");
      const fresh = await aShop(test, "חדשים", "TEAM");
      paidThrough(test, ran.business.id, "2026-10-10");
      paidThrough(test, noa.business.id, "2026-10-10");
      sent(test, ran.business.id, "BOOKING", "WHATSAPP_UTILITY", IN_SEPTEMBER, 100);
      sent(test, noa.business.id, "BOOKING", "WHATSAPP_UTILITY", IN_SEPTEMBER, 301);
      sent(test, noa.business.id, "WAITING_LIST", "SMS_SEGMENT", IN_SEPTEMBER, 4, 2);
      // A Trial's usage is no paying Business's average.
      sent(test, fresh.business.id, "BOOKING", "WHATSAPP_UTILITY", IN_SEPTEMBER, 10_000);

      const basis = await test.services.costs.calculator(await anAdministrator(test));

      expect(basis.actualAverage).toEqual({
        over: 2,
        business: null,
        use: {
          calendars: 1,
          BOOKING: { whatsapp: 201, sms: 0 },
          REMINDERS: { whatsapp: 0, sms: 0 },
          WAITING_LIST: { whatsapp: 0, sms: 2 },
          BILLING: { whatsapp: 0, sms: 0 },
        },
      });
      expect(basis.mostExpensive).toMatchObject({
        over: 1,
        business: { id: noa.business.id, name: "סטודיו נועה" },
        use: { BOOKING: { whatsapp: 301, sms: 0 }, WAITING_LIST: { whatsapp: 0, sms: 4 } },
      });
    });

    it("looks back thirty days, not before", async () => {
      const ran = await aShop(test, "מספרת רן", "SOLO");
      paidThrough(test, ran.business.id, "2026-10-10");
      test.store.unitRates = test.store.unitRates.map((rate) => ({ ...rate, effectiveFrom: parseLocalDate("2026-08-01") }));
      // Thirty of Israel's days back from 20 September start at midnight on 22 August — 21:00 UTC the day before.
      sent(test, ran.business.id, "BOOKING", "WHATSAPP_UTILITY", "2026-08-21T20:59:00.000Z", 50);
      sent(test, ran.business.id, "BOOKING", "WHATSAPP_UTILITY", "2026-08-21T21:00:00.000Z", 5);
      const basis = await test.services.costs.calculator(await anAdministrator(test));
      expect(basis.actualAverage?.use.BOOKING.whatsapp).toBe(5);
    });

    it("has no measured examples and no share when nobody pays", async () => {
      await aShop(test, "חדשים", "TEAM");
      const basis = await test.services.costs.calculator(await anAdministrator(test));
      expect(basis.actualAverage).toBeNull();
      expect(basis.mostExpensive).toBeNull();
      expect(basis.share).toBeNull();
      expect(basis.rates.partsPerSms).toBe(2);
    });

    it("names no most expensive when every paying Business cost nothing", async () => {
      const ran = await aShop(test, "מספרת רן", "SOLO");
      paidThrough(test, ran.business.id, "2026-10-10");
      const basis = await test.services.costs.calculator(await anAdministrator(test));
      expect(basis.mostExpensive).toBeNull();
      expect(basis.actualAverage?.over).toBe(1);
    });

    it("says there is no rate rather than pricing at zero in silence", async () => {
      test.store.unitRates = test.store.unitRates.filter((rate) => rate.unit === "SMS_SEGMENT");
      const basis = await test.services.costs.calculator(await anAdministrator(test));
      expect(basis.rates.whatsapp).toBeNull();
      expect(basis.rates.smsPart).toBe(952_750);
    });

    it("shares this month's Platform Cost over the paying Businesses", async () => {
      const ran = await aShop(test, "מספרת רן", "SOLO");
      paidThrough(test, ran.business.id, "2026-10-10");
      const admin = await anAdministrator(test);
      await test.services.costs.addRunningCost(admin, {
        name: "Vercel",
        amount: { effectiveFrom: parseLocalDate("2026-09-01"), amount: money(7_400), source: "invoice August" },
      });
      expect((await test.services.costs.calculator(admin)).share).toBe(7_400 * AGORA);
    });

    it("is the administrators' alone", async () => {
      const owner = await signIn(test, "+972500000009");
      await expect(test.services.costs.calculator(owner.actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("saved Businesses", () => {
    it("saves one under a trimmed name, dated today, and audits it", async () => {
      const admin = await anAdministrator(test);
      const saved = await test.services.costs.saveReference(admin, { name: "  מספרה עם 3 כיסאות ", use: use(3, 500) });
      expect(saved.map((one) => one.name)).toEqual(["בינוני", "עמוס", "מספרה עם 3 כיסאות"]);
      expect(saved[2]).toMatchObject({ use: use(3, 500), savedOn: "2026-09-20" });
      expect(test.store.audit.some((entry) => entry.action === "REFERENCE_BUSINESS_SAVED")).toBe(true);
    });

    it("updates one's numbers, keeping its name, and audits the before and after", async () => {
      const admin = await anAdministrator(test);
      const [medium] = await test.services.costs.saveReference(admin, { name: "זמני", use: use(1, 1) });
      const updated = await test.services.costs.updateReference(admin, medium?.id ?? asId(""), { use: use(2, 777) });
      expect(updated[0]).toMatchObject({ name: "בינוני", use: use(2, 777) });
      const entry = test.store.audit.find((one) => one.action === "REFERENCE_BUSINESS_UPDATED");
      expect(entry).toMatchObject({ entityType: "ReferenceBusiness", entityId: medium?.id });
      expect(entry?.before).toMatchObject({ use: { calendars: 1 } });
    });

    it("renames one, lets it keep its own name in another case, and refuses another's", async () => {
      const admin = await anAdministrator(test);
      const [medium, busy] = await test.services.costs.calculator(admin).then((basis) => basis.saved);
      const renamed = await test.services.costs.renameReference(admin, busy?.id ?? asId(""), { name: " Busy salon " });
      expect(renamed[1]?.name).toBe("Busy salon");
      expect((await test.services.costs.renameReference(admin, busy?.id ?? asId(""), { name: "busy SALON" }))[1]?.name).toBe(
        "busy SALON",
      );
      await expect(
        test.services.costs.renameReference(admin, medium?.id ?? asId(""), { name: "BUSY salon" }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { field: "name" } });
      expect(test.store.audit.filter((entry) => entry.action === "REFERENCE_BUSINESS_RENAMED")).toHaveLength(2);
    });

    it("deletes one, and says one that is gone is not found", async () => {
      const admin = await anAdministrator(test);
      const [, busy] = (await test.services.costs.calculator(admin)).saved;
      expect((await test.services.costs.deleteReference(admin, busy?.id ?? asId(""))).map((one) => one.name)).toEqual([
        "בינוני",
      ]);
      expect(test.store.audit.some((entry) => entry.action === "REFERENCE_BUSINESS_DELETED")).toBe(true);
      await expect(test.services.costs.deleteReference(admin, busy?.id ?? asId(""))).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("refuses a name another has, a name too short or too long, and a ninth", async () => {
      const admin = await anAdministrator(test);
      await expect(test.services.costs.saveReference(admin, { name: "עמוס", use: use(1, 1) })).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
      await expect(test.services.costs.saveReference(admin, { name: " א ", use: use(1, 1) })).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
      await expect(test.services.costs.saveReference(admin, { name: "x".repeat(31), use: use(1, 1) })).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
      for (let at = 0; at < 6; at += 1) {
        await test.services.costs.saveReference(admin, { name: `דוגמה ${at}`, use: use(1, at) });
      }
      await expect(test.services.costs.saveReference(admin, { name: "התשיעית", use: use(1, 1) })).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
      expect((await test.services.costs.calculator(admin)).saved).toHaveLength(8);
    });

    it("refuses numbers that are not whole counts, and no calendar", async () => {
      const admin = await anAdministrator(test);
      await expect(test.services.costs.saveReference(admin, { name: "שבור", use: use(0, 1) })).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
      const [medium] = (await test.services.costs.calculator(admin)).saved;
      await expect(
        test.services.costs.updateReference(admin, medium?.id ?? asId(""), { use: use(1, -1) }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    });

    it("is the administrators' alone, for every change", async () => {
      const owner = (await signIn(test, "+972500000009")).actor;
      const any = asId<"ReferenceBusiness">("x");
      await expect(test.services.costs.saveReference(owner, { name: "שלי", use: use(1, 1) })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(test.services.costs.updateReference(owner, any, { use: use(1, 1) })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(test.services.costs.renameReference(owner, any, { name: "שלי" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(test.services.costs.deleteReference(owner, any)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});
