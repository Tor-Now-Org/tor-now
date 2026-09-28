import { beforeEach, describe, expect, it } from "vitest";
import {
  httpHarness,
  signInAsAdministratorOverHttp,
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
  address: "רחוב הרצל 1",
  latitude: 32.0853,
  longitude: 34.7818,
  category: "barbershop",
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

  it("tells the signed-in person whether they staff anywhere", async () => {
    const person = await signInOverHttp(api, "+972500000001");
    expect((await api.get("/me", person.token)).body).toMatchObject({
      isHasBusinesses: false,
    });

    await api.post("/businesses", A_BUSINESS, person.token);
    expect((await api.get("/me", person.token)).body).toMatchObject({
      isHasBusinesses: true,
    });
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
    expect((await api.get("/admin/stats", person.token)).status).toBe(403);
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

    // A blockage is a list of spans, because one decision can cover several
    // days or several hours of the same day.
    const block = await api.post(
      `/businesses/${businessId}/resources/${resourceId}/blocks`,
      {
        blocks: [
          { startAt: "2026-09-02T09:00:00.000Z", endAt: "2026-09-02T10:00:00.000Z", reason: "ספק" },
          { startAt: "2026-09-02T14:00:00.000Z", endAt: "2026-09-02T15:00:00.000Z", reason: "ספק" },
        ],
      },
      owner.token,
    );
    expect(block.status).toBe(201);
    expect(block.body).toHaveLength(2);

    const calendar = await api.get(
      `/businesses/${businessId}/resources/${resourceId}/calendar?date=2026-09-02`,
      owner.token,
    );
    expect((calendar.body as { blocks: unknown[] }).blocks).toHaveLength(2);
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

describe("closing the business over HTTP", () => {
  it("previews, closes, and gives the days back again", async () => {
    const api = httpHarness();
    const owner = await signInOverHttp(api, "+972500000001", "רן");
    const businessId = ((await api.post("/businesses", A_BUSINESS, owner.token)).body as {
      id: string;
    }).id;

    const preview = await api.post(
      `/businesses/${businessId}/closures/preview`,
      { fromDate: "2026-09-01", toDate: "2026-09-03", ranges: [] },
      owner.token,
    );
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ days: 3, calendars: 1, appointments: [] });

    const closed = await api.post(
      `/businesses/${businessId}/closures`,
      {
        fromDate: "2026-09-01",
        toDate: "2026-09-03",
        note: "חופשה",
        ranges: [],
        upcoming: "CANCEL",
      },
      owner.token,
    );
    expect(closed.status).toBe(201);
    expect(closed.body).toMatchObject({ days: 3, cancelled: 0 });

    // The month reads it back as one band, in the words it was given.
    const month = await api.get(
      `/businesses/${businessId}/calendar/month?firstOfMonth=2026-09-01`,
      owner.token,
    );
    expect((month.body as { closures: unknown[] }).closures).toEqual([
      {
        fromDate: "2026-09-01",
        toDate: "2026-09-03",
        days: 3,
        note: "חופשה",
        kind: "SHUT",
        hours: [],
      },
    ]);

    const reopened = await api.delete(
      `/businesses/${businessId}/closures?from=2026-09-01&to=2026-09-03`,
      owner.token,
    );
    expect(reopened.status).toBe(200);
    expect(reopened.body).toMatchObject({ removed: 3 });
  });

  it("refuses to clear a business's location, which search needs to show it", async () => {
    const api = httpHarness();
    const owner = await signInOverHttp(api, "+972500000001");
    const businessId = ((await api.post("/businesses", A_BUSINESS, owner.token)).body as {
      id: string;
    }).id;

    const answer = await api.patch(`/businesses/${businessId}`, { latitude: null, longitude: null }, owner.token);
    expect(answer.status).toBe(400);
  });

  it("refuses a closure that ends before it starts, at the boundary", async () => {
    const api = httpHarness();
    const owner = await signInOverHttp(api, "+972500000001");
    const businessId = ((await api.post("/businesses", A_BUSINESS, owner.token)).body as {
      id: string;
    }).id;

    const answer = await api.post(
      `/businesses/${businessId}/closures`,
      { fromDate: "2026-09-03", toDate: "2026-09-01", ranges: [], upcoming: "KEEP" },
      owner.token,
    );
    expect(answer.status).toBe(400);
  });

  it("will not take an answer it was not given about the people booked", async () => {
    const api = httpHarness();
    const owner = await signInOverHttp(api, "+972500000001");
    const businessId = ((await api.post("/businesses", A_BUSINESS, owner.token)).body as {
      id: string;
    }).id;

    // `upcoming` has no default on purpose: both answers are wrong by default,
    // so a caller that forgets to say is refused rather than guessed at.
    const answer = await api.post(
      `/businesses/${businessId}/closures`,
      { fromDate: "2026-09-01", toDate: "2026-09-01", ranges: [] },
      owner.token,
    );
    expect(answer.status).toBe(400);
  });
});

describe("business photos over HTTP", () => {
  const A_PICTURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

  const anOwnerWithABusiness = async (api: HttpHarness) => {
    const owner = await signInOverHttp(api, "+972500000001", "רן");
    const businessId = (
      (await api.post("/businesses", A_BUSINESS, owner.token)).body as { id: string }
    ).id;
    return { owner, businessId };
  };

  it("uploads a cover, lists it, serves the bytes and deletes it", async () => {
    const api = httpHarness();
    const { owner, businessId } = await anOwnerWithABusiness(api);

    const created = await api.putBytes(
      `/businesses/${businessId}/photos/0`,
      A_PICTURE,
      "image/png",
      owner.token,
    );
    expect(created.status).toBe(201);
    const photo = created.body as { id: string; slot: number; url: string; byteSize: number };
    expect(photo).toMatchObject({ slot: 0, byteSize: A_PICTURE.byteLength });

    const listed = await api.get(`/businesses/${businessId}/photos`, owner.token);
    expect(listed.body).toHaveLength(1);

    // The URL the client is given actually serves the bytes that were sent.
    const fetched = await api.getBytes(photo.url);
    expect(fetched.status).toBe(200);
    expect(fetched.contentType).toContain("image/png");
    expect([...fetched.bytes]).toEqual([...A_PICTURE]);

    expect(
      (await api.delete(`/businesses/${businessId}/photos/${photo.id}`, owner.token)).status,
    ).toBe(204);
    expect((await api.getBytes(photo.url)).status).toBe(404);
  });

  it("putting a photo in a taken slot replaces it", async () => {
    const api = httpHarness();
    const { owner, businessId } = await anOwnerWithABusiness(api);
    const path = `/businesses/${businessId}/photos/0`;

    const first = (await api.putBytes(path, A_PICTURE, "image/png", owner.token)).body as { id: string; url: string };
    const bigger = new Uint8Array([...A_PICTURE, 9, 9, 9]);
    const second = (await api.putBytes(path, bigger, "image/png", owner.token)).body as { id: string; url: string };

    expect(second.id).not.toBe(first.id);
    expect((await api.get(`/businesses/${businessId}/photos`, owner.token)).body).toHaveLength(1);
    // The old object is gone and the new one serves.
    expect((await api.getBytes(first.url)).status).toBe(404);
    expect([...(await api.getBytes(second.url)).bytes]).toEqual([...bigger]);
  });

  it("a customer sees the photos on the business, cover first", async () => {
    const api = httpHarness();
    const { owner, businessId } = await anOwnerWithABusiness(api);
    for (const slot of [3, 0]) {
      await api.putBytes(
        `/businesses/${businessId}/photos/${slot}`,
        A_PICTURE,
        "image/jpeg",
        owner.token,
      );
    }

    // No token: this is the public page.
    const profile = await api.get(`/businesses/${businessId}`);
    expect((profile.body as { photos: { slot: number }[] }).photos.map((p) => p.slot)).toEqual([0, 3]);
  });

  it("refuses a slot that is not one of the four", async () => {
    const api = httpHarness();
    const { owner, businessId } = await anOwnerWithABusiness(api);
    const answer = await api.putBytes(
      `/businesses/${businessId}/photos/9`,
      A_PICTURE,
      "image/png",
      owner.token,
    );
    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });

  it("refuses a stranger, and something that is not an image", async () => {
    const api = httpHarness();
    const { owner, businessId } = await anOwnerWithABusiness(api);
    const stranger = await signInOverHttp(api, "+972500000077", "זר");

    expect(
      (
        await api.putBytes(
          `/businesses/${businessId}/photos/0`,
          A_PICTURE,
          "image/png",
          stranger.token,
        )
      ).status,
    ).toBe(403);

    expect(
      (
        await api.putBytes(
          `/businesses/${businessId}/photos/0`,
          A_PICTURE,
          "application/pdf",
          owner.token,
        )
      ).status,
    ).toBe(400);
  });
});

describe("the administrator's directory", () => {
  let api: HttpHarness;

  beforeEach(() => {
    api = httpHarness();
  });

  it("filters by comma-separated statuses and answers with typed rows and counts", async () => {
    const owner = await signInOverHttp(api, "+972500000001", "רן");
    await api.post("/businesses", A_BUSINESS, owner.token);
    const admin = await signInAsAdministratorOverHttp(api, "+972500000000");

    const { status, body } = await api.get("/admin/businesses?status=TRIAL,IN_GRACE&plan=SOLO", admin.token);

    expect(status).toBe(200);
    expect(body).toMatchObject({
      total: 1,
      rows: [
        {
          business: { name: "מספרת רן" },
          ownerName: "רן",
          plan: "SOLO",
          status: "TRIAL",
          nextDate: "2026-09-23",
          flags: [],
        },
      ],
      counts: { total: 1, statuses: { TRIAL: 1 }, plans: { SOLO: 1, TEAM: 0 } },
    });
  });

  it("refuses a status it does not know rather than ignoring it", async () => {
    const admin = await signInAsAdministratorOverHttp(api, "+972500000000");
    const { status, body } = await api.get("/admin/businesses?status=TRIAL,FREE", admin.token);
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });

  it("moves a Business to another plan", async () => {
    const owner = await signInOverHttp(api, "+972500000001", "רן");
    const created = await api.post("/businesses", A_BUSINESS, owner.token);
    const businessId = (created.body as { id: string }).id;
    const admin = await signInAsAdministratorOverHttp(api, "+972500000000");

    const { status, body } = await api.patch(
      `/admin/businesses/${businessId}/subscription`,
      { plan: "TEAM" },
      admin.token,
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({ plan: "TEAM", resourceAllowance: 5, scheduledMove: null });
  });
});

describe("the catalogue", () => {
  it("tells anyone, signed in or not, what each Plan offers today", async () => {
    const api = httpHarness();
    const { status, body } = await api.get("/plans");
    expect(status).toBe(200);
    expect(body).toEqual({
      plans: [
        expect.objectContaining({ plan: "SOLO", planVersion: 1, priceMinor: 4900, price: 49, resourceAllowance: 1 }),
        expect.objectContaining({ plan: "TEAM", planVersion: 1, priceMinor: 8900, price: 89, resourceAllowance: 5 }),
      ],
      previews: [{ feature: "WAITING_LIST", endsOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }],
    });
  });
});

describe("the plan, where the screens need it", () => {
  let api: HttpHarness;

  beforeEach(() => {
    api = httpHarness();
  });

  it("tells staff what their Business's plan allows, and customers whether they may wait", async () => {
    const owner = await signInOverHttp(api, "+972500000001", "רן");
    const created = await api.post("/businesses", { ...A_BUSINESS, plan: "SOLO" }, owner.token);
    const businessId = (created.body as { id: string }).id;

    const mine = await api.get("/me/businesses", owner.token);
    expect(mine.body).toEqual([
      expect.objectContaining({ entitlement: expect.objectContaining({ resourceAllowance: 1 }) }),
    ]);

    const profile = await api.get(`/businesses/${businessId}`);
    expect(profile.body).toMatchObject({ waitingList: true, resources: [expect.objectContaining({ paused: false })] });
  });

  it("answers 402 when a plan does not include what was asked for", async () => {
    const owner = await signInOverHttp(api, "+972500000001", "רן");
    const created = await api.post("/businesses", { ...A_BUSINESS, plan: "SOLO" }, owner.token);
    const businessId = (created.body as { id: string }).id;

    const { status, body } = await api.post(`/businesses/${businessId}/resources`, { name: "דנה" }, owner.token);
    expect(status).toBe(402);
    expect(body).toMatchObject({ error: { code: "NOT_ENTITLED", details: { resourceAllowance: 1 } } });
  });

  it("lets an administrator see the calendars and keep the ones agreed", async () => {
    const owner = await signInOverHttp(api, "+972500000001", "רן");
    const created = await api.post("/businesses", { ...A_BUSINESS, plan: "TEAM" }, owner.token);
    const businessId = (created.body as { id: string }).id;
    await api.post(`/businesses/${businessId}/resources`, { name: "דנה" }, owner.token);
    const admin = await signInAsAdministratorOverHttp(api, "+972500000000");
    await api.patch(`/admin/businesses/${businessId}/subscription`, { plan: "SOLO" }, admin.token);

    const view = await api.get(`/admin/businesses/${businessId}/calendars`, admin.token);
    expect(view.body).toMatchObject({ resourceAllowance: 1, overBy: 1 });
    const calendars = (view.body as { calendars: { id: string; upcoming: number }[] }).calendars;
    expect(calendars).toHaveLength(2);

    const kept = await api.put(
      `/admin/businesses/${businessId}/calendars/kept`,
      { resourceIds: [calendars[0]?.id] },
      admin.token,
    );
    expect(kept.status).toBe(200);
    expect(kept.body).toEqual([
      expect.objectContaining({ id: calendars[0]?.id, paused: false }),
      expect.objectContaining({ id: calendars[1]?.id, paused: true }),
    ]);
  });
});

describe("an owner's own plan", () => {
  it("changes over HTTP, and the daily job reports what it moved", async () => {
    const api = httpHarness();
    const owner = await signInOverHttp(api, "+972500000001", "רן");
    const created = await api.post("/businesses", { ...A_BUSINESS, plan: "SOLO" }, owner.token);
    const businessId = (created.body as { id: string }).id;

    const { status, body } = await api.put(`/businesses/${businessId}/subscription/plan`, { plan: "TEAM" }, owner.token);
    expect(status).toBe(200);
    expect(body).toMatchObject({ subscription: { plan: "TEAM" }, status: "TRIAL" });

    const job = await api.post("/jobs/billing-deactivation", undefined, api.jobSecret);
    expect(job.body).toMatchObject({ moved: [], paused: [], deactivated: [] });
  });
});

describe("an owner's Notices", () => {
  it("lists them with the one banner, reads them, and acknowledges it — and only for the owner", async () => {
    const api = httpHarness();
    const owner = await signInOverHttp(api, "+972500000001", "רן");
    const created = await api.post("/businesses", { ...A_BUSINESS, plan: "TEAM" }, owner.token);
    const businessId = (created.body as { id: string }).id;

    const board = await api.get(`/businesses/${businessId}/notices`, owner.token);
    expect(board.status).toBe(200);
    const notices = (board.body as { notices: { id: string }[] }).notices;
    expect(board.body).toEqual({
      notices: [
        {
          id: notices[0]?.id,
          kind: "TRIAL_STARTED",
          tone: "good",
          facts: { kind: "TRIAL_STARTED", plan: "TEAM", trialEndsOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
          createdAt: expect.any(String),
          read: false,
          standing: true,
        },
      ],
      banner: { noticeId: notices[0]?.id, othersUnread: 0 },
    });

    const read = await api.post(`/businesses/${businessId}/notices/read`, undefined, owner.token);
    expect(read.body).toMatchObject({ notices: [{ read: true, standing: true }] });

    const acknowledged = await api.post(
      `/businesses/${businessId}/notices/${notices[0]?.id}/acknowledge`,
      undefined,
      owner.token,
    );
    expect(acknowledged.body).toMatchObject({ notices: [{ standing: false }], banner: null });

    const stranger = await signInOverHttp(api, "+972500000077", "זר");
    expect((await api.get(`/businesses/${businessId}/notices`, stranger.token)).status).toBe(403);
    expect((await api.post(`/businesses/${businessId}/notices/not-an-id/acknowledge`, undefined, owner.token)).status).toBe(
      400,
    );
  });

  it("are told by the daily job, which reports how many were new", async () => {
    const api = httpHarness();
    const job = await api.post("/jobs/billing-deactivation", undefined, api.jobSecret);
    expect(job.body).toMatchObject({ noticed: 0 });
  });
});

describe("the Catalogue editor over HTTP", () => {
  it("corrects a rate and lists it, dated and sourced", async () => {
    const api = httpHarness();
    const admin = await signInAsAdministratorOverHttp(api, "+972500000000");

    const saved = await api.put(
      "/admin/catalogue/rates",
      { unit: "SMS_SEGMENT", effectiveFrom: "2026-08-01", microShekels: 900_000, source: "Twilio invoice, August" },
      admin.token,
    );
    expect(saved.status).toBe(200);
    expect(saved.body).toContainEqual(
      expect.objectContaining({ unit: "SMS_SEGMENT", effectiveFrom: "2026-08-01", microShekels: 900_000, source: "Twilio invoice, August" }),
    );

    const refused = await api.put(
      "/admin/catalogue/rates",
      { unit: "SMS_SEGMENT", effectiveFrom: "2026-08-01", microShekels: 900_000, source: "" },
      admin.token,
    );
    expect(refused.status).toBe(400);
  });

  it("grants, extends and ends Features, and the billing panel lists where each comes from", async () => {
    const api = httpHarness();
    const owner = await signInOverHttp(api, "+972500000001", "רן");
    const created = await api.post("/businesses", { ...A_BUSINESS, plan: "SOLO" }, owner.token);
    const businessId = (created.body as { id: string }).id;
    const admin = await signInAsAdministratorOverHttp(api, "+972500000000");

    const granted = await api.post(
      `/admin/businesses/${businessId}/grants`,
      { features: ["TEAM_ROLES", "CUSTOMER_HISTORY"], endsOn: "2026-11-23", reason: "פיילוט" },
      admin.token,
    );
    expect(granted.status).toBe(200);
    const features = (granted.body as { features: { feature: string; source: string; grant: { id: string } | null }[] })
      .features;
    expect(features.map(({ feature, source }) => `${feature}:${source}`)).toEqual([
      "REMINDERS:PLAN",
      "CUSTOMER_HISTORY:GRANT",
      "CUSTOMER_BLOCKING:NONE",
      "TEAM_ROLES:GRANT",
      "WAITING_LIST:PREVIEW",
    ]);
    const grantId = features.find((source) => source.feature === "TEAM_ROLES")?.grant?.id ?? "";

    const extended = await api.patch(
      `/admin/businesses/${businessId}/grants/${grantId}`,
      { endsOn: "2026-12-23", reason: "עוד חודש" },
      admin.token,
    );
    expect(extended.body).toMatchObject({ features: expect.arrayContaining([expect.objectContaining({ feature: "TEAM_ROLES", endsOn: "2026-12-23" })]) });

    const ended = await api.post(`/admin/businesses/${businessId}/grants/${grantId}/end`, undefined, admin.token);
    expect(ended.body).toMatchObject({ features: expect.arrayContaining([expect.objectContaining({ feature: "TEAM_ROLES", source: "NONE" })]) });

    // The owner sees where each comes from, never why it was given.
    const billing = await api.get(`/businesses/${businessId}/subscription`, owner.token);
    expect((billing.body as { features: unknown[] }).features).toContainEqual({
      feature: "CUSTOMER_HISTORY",
      source: "GRANT",
      endsOn: "2026-11-23",
      grant: null,
    });

    expect((await api.post(`/admin/businesses/${businessId}/grants/nope/end`, undefined, admin.token)).status).toBe(400);
    expect(
      (await api.post(`/admin/businesses/${businessId}/grants`, { features: [], endsOn: "2026-11-23", reason: "x" }, admin.token))
        .status,
    ).toBe(400);
    expect((await api.get("/admin/catalogue/rates", owner.token)).status).toBe(403);
  });
});

describe("editing Plans over HTTP", () => {
  it("lists the Plans, publishes a change that takes, and cancels it", async () => {
    const api = httpHarness();
    const owner = await signInOverHttp(api, "+972500000001", "רן");
    await api.post("/businesses", { ...A_BUSINESS, plan: "SOLO" }, owner.token);
    const admin = await signInAsAdministratorOverHttp(api, "+972500000000");

    const listed = await api.get("/admin/catalogue/plans", admin.token);
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({
      plans: [
        { plan: "SOLO", current: { number: 1, priceMinor: 4900 }, pending: null, editions: [{ number: 1, businesses: 1, current: true }] },
        { plan: "TEAM", current: { number: 1 } },
      ],
    });

    const changed = await api.put(
      "/admin/catalogue/plans/SOLO",
      { priceMinor: 5900, resourceAllowance: 1, features: ["REMINDERS"] },
      admin.token,
    );
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({
      kind: "TAKES",
      plans: [{ plan: "SOLO", current: { number: 2, priceMinor: 5900 }, pending: { cancellable: true, joined: [] } }, {}],
    });

    const cancelled = await api.post("/admin/catalogue/plans/SOLO/change/cancel", undefined, admin.token);
    expect(cancelled.body).toMatchObject({ plans: [{ plan: "SOLO", current: { number: 1 }, pending: null }, {}] });

    expect((await api.put("/admin/catalogue/plans/GOLD", { priceMinor: 1, resourceAllowance: 1, features: [] }, admin.token)).status).toBe(400);
    expect((await api.get("/admin/catalogue/plans", owner.token)).status).toBe(403);
  });
});
