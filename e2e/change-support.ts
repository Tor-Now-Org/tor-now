import { expect, type Locator, type Page } from "@playwright/test";
import {
  aBusinessWithOpenHours,
  aDayFromNow,
  anInstantAt,
  aRunInOneMonth,
  call,
  ready,
  showTheMonthOf,
  uniquePhone,
} from "./support.ts";

/**
 * "שינוי ביומן" journeys: a shop with two calendars, the doors into the sheet,
 * and the answers a customer then gets — so every journey can check what was
 * stored by what is offered, not by what the screen happens to draw.
 */

export type Shop = Awaited<ReturnType<typeof aBusinessWithOpenHours>> & {
  second: { id: string; name: string };
};

/** Days so many from today that all fall in one month, so one grid shows them. */
export const daysInOneMonth = (count: number, earliest = 1): string[] => {
  const start = aRunInOneMonth(count, { earliest });
  return Array.from({ length: count }, (_unused, index) => aDayFromNow(start + index));
};

/**
 * Open 09:00–17:00 every day on "יומן א", and a second calendar, "שימי", which
 * starts with the first one's week — no week is saved again, because that marks
 * every day ahead for the waiting list and dozens of shops would bury the queue.
 */
export const aTwoCalendarShop = async (name: string): Promise<Shop> => {
  const shop = await aBusinessWithOpenHours({ name: `${name} ${Date.now()}`, ownerPhone: uniquePhone(), hours: { start: "09:00", end: "17:00" } });
  const second = await call<{ id: string; name: string }>(`/businesses/${shop.business.id}/resources`, {
    method: "POST",
    token: shop.owner.token,
    body: { name: "שימי" },
  });
  return { ...shop, second };
};

/** The start times a customer is offered on one calendar that day, by the shop's clock. */
export const offered = async (shop: Shop | Awaited<ReturnType<typeof aBusinessWithOpenHours>>, resourceId: string, date: string) => {
  const days = await call<{ slots: { startAt: string }[] }[]>(
    `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}&resourceId=${resourceId}&from=${date}&to=${date}`,
  );
  return (days[0]?.slots ?? []).map((slot) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false }).format(
      new Date(slot.startAt),
    ),
  );
};

export type ChangeRow = {
  id: string;
  scope: { kind: "BUSINESS" } | { kind: "CALENDAR"; resourceId: string };
  outcome: "OFF_ALL_DAY" | "OFF_PART" | "OTHER_HOURS";
  fromDate: string;
  toDate: string;
  days: { date: string; ranges: { start: string; end: string }[] }[];
  ranges: { start: string; end: string }[] | null;
  note: string | null;
};

export const changesOf = (shop: { business: { id: string }; owner: { token: string } }, from: string, to: string) =>
  call<ChangeRow[]>(`/businesses/${shop.business.id}/changes?from=${from}&to=${to}`, { token: shop.owner.token });

/** A change made straight through the API, for journeys about what is done with one afterwards. */
export const aChange = (
  shop: { business: { id: string }; owner: { token: string } },
  plan: {
    scope: ChangeRow["scope"];
    outcome: ChangeRow["outcome"];
    fromDate: string;
    toDate?: string;
    ranges?: { start: string; end: string }[];
    note?: string | null;
  },
  token = shop.owner.token,
) =>
  call(`/businesses/${shop.business.id}/changes`, {
    method: "POST",
    token,
    body: { toDate: plan.fromDate, ranges: [], note: null, upcoming: "KEEP", ...plan },
  });

/** A customer booked at a clock time, on one calendar. */
export const aBookingAt = async (shop: Shop | Awaited<ReturnType<typeof aBusinessWithOpenHours>>, resourceId: string, date: string, clock: string, name = "דנה כהן") => {
  const phone = uniquePhone();
  const { code } = await call<{ code: string }>("/auth/request-code", { method: "POST", body: { phone } });
  const [givenName, familyName = null] = name.split(" ");
  const customer = await call<{ token: string }>("/auth/verify", { method: "POST", body: { phone, code, name: { givenName, familyName } } });
  return call<{ id: string }>("/appointments", {
    method: "POST",
    token: customer.token,
    body: { businessId: shop.business.id, serviceId: shop.service.id, resourceId, startAt: anInstantAt(date, clock), customerNote: null },
  });
};

/** Somebody put on some calendars, signed in through the API. */
export const aMember = async (shop: Shop, role: "WORKER" | "MANAGER", resourceIds: string[], givenName = "דנה") => {
  const phone = uniquePhone();
  await call(`/businesses/${shop.business.id}/users`, {
    method: "POST",
    token: shop.owner.token,
    body: { phone, givenName, familyName: null, role, resourceIds },
  });
  const { code } = await call<{ code: string }>("/auth/request-code", { method: "POST", body: { phone } });
  const session = await call<{ token: string }>("/auth/verify", { method: "POST", body: { phone, code, name: { givenName, familyName: null } } });
  return { phone, token: session.token };
};

/** The manage screen, signed in with this token, on the business's month. */
export const openTheCalendar = async (page: Page, token: string, businessId: string) => {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key as string, value as string), ["tor-now.session", token]);
  await page.goto(`/manage?business=${businessId}`);
  await ready(page);
  await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });
};

/** The + door: "שינוי ביומן", then days tapped on the month, then the sheet. */
export const changeFromThePlus = async (page: Page, first: string, last: string = first) => {
  await page.getByRole("button", { name: "הוספה ליום" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^✎?\s*שינוי ביומן/ }).click();
  await expect(page.getByText("בחירת ימים לשינוי")).toBeVisible();
  await showTheMonthOf(page, first);
  await page.getByRole("button", { name: first }).click();
  if (last !== first) {
    await showTheMonthOf(page, last);
    await page.getByRole("button", { name: last }).click();
  }
  await page.getByRole("button", { name: "המשך" }).click();
  return theSheet(page);
};

/** The change sheet, wherever it was opened from. */
export const theSheet = async (page: Page): Promise<Locator> => {
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "שינוי ביומן" }) });
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  return sheet;
};

export const forWhom = (sheet: Locator) => sheet.getByRole("group", { name: "למי" });
export const outcome = (sheet: Locator, name: "לא עובדים כל היום" | "לא עובדים בחלק מהיום" | "עובדים בשעות אחרות") =>
  sheet.getByRole("radio", { name: new RegExp(`^${name}`) });

/** The hours of the first stretch, typed into the sheet's clocks. */
export const typeHours = async (sheet: Locator, from: string, until: string, position = 0) => {
  await sheet.getByLabel("מ־", { exact: true }).nth(position).fill(from);
  await sheet.getByLabel("עד", { exact: true }).nth(position).fill(until);
};

/** The sheet's sentence, once it says something. */
export const theSentence = (sheet: Locator) => sheet.locator(".change-sentence");

/** Saved: the sheet goes away once the API has answered. */
export const save = async (page: Page, sheet: Locator, label: string | RegExp = "שמירת השינוי") => {
  const written = page.waitForResponse(
    (response) => /\/changes$/.test(response.url()) && response.request().method() === "POST",
    { timeout: 15_000 },
  );
  await sheet.getByRole("button", { name: label }).click();
  expect((await written).status()).toBe(201);
  await expect(sheet).toBeHidden({ timeout: 15_000 });
};
