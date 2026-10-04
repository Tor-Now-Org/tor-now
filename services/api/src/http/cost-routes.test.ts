import { beforeEach, describe, expect, it } from "vitest";
import { parseInstant } from "@tor-now/domain";
import {
  httpHarness,
  signInAsAdministratorOverHttp,
  signInOverHttp,
  type HttpHarness,
} from "../infrastructure/testing/http-harness.ts";

/**
 * The Cost tab and Fair Use over HTTP (ADR 0023): who may call them, what they
 * refuse at the boundary, and what they put on the wire.
 */

const A_USE = {
  calendars: 2,
  BOOKING: { whatsapp: 238, sms: 3 },
  REMINDERS: { whatsapp: 197, sms: 2 },
  WAITING_LIST: { whatsapp: 6, sms: 0 },
  BILLING: { whatsapp: 2, sms: 0 },
};
const MISSING = "00000000-0000-4000-8000-000000000999";

type Saved = { id: string; name: string; use: typeof A_USE; savedOn: string };

describe("the Cost routes", () => {
  let api: HttpHarness;
  let admin: string;

  beforeEach(async () => {
    api = httpHarness();
    api.travelTo(parseInstant("2026-09-20T09:00:00.000Z"));
    admin = (await signInAsAdministratorOverHttp(api, "+972500000900")).token;
  });

  it("are closed to an ordinary session, and to no session at all, as every admin route is", async () => {
    const person = (await signInOverHttp(api, "+972500000901")).token;
    const reads = ["/admin/costs/month", "/admin/costs/calculator", "/admin/costs/running", "/admin/fair-use", "/admin/fair-use/alerts"];
    for (const path of reads) {
      expect((await api.get(path, person)).status).toBe(403);
      expect((await api.get(path)).status).toBe(403);
    }
    expect((await api.post("/admin/costs/reference-businesses", { name: "x y", use: A_USE }, person)).status).toBe(403);
    expect((await api.put("/admin/fair-use/sign-in", { codesPerDay: 5 }, person)).status).toBe(403);
  });

  describe("a month", () => {
    it("answers this month by default, with every figure on the wire", async () => {
      const { status, body } = await api.get("/admin/costs/month", admin);
      expect(status).toBe(200);
      expect(body).toEqual({
        month: "2026-09",
        through: "2026-09-20",
        current: true,
        platform: { signIn: { codes: 0, cost: 0, unpricedUnits: 0 }, running: [], total: 0, perPaying: null },
        plans: [expect.objectContaining({ plan: "SOLO", paying: 0 }), expect.objectContaining({ plan: "TEAM", paying: 0 })],
        prices: [
          { plan: "SOLO", priceMinor: 4_900, allowance: 1 },
          { plan: "TEAM", priceMinor: 8_900, allowance: 5 },
        ],
        paying: 0,
        trials: { count: 0, cost: 0, averageCost: null },
        notPaying: { count: 0, cost: 0, averageCost: null },
        unpriced: [],
        overLimit: [],
      });
    });

    it("answers an earlier month, and refuses one to come or one that is no month", async () => {
      expect((await api.get("/admin/costs/month?month=2026-08", admin)).body).toMatchObject({
        month: "2026-08",
        through: "2026-08-31",
        current: false,
      });
      const future = await api.get("/admin/costs/month?month=2026-10", admin);
      expect(future.status).toBe(400);
      expect(future.body).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
      for (const wrong of ["2026-13", "2026-9", "september", "2026-09-01"]) {
        expect((await api.get(`/admin/costs/month?month=${wrong}`, admin)).status).toBe(400);
      }
    });
  });

  describe("the calculator and its saved Businesses", () => {
    it("answers the basis: rates, Plans in agorot, the saved examples", async () => {
      const { status, body } = await api.get("/admin/costs/calculator", admin);
      expect(status).toBe(200);
      expect(body).toMatchObject({
        rates: { whatsapp: 19_610, smsPart: 952_750, partsPerSms: 2 },
        plans: [
          { plan: "SOLO", priceMinor: 4_900, allowance: 1 },
          { plan: "TEAM", priceMinor: 8_900, allowance: 5 },
        ],
        share: null,
        actualAverage: null,
        mostExpensive: null,
      });
      expect((body as { saved: Saved[] }).saved.map((saved) => saved.name)).toEqual(["בינוני", "עמוס"]);
    });

    it("saves, updates, renames and deletes one, answering the list each time", async () => {
      const created = await api.post("/admin/costs/reference-businesses", { name: "מספרה", use: A_USE }, admin);
      expect(created.status).toBe(200);
      const saved = (created.body as Saved[]).find((one) => one.name === "מספרה");
      expect(saved).toMatchObject({ use: A_USE, savedOn: "2026-09-20" });
      const id = saved?.id ?? MISSING;

      const updated = await api.put(`/admin/costs/reference-businesses/${id}`, { use: { ...A_USE, calendars: 3 } }, admin);
      expect((updated.body as Saved[]).find((one) => one.id === id)?.use.calendars).toBe(3);

      const renamed = await api.patch(`/admin/costs/reference-businesses/${id}`, { name: "מספרה גדולה" }, admin);
      expect((renamed.body as Saved[]).find((one) => one.id === id)?.name).toBe("מספרה גדולה");

      const deleted = await api.delete(`/admin/costs/reference-businesses/${id}`, admin);
      expect((deleted.body as Saved[]).map((one) => one.name)).toEqual(["בינוני", "עמוס"]);
    });

    it("refuses a malformed request at the boundary, and the domain's rules after it", async () => {
      const post = (body: unknown) => api.post("/admin/costs/reference-businesses", body, admin);
      expect((await post({ name: "מספרה" })).status).toBe(400);
      expect((await post({ name: "מספרה", use: { ...A_USE, BOOKING: { whatsapp: "many", sms: 0 } } })).status).toBe(400);
      expect((await post({ name: "מספרה", use: { ...A_USE, calendars: 1.5 } })).status).toBe(400);
      expect((await post({ name: "עמוס", use: A_USE })).body).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
      expect((await post({ name: "מספרה", use: { ...A_USE, calendars: 0 } })).status).toBe(400);
    });

    it("checks an id is one before it looks, and says a missing one is not found", async () => {
      expect((await api.delete("/admin/costs/reference-businesses/not-a-uuid", admin)).status).toBe(400);
      const missing = await api.delete(`/admin/costs/reference-businesses/${MISSING}`, admin);
      expect(missing.status).toBe(404);
      expect(missing.body).toMatchObject({ error: { code: "NOT_FOUND" } });
    });
  });

  describe("running costs", () => {
    it("adds one and a later amount, in agorot, and lists them", async () => {
      const added = await api.post(
        "/admin/costs/running",
        { name: "Supabase", amountMinor: 9_250, effectiveFrom: "2026-09-01", source: "invoice August" },
        admin,
      );
      expect(added.status).toBe(200);
      const [cost] = added.body as { id: string; name: string; amounts: unknown[] }[];
      expect(cost).toMatchObject({
        name: "Supabase",
        amounts: [{ effectiveFrom: "2026-09-01", amountMinor: 9_250, source: "invoice August" }],
      });
      const later = await api.post(
        `/admin/costs/running/${cost?.id ?? MISSING}/amounts`,
        { amountMinor: 0, effectiveFrom: "2026-10-01", source: "cancelled" },
        admin,
      );
      expect((later.body as { amounts: unknown[] }[])[0]?.amounts).toHaveLength(2);
      expect(((await api.get("/admin/costs/running", admin)).body as unknown[]).length).toBe(1);
      expect(((await api.get("/admin/costs/month", admin)).body as { platform: { total: number } }).platform.total).toBe(
        9_250 * 10_000,
      );
    });

    it("refuses a bad amount, date or id", async () => {
      const add = (body: unknown) => api.post("/admin/costs/running", body, admin);
      expect((await add({ name: "Vercel", amountMinor: 1.5, effectiveFrom: "2026-09-01", source: "invoice" })).status).toBe(400);
      expect((await add({ name: "Vercel", amountMinor: 100, effectiveFrom: "1 Sept", source: "invoice" })).status).toBe(400);
      expect((await add({ name: "Vercel", amountMinor: -1, effectiveFrom: "2026-09-01", source: "invoice" })).status).toBe(400);
      expect(
        (await api.post("/admin/costs/running/nope/amounts", { amountMinor: 1, effectiveFrom: "2026-09-01", source: "x y z" }, admin))
          .status,
      ).toBe(400);
      expect(
        (await api.post(`/admin/costs/running/${MISSING}/amounts`, { amountMinor: 1, effectiveFrom: "2026-09-01", source: "x y z" }, admin))
          .status,
      ).toBe(404);
    });
  });

  describe("Fair Use", () => {
    it("answers the limits, sign-in codes and every cause", async () => {
      const { status, body } = await api.get("/admin/fair-use", admin);
      expect(status).toBe(200);
      expect(body).toMatchObject({
        month: "2026-09",
        limits: { perBusiness: { BOOKING: 12_000, REMINDERS: 10_000, WAITING_LIST: 1_000 }, signInPerDay: 300 },
        signIn: { today: 0, limit: 300, over: false, averagePerDay: 0 },
        sources: [
          { source: "BOOKING", limit: 12_000, top: null, over: [] },
          { source: "REMINDERS", limit: 10_000, top: null, over: [] },
          { source: "WAITING_LIST", limit: 1_000, top: null, over: [] },
        ],
      });
      expect((await api.get("/admin/fair-use/alerts", admin)).body).toEqual({
        businessesOver: 0,
        sourcesOver: [],
        signIn: { today: 0, limit: 300, over: false },
      });
    });

    it("changes a cause's limit and the daily one, and refuses what is no limit or no cause", async () => {
      const changed = await api.put("/admin/fair-use/limits/WAITING_LIST", { amountMinor: 2_000 }, admin);
      expect(changed.status).toBe(200);
      expect(changed.body).toMatchObject({ limits: { perBusiness: { WAITING_LIST: 2_000 } } });
      expect(((await api.put("/admin/fair-use/sign-in", { codesPerDay: 120 }, admin)).body as { limits: { signInPerDay: number } }).limits.signInPerDay).toBe(120);
      expect((await api.put("/admin/fair-use/limits/BILLING", { amountMinor: 2_000 }, admin)).status).toBe(400);
      expect((await api.put("/admin/fair-use/limits/BOOKING", { amountMinor: 0 }, admin)).status).toBe(400);
      expect((await api.put("/admin/fair-use/sign-in", { codesPerDay: "many" }, admin)).status).toBe(400);
    });

    it("answers one Business's usage this month, and refuses what is no Business", async () => {
      const owner = await signInOverHttp(api, "+972500000902", "רן");
      const registered = await api.post(
        "/businesses",
        {
          name: "מספרת רן",
          phone: "+972500000902",
          description: null,
          address: "רחוב הרצל 1",
          latitude: 32.0853,
          longitude: 34.7818,
          categories: ["barbershop"],
          plan: "SOLO",
          resourceNames: ["רן"],
          services: [{ name: "תספורת", durationMinutes: 30, priceMinor: 8000, bufferMinutes: null }],
          workingHours: [{ dayOfWeek: 2, start: "09:00", end: "17:00" }],
        },
        owner.token,
      );
      const businessId = (registered.body as { id: string }).id;
      const usage = await api.get(`/admin/businesses/${businessId}/usage`, admin);
      expect(usage.status).toBe(200);
      expect(usage.body).toMatchObject({
        month: "2026-09",
        whatsapp: 0,
        smsMessages: 0,
        total: 0,
        monthlyPriceMinor: 4_900,
        readings: [
          { source: "BOOKING", limit: 12_000, cost: 0, over: false },
          { source: "REMINDERS", limit: 10_000, cost: 0, over: false },
          { source: "WAITING_LIST", limit: 1_000, cost: 0, over: false },
        ],
      });
      // The same Business as the directory shows it, to open its sheet from a cost screen.
      const row = await api.get(`/admin/businesses/${businessId}`, admin);
      expect(row.status).toBe(200);
      expect(row.body).toMatchObject({ business: { id: businessId, name: "מספרת רן" }, plan: "SOLO", status: "TRIAL" });
      expect((await api.get(`/admin/businesses/${businessId}`, owner.token)).status).toBe(403);
      expect((await api.get("/admin/businesses/nope", admin)).status).toBe(400);
      expect((await api.get(`/admin/businesses/${MISSING}`, admin)).status).toBe(404);
      expect((await api.get("/admin/businesses/nope/usage", admin)).status).toBe(400);
      expect((await api.get(`/admin/businesses/${MISSING}/usage`, admin)).status).toBe(404);
    });
  });
});
