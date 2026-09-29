import { beforeEach, describe, expect, it } from "vitest";
import { parseInstant } from "@tor-now/domain";
import {
  A_BUSINESS,
  httpHarness,
  signInAsAdministratorOverHttp,
  signInOverHttp,
  type HttpHarness,
} from "../infrastructure/testing/http-harness.ts";

/**
 * A Business's billing over HTTP (ADRs 0019–0021): payments recorded, the
 * administrator's billing panel, Plans changed with the calendars that stay,
 * and the Days Owed on the wire. The harness's today is 25 August 2026; a new
 * Business's Trial ends on 23 September.
 */

const MISSING = "00000000-0000-4000-8000-000000000999";

type Billing = {
  payments: { id: string }[];
  addons: { feature: string }[];
  nextPayment: { on: string; totalMinor: number; lines: unknown[] };
  moveUpOwed: unknown[];
};
type Resource = { id: string; paused: boolean };

describe("billing over HTTP", () => {
  let api: HttpHarness;
  let owner: string;
  let admin: string;
  let businessId: string;

  const travelTo = (day: string) => api.travelTo(parseInstant(`${day}T06:00:00.000Z`));
  const pay = (paidOn: string, amountMinor = 4_900) =>
    api.post(`/admin/businesses/${businessId}/payments`, { amountMinor, paidOn, note: null }, admin);
  const billing = async () => (await api.get(`/businesses/${businessId}/subscription`, owner)).body as Billing;

  const open = async (plan: "SOLO" | "TEAM", resourceNames: string[] = ["רן"]) => {
    owner = (await signInOverHttp(api, "+972500000001", "רן")).token;
    const created = await api.post("/businesses", { ...A_BUSINESS, plan, resourceNames }, owner);
    businessId = (created.body as { id: string }).id;
  };

  beforeEach(async () => {
    api = httpHarness();
    admin = (await signInAsAdministratorOverHttp(api, "+972500000000")).token;
  });

  describe("a payment", () => {
    beforeEach(() => open("SOLO"));

    it("is recorded by an administrator, and puts the Business in good standing to the end of the month it pays for", async () => {
      const { status, body } = await api.post(
        `/admin/businesses/${businessId}/payments`,
        { amountMinor: 4_900, paidOn: "2026-08-25", note: "  העברה בנקאית  " },
        admin,
      );
      expect(status).toBe(201);
      expect(body).toEqual({
        id: expect.any(String),
        businessId,
        amountMinor: 4_900,
        amount: 49,
        paidOn: "2026-08-25",
        note: "העברה בנקאית",
        recordedAt: expect.any(String),
      });
      const after = (await api.get(`/businesses/${businessId}/subscription`, owner)).body;
      expect(after).toMatchObject({ status: "PAID", payments: [{ id: (body as { id: string }).id }] });
    });

    it("takes no note as none at all", async () => {
      const { status, body } = await api.post(
        `/admin/businesses/${businessId}/payments`,
        { amountMinor: 4_900, paidOn: "2026-08-25" },
        admin,
      );
      expect(status).toBe(201);
      expect(body).toMatchObject({ note: null });
    });

    it("refuses an amount that is no amount, a day that is no day, and a note too long to keep", async () => {
      const wrong = [
        { amountMinor: 0, paidOn: "2026-08-25" },
        { amountMinor: -4_900, paidOn: "2026-08-25" },
        { amountMinor: 49.5, paidOn: "2026-08-25" },
        { amountMinor: 4_900, paidOn: "2026-02-30" },
        { amountMinor: 4_900, paidOn: "25/08/2026" },
        { amountMinor: 4_900, paidOn: "2026-08-25", note: "x".repeat(201) },
        { paidOn: "2026-08-25" },
      ];
      for (const body of wrong) {
        const refused = await api.post(`/admin/businesses/${businessId}/payments`, body, admin);
        expect(refused.status).toBe(400);
        expect(refused.body).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
      }
      expect((await billing()).payments).toEqual([]);
    });

    it("is an administrator's to record, for a Business that exists", async () => {
      const body = { amountMinor: 4_900, paidOn: "2026-08-25", note: null };
      expect((await api.post(`/admin/businesses/${businessId}/payments`, body, owner)).status).toBe(403);
      expect((await api.post(`/admin/businesses/${businessId}/payments`, body)).status).toBe(403);
      expect((await api.post(`/admin/businesses/${MISSING}/payments`, body, admin)).status).toBe(404);
      expect((await api.post("/admin/businesses/not-an-id/payments", body, admin)).status).toBe(400);
    });
  });

  describe("the administrator's billing panel", () => {
    beforeEach(() => open("SOLO"));

    it("shows the owner's own panel, payments and what the next one comes to included", async () => {
      await pay("2026-08-25");
      const { status, body } = await api.get(`/admin/businesses/${businessId}/subscription`, admin);
      expect(status).toBe(200);
      const theirs = (await api.get(`/businesses/${businessId}/subscription`, owner)).body as Record<string, unknown>;
      expect(body).toMatchObject({
        subscription: { plan: "SOLO" },
        status: "PAID",
        payments: [{ amountMinor: 4_900, paidOn: "2026-08-25" }],
        nextPayment: { on: "2026-10-24", totalMinor: 4_900, lines: [{ kind: "PLAN", plan: "SOLO", amountMinor: 4_900 }] },
        moveUpOwed: [],
      });
      // The same figures the owner sees, never a second reckoning.
      for (const part of ["subscription", "payments", "status", "nextDate", "addons", "nextPayment", "moveUpOwed"]) {
        expect((body as Record<string, unknown>)[part]).toEqual(theirs[part]);
      }
    });

    it("is closed to the owner, and says a Business that does not exist is not found", async () => {
      expect((await api.get(`/admin/businesses/${businessId}/subscription`, owner)).status).toBe(403);
      expect((await api.get(`/admin/businesses/${MISSING}/subscription`, admin)).status).toBe(404);
      expect((await api.get("/admin/businesses/not-an-id/subscription", admin)).status).toBe(400);
    });

    it("cancels an Add-on for the owner, kept to the end of what is paid for, and answers with the whole panel", async () => {
      await pay("2026-08-25");
      await api.post("/admin/catalogue/features/CUSTOMER_HISTORY/addon", { priceMinor: 1_900 }, admin);
      await api.post(`/businesses/${businessId}/addons/CUSTOMER_HISTORY`, undefined, owner);

      const { status, body } = await api.delete(`/admin/businesses/${businessId}/addons/CUSTOMER_HISTORY`, admin);

      expect(status).toBe(200);
      expect(body).toMatchObject({
        subscription: { plan: "SOLO" },
        addons: [{ feature: "CUSTOMER_HISTORY", holding: { endsOn: "2026-10-23", ending: "CANCELLED" } }],
        nextPayment: { totalMinor: 4_900 },
      });
      expect((await api.delete(`/admin/businesses/${businessId}/addons/CUSTOMER_HISTORY`, owner)).status).toBe(403);
      expect((await api.delete(`/admin/businesses/${businessId}/addons/TELEPORT`, admin)).status).toBe(400);
    });

    it("refuses to cancel an Add-on the Business does not hold", async () => {
      await api.post("/admin/catalogue/features/CUSTOMER_HISTORY/addon", { priceMinor: 1_900 }, admin);
      const refused = await api.delete(`/admin/businesses/${businessId}/addons/CUSTOMER_HISTORY`, admin);
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ error: { code: "CONFLICT" } });
    });
  });

  describe("a move to a Plan with room for fewer calendars", () => {
    beforeEach(() => open("TEAM", ["רן", "דנה"]));

    const calendars = async () =>
      (await api.get(`/admin/businesses/${businessId}/calendars`, admin)).body as { calendars: Resource[] };

    it("keeps the calendar the owner chose, and stops the other taking bookings", async () => {
      const [ran, dana] = (await calendars()).calendars;

      const { status, body } = await api.put(
        `/businesses/${businessId}/subscription/plan`,
        { plan: "SOLO", keep: [dana?.id] },
        owner,
      );

      expect(status).toBe(200);
      expect(body).toMatchObject({ subscription: { plan: "SOLO", resourceAllowance: 1 }, status: "TRIAL" });
      expect((await calendars()).calendars).toEqual([
        expect.objectContaining({ id: ran?.id, paused: true }),
        expect.objectContaining({ id: dana?.id, paused: false }),
      ]);
    });

    it("asks the owner which calendars stay, and refuses more than the Plan allows or one that is not theirs", async () => {
      const [ran, dana] = (await calendars()).calendars;
      const attempts = [
        { plan: "SOLO" },
        { plan: "SOLO", keep: [] },
        { plan: "SOLO", keep: [ran?.id, dana?.id] },
        { plan: "SOLO", keep: [MISSING] },
        { plan: "SOLO", keep: ["not-an-id"] },
        { plan: "GOLD", keep: [ran?.id] },
      ];
      for (const attempt of attempts) {
        const refused = await api.put(`/businesses/${businessId}/subscription/plan`, attempt, owner);
        expect(refused.status).toBe(400);
      }
      expect((await billing()).moveUpOwed).toEqual([]);
      expect((await api.get(`/admin/businesses/${businessId}/subscription`, admin)).body).toMatchObject({
        subscription: { plan: "TEAM" },
      });
    });

    it("lets an administrator choose the calendar that stays when moving it for the owner", async () => {
      const [ran] = (await calendars()).calendars;
      const { status, body } = await api.patch(
        `/admin/businesses/${businessId}/subscription`,
        { plan: "SOLO", keep: [ran?.id] },
        admin,
      );
      expect(status).toBe(200);
      expect(body).toMatchObject({ plan: "SOLO", resourceAllowance: 1 });
      expect(await calendars()).toMatchObject({ overBy: 0 });
    });

    it("is the owner's own, and an administrator's", async () => {
      const stranger = (await signInOverHttp(api, "+972500000077", "זר")).token;
      expect((await api.put(`/businesses/${businessId}/subscription/plan`, { plan: "TEAM" }, stranger)).status).toBe(403);
      expect((await api.patch(`/admin/businesses/${businessId}/subscription`, { plan: "TEAM" }, owner)).status).toBe(403);
      expect((await api.patch(`/admin/businesses/${MISSING}/subscription`, { plan: "TEAM" }, admin)).status).toBe(404);
    });
  });

  describe("Days Owed on the wire", () => {
    beforeEach(async () => {
      await open("SOLO");
      await pay("2026-08-25");
    });

    it("moving up again to a Plan left before: what it would owe, and the line it adds to the next payment", async () => {
      await api.put(`/businesses/${businessId}/subscription/plan`, { plan: "TEAM" }, owner);
      await api.put(`/businesses/${businessId}/subscription/plan`, { plan: "SOLO" }, owner);
      travelTo("2026-10-24");
      await api.post("/jobs/billing-deactivation", undefined, api.jobSecret);
      await pay("2026-10-24");
      travelTo("2026-11-06");

      expect((await billing()).moveUpOwed).toEqual([
        { plan: "TEAM", amountMinor: 2_400, from: "2026-11-06", through: "2026-11-23" },
      ]);

      const moved = await api.put(`/businesses/${businessId}/subscription/plan`, { plan: "TEAM" }, owner);

      expect(moved.status).toBe(200);
      expect((moved.body as Billing).nextPayment).toEqual({
        on: "2026-11-24",
        totalMinor: 8_900 + 2_400,
        lines: [
          { kind: "PLAN", plan: "TEAM", amountMinor: 8_900 },
          {
            kind: "DAYS",
            owed: { kind: "PLAN_DAYS", subject: "TEAM", amountMinor: 2_400, from: "2026-11-06", through: "2026-11-23" },
            amountMinor: 2_400,
          },
        ],
      });
    });

    it("adding back an Add-on that ended: what it would owe, before and after", async () => {
      await api.post("/admin/catalogue/features/CUSTOMER_HISTORY/addon", { priceMinor: 1_900 }, admin);
      await api.post(`/businesses/${businessId}/addons/CUSTOMER_HISTORY`, undefined, owner);
      await api.delete(`/businesses/${businessId}/addons/CUSTOMER_HISTORY`, owner);
      travelTo("2026-10-24");
      await pay("2026-10-24");
      travelTo("2026-11-06");

      expect((await billing()).addons).toEqual([
        expect.objectContaining({
          feature: "CUSTOMER_HISTORY",
          hadBefore: true,
          holding: null,
          ifAdded: { paysFrom: "2026-11-24", owed: { amountMinor: 1_140, from: "2026-11-06", through: "2026-11-23" } },
        }),
      ]);

      const added = await api.post(`/admin/businesses/${businessId}/addons/CUSTOMER_HISTORY`, undefined, admin);

      expect((added.body as Billing).nextPayment).toMatchObject({
        totalMinor: 4_900 + 1_900 + 1_140,
        lines: expect.arrayContaining([
          expect.objectContaining({ kind: "DAYS", owed: expect.objectContaining({ kind: "ADDON_DAYS", subject: "CUSTOMER_HISTORY" }) }),
        ]),
      });
    });
  });
});
