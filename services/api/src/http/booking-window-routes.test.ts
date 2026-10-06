import { beforeEach, describe, expect, it } from "vitest";
import {
  A_BUSINESS,
  httpHarness,
  signInOverHttp,
  type HttpHarness,
} from "../infrastructure/testing/http-harness.ts";

/**
 * ADR 0026 over HTTP: how many days one availability request may ask for, what
 * each day says about the window, and the settings an owner cannot save
 * because nobody could book in them.
 */

describe("asking for a span of days", () => {
  let api: HttpHarness;
  let businessId: string;
  let serviceId: string;
  let resourceId: string;

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
  });

  const days = (from: string, to: string) =>
    api.get(
      `/businesses/${businessId}/availability?serviceId=${serviceId}&resourceId=${resourceId}&from=${from}&to=${to}`,
    );

  it("answers a month of days in one request", async () => {
    const { status, body } = await days("2026-09-01", "2026-10-01");
    expect(status).toBe(200);
    expect(body).toHaveLength(31);
  });

  it("refuses more than a month", async () => {
    const { status, body } = await days("2026-09-01", "2026-10-02");
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });

  it("refuses a span that ends before it starts", async () => {
    const { status } = await days("2026-09-02", "2026-09-01");
    expect(status).toBe(400);
  });

  it("answers a single day", async () => {
    const { status, body } = await days("2026-09-01", "2026-09-01");
    expect(status).toBe(200);
    expect(body).toHaveLength(1);
  });

  it("caps the days a business page carries the same way", async () => {
    expect((await api.get(`/businesses/${businessId}?from=2026-09-01&to=2026-10-01`)).status).toBe(200);
    expect((await api.get(`/businesses/${businessId}?from=2026-09-01&to=2026-10-02`)).status).toBe(400);
    expect((await api.get(`/businesses/${businessId}?from=2026-09-02&to=2026-09-01`)).status).toBe(400);
  });

  it("says, for every day, whether hours open later as the window moves", async () => {
    const { body } = await days("2026-09-01", "2026-09-01");
    expect((body as { partlyBeyondHorizon: unknown }[])[0]).toMatchObject({
      partlyBeyondHorizon: false,
      emptyReason: null,
    });
  });
});

describe("the booking window an owner can save", () => {
  let api: HttpHarness;
  let businessId: string;
  let token: string;

  beforeEach(async () => {
    api = httpHarness();
    const owner = await signInOverHttp(api, "+972500000001", "רן");
    token = owner.token;
    businessId = ((await api.post("/businesses", A_BUSINESS, owner.token)).body as { id: string }).id;
  });

  const save = (changes: Record<string, unknown>) =>
    api.patch(`/businesses/${businessId}`, changes, token);

  it("refuses a notice longer than the horizon, naming why", async () => {
    const { status, body } = await save({ minimumNoticeMinutes: 7 * 24 * 60, bookingHorizonDays: 5 });
    expect(status).toBe(400);
    expect(body).toMatchObject({
      error: { code: "VALIDATION_FAILED", details: { reason: "NOTICE_BEYOND_HORIZON" } },
    });
  });

  it("refuses a notice alone that passes the horizon already saved", async () => {
    await save({ bookingHorizonDays: 2 });
    const { status } = await save({ minimumNoticeMinutes: 3 * 24 * 60 });
    expect(status).toBe(400);
  });

  it("refuses a horizon alone that falls inside the notice already saved", async () => {
    await save({ minimumNoticeMinutes: 3 * 24 * 60 });
    const { status } = await save({ bookingHorizonDays: 3 });
    expect(status).toBe(400);
  });

  it("keeps the saved settings when it refuses", async () => {
    await save({ minimumNoticeMinutes: 7 * 24 * 60, bookingHorizonDays: 5 });
    const { body } = await api.get(`/businesses/${businessId}`);
    expect((body as { business: Record<string, unknown> }).business).toMatchObject({
      minimumNoticeMinutes: 60,
      bookingHorizonDays: 60,
    });
  });

  it("saves a notice of several days within a longer horizon", async () => {
    const { status, body } = await save({ minimumNoticeMinutes: 3 * 24 * 60, bookingHorizonDays: 4 });
    expect(status).toBe(200);
    expect(body).toMatchObject({ minimumNoticeMinutes: 4320, bookingHorizonDays: 4 });
  });

  it("saves changes that do not touch the window at all", async () => {
    const { status } = await save({ name: "מספרת רן החדשה" });
    expect(status).toBe(200);
  });
});
