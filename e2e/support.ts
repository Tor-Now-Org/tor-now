import postgres from "postgres";
import { expect, type Locator, type Page } from "@playwright/test";

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

/**
 * The next time this business actually offers, whichever day that falls on.
 *
 * Journeys used to take the first slot on the day the screen opens, which made
 * them depend on the hour the suite happened to run: ADR 0002's minimum notice
 * pushes the earliest bookable time an hour out, so from late evening "today"
 * has nothing left and every booking journey failed about the clock rather than
 * the product. A customer in that position taps the next day, so the tests do
 * too.
 */
export const theNextOfferedTime = async (
  page: Page,
  /**
   * How many times the day has to offer, for a journey that needs more than
   * one of them.
   *
   * A test that books a slot and then wants another on the same day was taking
   * the first day with *a* slot, which late in the evening is today with one or
   * two left — and the second booking then had nothing to take. That is the
   * clock the suite happened to run on, not the product, and it failed the same
   * two journeys every night. Asking for the room up front moves them to
   * tomorrow, which a business open all day always has.
   */
  atLeast = 1,
): Promise<{ time: Locator; day: number }> => {
  const times = page.locator("[role=radio]", { hasText: /^\d\d:\d\d$/ });

  for (let day = 0; day < DAYS_TO_TRY; day += 1) {
    await showDay(page, day);
    // Wait for the day to have answered — times, or the screen saying there are
    // none — so a slow answer is never read as an empty one.
    await expect(times.first().or(page.getByText(NO_TIMES))).toBeVisible({
      timeout: SLOTS_APPEAR_WITHIN,
    });
    if ((await times.count()) >= atLeast) return { time: times.first(), day };
  }
  throw new Error(
    `No day in the next ${DAYS_TO_TRY} offered ${atLeast} times or more.`,
  );
};

/** Select one day of the strip by its distance from today. */
export const showDay = async (page: Page, day: number): Promise<void> => {
  if (day === 0) return;
  await page.getByRole("radiogroup", { name: TODAY }).getByRole("radio").nth(day).click();
};

/** What the screen says instead of times. */
const NO_TIMES = "אין תורים פנויים ביום הזה";

/** The date strip names itself with the word on its first day. */
const TODAY = "היום";
/** Enough to clear a closed evening and a full tomorrow; short enough to fail fast. */
const DAYS_TO_TRY = 3;
const SLOTS_APPEAR_WITHIN = 15_000;

/**
 * The next start time this business offers, looking past today.
 *
 * Same reason as theNextOfferedTime, for the journeys that set an appointment
 * up through the API rather than the screen: asking only about today gives an
 * empty answer every evening, and the test then books `undefined`.
 */
export const theNextStart = async (shop: {
  business: { id: string };
  service: { id: string };
  resource: { id: string };
}): Promise<string> => {
  const days = await call<{ slots: { startAt: string }[] }[]>(
    `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
      `&resourceId=${shop.resource.id}&from=${aDayFromNow(0)}&to=${aDayFromNow(DAYS_TO_TRY - 1)}`,
  );
  const startAt = days.flatMap((day) => day.slots)[0]?.startAt;
  if (startAt === undefined) {
    throw new Error(`No time was offered in the next ${DAYS_TO_TRY} days.`);
  }
  return startAt;
};

/**
 * A calendar day in the business's timezone, which is what the availability
 * window is expressed in — not the machine's, which may be somewhere else.
 */
export const aDayFromNow = (days: number): string => {
  const when = new Date();
  when.setDate(when.getDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIMEZONE }).format(when);
};

const BUSINESS_TIMEZONE = "Asia/Jerusalem";

/**
 * Bring the day strip to the day an appointment actually falls on.
 *
 * Both calendars open on today. Once the journeys stopped assuming today has a
 * free slot, the appointment they set up can be tomorrow's, and a screen still
 * showing today would correctly show nothing.
 */
export const showTheDayOf = async (page: Page, startAt: string): Promise<void> => {
  const wanted = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIMEZONE }).format(
    new Date(startAt),
  );
  for (let day = 0; day < DAYS_TO_TRY; day += 1) {
    if (aDayFromNow(day) !== wanted) continue;
    if (day > 0) {
      await page.getByRole("radiogroup", { name: TODAY }).getByRole("radio").nth(day).click();
    }
    return;
  }
  throw new Error(`${wanted} is not among the next ${DAYS_TO_TRY} days on the strip.`);
};

/**
 * The start time behind a slot the screen is showing.
 *
 * Booking "the API's first slot" and then asserting about the screen's first
 * slot assumes the two agree. They need not: the screen filters what it offers,
 * so the API's earliest can be one the customer was never shown, and taking it
 * removes nothing visible. Reading the time off the screen and finding that
 * exact slot keeps the test about what a person can see.
 */
export const theStartShownAs = async (
  shop: { business: { id: string }; service: { id: string }; resource: { id: string } },
  label: string,
  day: number,
): Promise<string> => {
  // One day, not the whole window. A business open daily offers the same clock
  // time on every one of them, so searching the window and taking the first
  // match booked today's 09:00 while the screen was showing tomorrow's — the
  // day under test then lost nothing, and the count came back unchanged.
  const on = aDayFromNow(day);
  const days = await call<{ slots: { startAt: string }[] }[]>(
    `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
      `&resourceId=${shop.resource.id}&from=${on}&to=${on}`,
  );
  const asShown = new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
  const found = days
    .flatMap((day) => day.slots)
    .find((slot) => asShown.format(new Date(slot.startAt)) === label);
  if (found === undefined) throw new Error(`No slot on ${on} reads as ${label}.`);
  return found.startAt;
};

/** Waits for the app shell to have finished its first data load. */
export const ready = async (page: Page): Promise<void> => {
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator(".spinner")).toHaveCount(0, { timeout: 20_000 });
};
