import { beforeEach, describe, expect, it } from "vitest";
import {
  A_BUSINESS,
  httpHarness,
  signInOverHttp,
  type HttpHarness,
} from "../infrastructure/testing/http-harness.ts";

/**
 * "שינוי ביומן" over HTTP: what each route takes, what it answers, and what it
 * refuses. The rules themselves are the service's and are covered there; these
 * prove the wire carries them — ids with colons in a path, hours as HH:MM, a
 * worker's 403 for the whole business, and a 400 for a body that is wrong.
 */

const TUESDAY = "2026-09-01";
const WEDNESDAY = "2026-09-02";

type Change = {
  id: string;
  scope: { kind: string; resourceId?: string };
  outcome: string;
  fromDate: string;
  toDate: string;
  days: { date: string; ranges: { start: string; end: string }[] }[];
  ranges: { start: string; end: string }[] | null;
  note: string | null;
};

describe("the change routes", () => {
  let api: HttpHarness;
  let token: string;
  let businessId: string;
  let resourceId: string;
  let base: string;

  beforeEach(async () => {
    api = httpHarness();
    token = (await signInOverHttp(api, "+972500000001", "רן")).token;
    // Team, so a worker can be put on a calendar.
    businessId = ((await api.post("/businesses", { ...A_BUSINESS, plan: "TEAM" }, token)).body as { id: string }).id;
    resourceId = ((await api.get(`/businesses/${businessId}/resources`, token)).body as { id: string }[])[0]!.id;
    base = `/businesses/${businessId}/changes`;
  });

  const make = (body: Record<string, unknown>) =>
    api.post(base, { fromDate: TUESDAY, toDate: TUESDAY, ranges: [], upcoming: "KEEP", ...body }, token);
  const listed = async () => (await api.get(`${base}?from=${TUESDAY}&to=${WEDNESDAY}`, token)).body as Change[];

  it("makes a change, lists it with its hours as the clock says them, and reads it by id", async () => {
    const made = await make({
      scope: { kind: "CALENDAR", resourceId },
      outcome: "OFF_PART",
      ranges: [{ start: "12:00", end: "13:30" }],
      note: "רופא שיניים",
    });
    expect(made).toMatchObject({ status: 201, body: { days: 1, calendars: 1, cancelled: 0 } });

    const [change] = await listed();
    expect(change).toEqual({
      id: expect.stringMatching(/^blocks:/),
      scope: { kind: "CALENDAR", resourceId },
      outcome: "OFF_PART",
      fromDate: TUESDAY,
      toDate: TUESDAY,
      days: [{ date: TUESDAY, ranges: [{ start: "12:00", end: "13:30" }] }],
      ranges: [{ start: "12:00", end: "13:30" }],
      note: "רופא שיניים",
    });

    const read = await api.get(`${base}/${encodeURIComponent(change!.id)}`, token);
    expect(read).toMatchObject({ status: 200, body: change });
  });

  it("previews who it strands, what it replaces and the usual hours", async () => {
    const { status, body } = await api.post(
      `${base}/preview`,
      { scope: { kind: "BUSINESS" }, fromDate: TUESDAY, toDate: TUESDAY, outcome: "OTHER_HOURS", ranges: [{ start: "09:00", end: "12:00" }] },
      token,
    );
    expect(status).toBe(200);
    expect(body).toEqual({ days: 1, calendars: 1, appointments: [], replaces: [], usual: [{ start: "09:00", end: "17:00" }], sameAsUsual: false });
  });

  it("says when other hours are the usual ones, and refuses to save them", async () => {
    const plan = { scope: { kind: "BUSINESS" }, fromDate: TUESDAY, toDate: TUESDAY, outcome: "OTHER_HOURS", ranges: [{ start: "09:00", end: "17:00" }] };
    expect((await api.post(`${base}/preview`, plan, token)).body).toMatchObject({ sameAsUsual: true });
    const refused = await make(plan);
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
    expect(await listed()).toEqual([]);
  });

  it("previews with the outcome still unanswered", async () => {
    const { status, body } = await api.post(
      `${base}/preview`,
      { scope: { kind: "CALENDAR", resourceId }, fromDate: TUESDAY, toDate: WEDNESDAY },
      token,
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({ days: 2, appointments: [], usual: [{ start: "09:00", end: "17:00" }] });
  });

  it("edits one change into another by naming it", async () => {
    await make({ scope: { kind: "BUSINESS" }, outcome: "OFF_ALL_DAY", note: "חג" });
    const [old] = await listed();
    // With one calendar the business's day is that calendar's day.
    expect(old).toMatchObject({ outcome: "OFF_ALL_DAY", scope: { kind: "CALENDAR", resourceId } });
    const edited = await make({
      scope: { kind: "CALENDAR", resourceId },
      outcome: "OTHER_HOURS",
      ranges: [{ start: "10:00", end: "12:00" }],
      replacing: old!.id,
    });
    expect(edited.status).toBe(201);
    expect((await listed()).map((change) => change.outcome)).toEqual(["OTHER_HOURS"]);
  });

  it("removes one day by its date, then the rest", async () => {
    await make({ scope: { kind: "CALENDAR", resourceId }, outcome: "OFF_ALL_DAY", toDate: WEDNESDAY });
    const [change] = await listed();
    const path = `${base}/${encodeURIComponent(change!.id)}`;
    expect(await api.delete(`${path}?date=${WEDNESDAY}`, token)).toEqual({ status: 200, body: { removed: 1 } });
    const [left] = await listed();
    expect(left?.days.map((day) => day.date)).toEqual([TUESDAY]);
    expect(await api.delete(`${base}/${encodeURIComponent(left!.id)}`, token)).toEqual({ status: 200, body: { removed: 1 } });
    expect(await listed()).toEqual([]);
  });

  it("answers 404 for an id that names nothing", async () => {
    expect((await api.get(`${base}/${encodeURIComponent("blocks:missing")}`, token)).status).toBe(404);
    expect((await api.delete(`${base}/nonsense`, token)).status).toBe(404);
  });

  it.each([
    ["no scope", { outcome: "OFF_ALL_DAY" }],
    ["a scope nobody knows", { scope: { kind: "EVERYONE" }, outcome: "OFF_ALL_DAY" }],
    ["a calendar that is not an id", { scope: { kind: "CALENDAR", resourceId: "chair-1" }, outcome: "OFF_ALL_DAY" }],
    ["an outcome nobody knows", { scope: { kind: "BUSINESS" }, outcome: "CLOSED" }],
    ["hours that are not a clock", { scope: { kind: "BUSINESS" }, outcome: "OTHER_HOURS", ranges: [{ start: "9", end: "12:00" }] }],
    ["a day that is not a date", { scope: { kind: "BUSINESS" }, outcome: "OFF_ALL_DAY", fromDate: "tuesday" }],
    ["no answer for the people booked", { scope: { kind: "BUSINESS" }, outcome: "OFF_ALL_DAY", upcoming: undefined }],
    ["hours that end before they start", { scope: { kind: "BUSINESS" }, outcome: "OTHER_HOURS", ranges: [{ start: "12:00", end: "09:00" }] }],
  ])("refuses %s", async (_name, body) => {
    const { status, body: answer } = await make(body);
    expect(status).toBe(400);
    expect(answer).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });

  it("refuses a list without its dates", async () => {
    expect((await api.get(base, token)).status).toBe(400);
  });

  it("refuses a worker the whole business with 403, and lets them keep their own calendar", async () => {
    const workerPhone = "+972500000077";
    const worker = await signInOverHttp(api, workerPhone, "דנה");
    const invited = await api.post(
      `/businesses/${businessId}/users`,
      { phone: workerPhone, givenName: "דנה", familyName: null, role: "WORKER", resourceIds: [resourceId] },
      token,
    );
    expect(invited.status, JSON.stringify(invited.body)).toBeLessThan(300);
    const asWorker = (body: Record<string, unknown>) =>
      api.post(base, { fromDate: TUESDAY, toDate: TUESDAY, ranges: [], upcoming: "KEEP", ...body }, worker.token);

    expect((await asWorker({ scope: { kind: "BUSINESS" }, outcome: "OFF_ALL_DAY" })).status).toBe(403);
    expect((await asWorker({ scope: { kind: "CALENDAR", resourceId }, outcome: "OFF_ALL_DAY" })).status).toBe(201);
  });

  it("refuses somebody signed out", async () => {
    expect((await api.get(`${base}?from=${TUESDAY}&to=${TUESDAY}`)).status).toBe(401);
  });
});
