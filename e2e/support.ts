import postgres from "postgres";
import { expect, type Page } from "@playwright/test";

/**
 * The interactions the canvas declared, expressed once so the specs read as
 * journeys rather than as selector soup.
 *
 * Everything is found by what a person sees — a heading, a label, a button's
 * words — so a change that breaks a test is a change a user would also notice.
 */

export const API_URL =
  process.env["E2E_API_URL"] ?? "http://127.0.0.1:8787/api";

/**
 * The database the stack under test is running on. A few setup steps have no
 * API by design — ADR 0010 gives the administrator flag no self-service route
 * at all, and seeds the first one by migration — so the suite does the same
 * thing that migration does rather than the API growing a test-only endpoint.
 */
const databaseUrl = process.env["TEST_DATABASE_URL"];

let pool: ReturnType<typeof postgres> | null = null;
const database = () => {
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error("TEST_DATABASE_URL is required for the end-to-end suite");
  }
  pool ??= postgres(databaseUrl, { prepare: false, max: 2, onnotice: () => {} });
  return pool;
};

export const closeDatabase = async (): Promise<void> => {
  await pool?.end({ timeout: 5 });
  pool = null;
};

/**
 * Drags an appointment back a day.
 *
 * A test cannot stand on the far side of an appointment any other way: the
 * booking window refuses a past time from outside, and waiting for a real one
 * to pass is not a test. This is the one place the suite writes to a table
 * directly, and it does so to reproduce the only thing that ever puts an
 * appointment in the past — time going by.
 */
export const movedIntoThePast = async (appointmentId: string): Promise<void> => {
  const sql = database();
  const at = (minutes: number) =>
    new Date(Date.now() - 24 * 60 * 60 * 1000 + minutes * 60 * 1000).toISOString();
  await sql`
    update appointment
    set start_at = ${at(0)}, end_at = ${at(30)}, occupied_until = ${at(40)}
    where id = ${appointmentId}`;
};

/**
 * Sets both conditions ADR 0010 requires: the flag on the User and the number
 * on the allowlist. Either alone is deliberately not enough, which the sign-in
 * tests rely on.
 */
export const makeAdministrator = async (phone: string): Promise<void> => {
  const sql = database();
  await sql`update app_user set is_administrator = true where phone = ${phone}`;
  await sql`
    insert into administrator_allowlist (phone, note)
    values (${phone}, 'end-to-end suite')
    on conflict (phone) do nothing`;
};

/** A phone number nobody else in the run will use. */
export const uniquePhone = (): string =>
  `+9725${String(Math.floor(Math.random() * 100_000_000)).padStart(8, "0")}`;

/**
 * The same number as a person types it.
 *
 * The sign-in field shows the country as a flag and takes only the nine digits
 * after it, so a test that fills it with E.164 is typing something no customer
 * ever would — and the field rightly refuses it. The API still speaks E.164, so
 * the two forms have to come from one number.
 *
 * Only that field: a business's own phone number is typed in full.
 */
export const asTyped = (e164: string): string => e164.replace(PHONE_DIAL_CODE, "");

/** The interface prints this beside the field instead of asking for it. */
const PHONE_DIAL_CODE = "+972";

export const call = async <T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.token === undefined ? {} : { Authorization: `Bearer ${options.token}` }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  if (!response.ok) {
    throw new Error(`${path} → ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
};

/**
 * Signs in through the API and plants the session the app expects, so a spec
 * about the owner's calendar does not have to re-test the sign-in screen.
 * The sign-in screen has its own spec.
 */
/** The two halves the screens ask for, from one test-friendly string. */
const splitName = (name: string) => {
  const [givenName, ...rest] = name.split(" ").filter((part) => part !== "");
  return {
    givenName: givenName ?? name,
    familyName: rest.length === 0 ? null : rest.join(" "),
  };
};

export const signInDirectly = async (
  page: Page,
  phone: string,
  name: string,
): Promise<{ token: string; userId: string }> => {
  const { code } = await call<{ code: string }>("/auth/request-code", {
    method: "POST",
    body: { phone },
  });
  const session = await call<{ token: string; user: { id: string } }>("/auth/verify", {
    method: "POST",
    body: { phone, code, name: splitName(name) },
  });

  await page.addInitScript(
    ([key, token]) => window.localStorage.setItem(key as string, token as string),
    ["tor-now.session", session.token],
  );
  return { token: session.token, userId: session.user.id };
};

export const useEnglish = async (page: Page): Promise<void> => {
  await page.addInitScript(
    ([key, language]) => window.localStorage.setItem(key as string, language as string),
    ["tor-now.language", "en"],
  );
};

/** A business with hours on every weekday, so any day the test picks is open. */
/**
 * Open now, whatever "now" is.
 *
 * The default window is the whole day on purpose: journeys that book "the next
 * offered time" have to find one, and a fixture that closed at 20:00 made the
 * whole suite fail after eight in the evening — a failure about the clock the
 * machine happened to be running on, not about the product. A test that is
 * actually about opening hours passes its own.
 */
const ALL_DAY = Object.freeze({ start: "00:00", end: "23:59" });

export const aBusinessWithOpenHours = async (options: {
  name: string;
  ownerPhone: string;
  serviceName?: string;
  durationMinutes?: number;
  hours?: { start: string; end: string };
}) => {
  const { code } = await call<{ code: string }>("/auth/request-code", {
    method: "POST",
    body: { phone: options.ownerPhone },
  });
  const owner = await call<{ token: string; user: { id: string } }>("/auth/verify", {
    method: "POST",
    body: { phone: options.ownerPhone, code, name: splitName("בעלים") },
  });

  const business = await call<{ id: string; name: string }>("/businesses", {
    method: "POST",
    token: owner.token,
    body: {
      name: options.name,
      phone: options.ownerPhone,
      description: null,
      address: "רחוב הבדיקה 1",
      resourceNames: ["יומן א"],
      services: [
        {
          name: options.serviceName ?? "תספורת",
          durationMinutes: options.durationMinutes ?? 30,
          priceMinor: 8000,
          bufferMinutes: null,
        },
      ],
      workingHours: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        dayOfWeek,
        ...(options.hours ?? ALL_DAY),
      })),
    },
  });

  const profile = await call<{
    services: { id: string; name: string }[];
    resources: { id: string; name: string }[];
  }>(`/businesses/${business.id}`);

  return {
    owner,
    business,
    service: profile.services[0]!,
    resource: profile.resources[0]!,
  };
};

/** Waits for the app shell to have finished its first data load. */
export const ready = async (page: Page): Promise<void> => {
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator(".spinner")).toHaveCount(0, { timeout: 20_000 });
};
