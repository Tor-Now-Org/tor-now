import { beforeEach, describe, expect, it } from "vitest";
import {
  httpHarness,
  signInOverHttp,
  type HttpHarness,
} from "../infrastructure/testing/http-harness.ts";

/**
 * The HTTP surface: what each route answers, what it refuses, and what shape it
 * puts on the wire. Every case here goes through the real Hono app, so routing,
 * the actor middleware, zod validation and the error translation are all under
 * test — the layer that has no other coverage.
 */

const A_BUSINESS = {
  name: "מספרת רן",
  phone: "+972500000001",
  description: null,
  address: null,
  resourceNames: ["רן"],
  services: [
    { name: "תספורת", durationMinutes: 30, priceMinor: 8000, bufferMinutes: null },
  ],
  workingHours: [{ dayOfWeek: 2, start: "09:00", end: "17:00" }],
};

describe("health", () => {
  it("reports how the deployment is configured", async () => {
    const api = httpHarness();
    const { status, body } = await api.get("/health");
    expect(status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      verificationTransport: "LOG",
      signingKeyDerivedFrom: "SUPABASE_JWT_SECRET",
    });
  });
});

describe("validation at the boundary", () => {
  let api: HttpHarness;

  beforeEach(() => {
    api = httpHarness();
  });

  it("refuses a phone number that is not in international form", async () => {
    const { status, body } = await api.post("/auth/request-code", { phone: "0501234567" });
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });

  it("refuses a body that is not JSON at all", async () => {
    const { status } = await api.post("/auth/request-code");
    expect(status).toBe(400);
  });

  it("names the field that was wrong", async () => {
    const { body } = await api.post("/auth/verify", { phone: "+972500000001" });
    expect((body as { error: { message: string } }).error.message).toContain("code");
  });

  it("refuses a booking whose start is not an instant", async () => {
    const { token } = await signInOverHttp(api, "+972500000001");
    const { status } = await api.post(
      "/appointments",
      {
        businessId: "8f8d0f16-3b1e-4d9f-9d5f-6a1d9c5f1a11",
        serviceId: "8f8d0f16-3b1e-4d9f-9d5f-6a1d9c5f1a12",
        resourceId: "8f8d0f16-3b1e-4d9f-9d5f-6a1d9c5f1a13",
        startAt: "next tuesday",
        customerNote: null,
      },
      token,
    );
    expect(status).toBe(400);
  });
});

