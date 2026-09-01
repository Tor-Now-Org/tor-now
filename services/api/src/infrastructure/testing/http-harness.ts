import { Hono } from "hono";
import type { Config } from "../../config.ts";
import { createApp } from "../../http/app.ts";
import { harness, type Harness } from "./harness.ts";

/**
 * The Hono app, wired to the in-memory application. Hono's `app.request` runs
 * the whole stack — routing, the actor middleware, validation, serialisation
 * and error translation — without a socket, so these are real request tests.
 */
const testConfig: Config = {
  databaseUrl: "memory://tests",
  jwtSecret: "x".repeat(32),
  jwtSecretSource: "SUPABASE_JWT_SECRET",
  verificationTransport: "LOG",
  notificationTransport: "LOG",
  twilio: null,
  exposeVerificationCode: true,
  exposeInternalErrors: true,
  corsOrigins: [],
};

const JOB_SECRET = "test-job-secret";

export const httpHarness = () => {
  const test: Harness = harness();

  // Mounted under /api exactly as index.ts does, so the paths under test are
  // the paths Supabase actually serves.
  const app = new Hono();
  app.route("/api", createApp({
    ...test.services,
    config: testConfig,
    tokens: test.tokens,
    jobCredential: { async read() { return JOB_SECRET; } },
    pruneAuditLog: () => Promise.resolve(0),
    deactivateLapsedBusinesses: () =>
      test.services.admin.deactivateLapsedBusinesses({ kind: "SYSTEM" }),
  }));

  const call = async (
    method: string,
    path: string,
    options: { body?: unknown; token?: string } = {},
  ) => {
    const response = await app.request(`/api${path}`, {
      method,
      headers: {
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(options.token === undefined
          ? {}
          : { Authorization: `Bearer ${options.token}` }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: (text === "" ? null : JSON.parse(text)) as unknown,
    };
  };

  return {
    ...test,
    jobSecret: JOB_SECRET,
    get: (path: string, token?: string) =>
      call("GET", path, token === undefined ? {} : { token }),
    post: (path: string, body?: unknown, token?: string) =>
      call("POST", path, { ...(body === undefined ? {} : { body }), ...(token === undefined ? {} : { token }) }),
    patch: (path: string, body: unknown, token?: string) =>
      call("PATCH", path, { body, ...(token === undefined ? {} : { token }) }),
    put: (path: string, body: unknown, token?: string) =>
      call("PUT", path, { body, ...(token === undefined ? {} : { token }) }),
    delete: (path: string, token?: string) =>
      call("DELETE", path, token === undefined ? {} : { token }),
  };
};

export type HttpHarness = ReturnType<typeof httpHarness>;

/** Signs in over HTTP, so the token is one the middleware will actually accept. */
export const signInOverHttp = async (
  api: HttpHarness,
  phone: string,
  name: string | null = "Tester",
): Promise<{ token: string; userId: string }> => {
  await api.post("/auth/request-code", { phone });
  const { body } = await api.post("/auth/verify", { phone, code: "111111", name });
  const session = body as { token: string; user: { id: string } };
  return { token: session.token, userId: session.user.id };
};