describe("who may call what", () => {
  let api: HttpHarness;

  beforeEach(() => {
    api = httpHarness();
  });

  it("answers 401 with no session at all", async () => {
    const { status, body } = await api.get("/me");
    expect(status).toBe(401);
    expect(body).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("ignores a token it did not issue", async () => {
    const { status } = await api.get("/me", "not-a-real-token");
    expect(status).toBe(401);
  });

  it("answers 403 when a signed-in stranger reaches for a business", async () => {
    const owner = await signInOverHttp(api, "+972500000001");
    const created = await api.post("/businesses", A_BUSINESS, owner.token);
    const businessId = (created.body as { id: string }).id;

    const stranger = await signInOverHttp(api, "+972500000099");
    const { status, body } = await api.get(
      `/businesses/${businessId}/services`,
      stranger.token,
    );
    expect(status).toBe(403);
    expect(body).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("keeps the admin routes closed to an ordinary session", async () => {
    const person = await signInOverHttp(api, "+972500000050");
    expect((await api.get("/admin/businesses", person.token)).status).toBe(403);
    expect((await api.get("/admin/audit", person.token)).status).toBe(403);
  });

  it("keeps the scheduled endpoints closed without the job credential", async () => {
    expect((await api.post("/jobs/outbox")).status).toBe(403);
    const person = await signInOverHttp(api, "+972500000050");
    expect((await api.post("/jobs/outbox", undefined, person.token)).status).toBe(403);
    expect((await api.post("/jobs/outbox", undefined, api.jobSecret)).status).toBe(200);
  });
});

describe("the booking route", () => {
  let api: HttpHarness;
  let businessId: string;
  let serviceId: string;
  let resourceId: string;
  let slot: string;

  beforeEach(async () => {
    api = httpHarness();
    const owner = await signInOverHttp(api, "+972500000001", "רן");
    businessId = ((await api.post("/businesses", A_BUSINESS, owner.token)).body as { id: string }).id;

    const profile = (await api.get(`/businesses/${businessId}`)).body as {
      services: { id: string }[];
      resources: { id: string }[];
    };
    serviceId = profile.services[0]!.id;
    resourceId = profile.resources[0]!.id;

    const days = (await api.get(
      `/businesses/${businessId}/availability?serviceId=${serviceId}&resourceId=${resourceId}&from=2026-09-01&to=2026-09-01`,
    )).body as { slots: { startAt: string }[] }[];
    slot = days[0]!.slots[0]!.startAt;
  });

  it("creates the appointment and answers 201", async () => {
    const customer = await signInOverHttp(api, "+972500000002", "דנה");
    const { status, body } = await api.post(
      "/appointments",
      { businessId, serviceId, resourceId, startAt: slot, customerNote: null },
      customer.token,
    );
    expect(status).toBe(201);
    expect(body).toMatchObject({ status: "CONFIRMED", serviceName: "תספורת" });
  });

  it("puts the price on the wire in both minor units and whole shekels", async () => {
    const customer = await signInOverHttp(api, "+972500000002");
    const { body } = await api.post(
      "/appointments",
      { businessId, serviceId, resourceId, startAt: slot, customerNote: null },
      customer.token,
    );
    expect(body).toMatchObject({ priceMinor: 8000, price: 80 });
  });

  it("never puts another customer's identity on the availability response", async () => {
    const customer = await signInOverHttp(api, "+972500000002", "דנה");
    await api.post(
      "/appointments",
      { businessId, serviceId, resourceId, startAt: slot, customerNote: null },
      customer.token,
    );

    const { body } = await api.get(
      `/businesses/${businessId}/availability?serviceId=${serviceId}&resourceId=${resourceId}&from=2026-09-01&to=2026-09-01`,
    );
    expect(JSON.stringify(body)).not.toContain("דנה");
    expect(JSON.stringify(body)).not.toContain(customer.userId);
  });

  it("answers 422 when the second customer asks for the same time", async () => {
    const first = await signInOverHttp(api, "+972500000002");
    const second = await signInOverHttp(api, "+972500000003");
    const request = { businessId, serviceId, resourceId, startAt: slot, customerNote: null };

    await api.post("/appointments", request, first.token);
    const { status, body } = await api.post("/appointments", request, second.token);
    expect(status).toBe(422);
    expect(body).toMatchObject({ error: { code: "OUTSIDE_WORKING_HOURS" } });
  });

  it("lets the customer cancel and see it in their own list", async () => {
    const customer = await signInOverHttp(api, "+972500000002");
    const created = await api.post(
      "/appointments",
      { businessId, serviceId, resourceId, startAt: slot, customerNote: null },
      customer.token,
    );
    const id = (created.body as { id: string }).id;

    const cancelled = await api.post(`/appointments/${id}/cancel`, undefined, customer.token);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ status: "CANCELLED", cancelledBy: "CUSTOMER" });

    const mine = (await api.get("/me/appointments", customer.token)).body as unknown[];
    expect(mine).toHaveLength(1);
  });

  it("answers 404 for a business that does not exist", async () => {
    const { status } = await api.get("/businesses/2f8d0f16-3b1e-4d9f-9d5f-6a1d9c5f1a99");
    expect(status).toBe(404);
  });
});

describe("the owner routes", () => {
  it("round-trip a service, an override and a block", async () => {
    const api = httpHarness();
    const owner = await signInOverHttp(api, "+972500000001", "רן");
    const businessId = ((await api.post("/businesses", A_BUSINESS, owner.token)).body as { id: string }).id;
    const resourceId = ((await api.get(`/businesses/${businessId}/resources`, owner.token))
      .body as { id: string }[])[0]!.id;

    const service = await api.post(
      `/businesses/${businessId}/services`,
      { name: "צבע", durationMinutes: 90, priceMinor: 25000, bufferMinutes: 10 },
      owner.token,
    );
    expect(service.status).toBe(201);
    expect(service.body).toMatchObject({ name: "צבע", bufferMinutes: 10 });

    const override = await api.put(
      `/businesses/${businessId}/resources/${resourceId}/overrides`,
      { date: "2026-09-01", note: null, ranges: [] },
      owner.token,
    );
    expect(override.status).toBe(200);
    // An override with no ranges is a day off, and says so on the wire.
    expect(override.body).toMatchObject({ closed: true });

    const block = await api.post(
      `/businesses/${businessId}/resources/${resourceId}/blocks`,
      { startAt: "2026-09-02T09:00:00.000Z", endAt: "2026-09-02T10:00:00.000Z", reason: "ספק" },
      owner.token,
    );
    expect(block.status).toBe(201);

    const calendar = await api.get(
      `/businesses/${businessId}/resources/${resourceId}/calendar?date=2026-09-02`,
      owner.token,
    );
    expect((calendar.body as { blocks: unknown[] }).blocks).toHaveLength(1);
  });

  it("answers 204 with no body on a delete", async () => {
    const api = httpHarness();
    const owner = await signInOverHttp(api, "+972500000001");
    const businessId = ((await api.post("/businesses", A_BUSINESS, owner.token)).body as { id: string }).id;
    const serviceId = ((await api.get(`/businesses/${businessId}/services`, owner.token))
      .body as { id: string }[])[0]!.id;

    const { status, body } = await api.delete(
      `/businesses/${businessId}/services/${serviceId}`,
      owner.token,
    );
    expect(status).toBe(204);
    expect(body).toBeNull();
  });
});
