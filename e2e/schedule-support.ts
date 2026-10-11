import { expect, type Locator, type Page } from "@playwright/test";
import { call, ready } from "./support.ts";

/**
 * The schedule screen as an owner reads it: the usual hours as one card, the
 * days that differ as rows that open one day in a sheet, and one pinned save.
 * Journeys check the store afterwards — what was saved is what matters.
 */

/** Signed in with this token, on the schedule, its first view loaded. */
export const openTheSchedule = async (page: Page, token: string, businessId: string) => {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key as string, value as string), ["tor-now.session", token]);
  await page.goto(`/manage?business=${businessId}`);
  await ready(page);
  await page.getByRole("button", { name: "לוח זמנים" }).click();
  await expect(usualCard(page)).toBeVisible({ timeout: 15_000 });
  return usualCard(page);
};

/** The card of the hours most days keep — or, before any, the card that says none are set. */
export const usualCard = (page: Page): Locator =>
  page.locator(".week-card").filter({ has: page.getByRole("heading", { name: /^(השעות הרגילות|עוד לא נקבעו שעות|Usual hours|No hours set yet)$/ }) });

/** The days that differ, one row each. */
export const otherDays = (page: Page): Locator => page.getByRole("list", { name: "ימים עם שעות אחרות" });

/** A day's row, by its name: "שישי". */
export const dayRow = (page: Page, day: string): Locator => page.getByRole("button", { name: `השעות של יום ${day}` });

/** The one day's sheet a row opens. */
export const daySheet = (page: Page): Locator => page.getByRole("dialog");

/** A row opened, its sheet returned. */
export const openDay = async (page: Page, day: string): Promise<Locator> => {
  await dayRow(page, day).click();
  const sheet = daySheet(page);
  await expect(sheet.getByRole("heading", { name: day })).toBeVisible();
  return sheet;
};

/** "אישור": the sheet closes, its edits already the week's. */
export const confirmDay = async (page: Page) => {
  await daySheet(page).getByRole("button", { name: "אישור" }).click();
  await expect(daySheet(page)).toBeHidden();
};

export const times = (scope: Locator): Locator => scope.locator('input[type="time"]');

export const saveButton = (page: Page): Locator => page.getByRole("button", { name: "שמירת השעות" });

/**
 * "שמירת השעות", waited for at the request rather than at the line under it:
 * that line from an earlier save could already be showing.
 */
export const saveTheHours = async (page: Page) => {
  const written = page.waitForResponse(
    (response) => response.url().includes("working-hours") && response.request().method() === "PUT",
    { timeout: 15_000 },
  );
  await saveButton(page).click();
  expect((await written).status()).toBe(200);
  await expect(page.getByText("השעות נשמרו")).toBeVisible({ timeout: 15_000 });
};

/** What the store holds for a calendar, by weekday, as "09:00-17:00". */
export const storedWeekOf = async (shop: { business: { id: string }; owner: { token: string } }, resourceId: string) => {
  const week = await call<{ dayOfWeek: number; start: string; end: string }[]>(
    `/businesses/${shop.business.id}/resources/${resourceId}/working-hours`,
    { token: shop.owner.token },
  );
  return (dayOfWeek: number) =>
    week
      .filter((entry) => entry.dayOfWeek === dayOfWeek)
      .map((entry) => `${entry.start}-${entry.end}`)
      .sort();
};

/** A week written straight through the API: these hours on these days, nothing on the rest. */
export const aWeekOf = (
  shop: { business: { id: string }; owner: { token: string } },
  resourceId: string,
  days: Readonly<Record<number, readonly { start: string; end: string }[]>>,
) =>
  call(`/businesses/${shop.business.id}/resources/${resourceId}/working-hours`, {
    method: "PUT",
    token: shop.owner.token,
    body: { week: Object.entries(days).flatMap(([day, ranges]) => ranges.map((range) => ({ dayOfWeek: Number(day), ...range }))) },
  });

/** The changes view, on the chip named — "כל העסק" or a calendar. */
export const showChangesOf = async (page: Page, whose?: string) => {
  await page.getByRole("tab", { name: "שינויים" }).click();
  if (whose !== undefined) await page.getByRole("group", { name: "של מי השינויים" }).getByRole("button", { name: whose }).click();
};

export const changeRows = (page: Page): Locator => page.getByRole("list", { name: "השינויים" }).getByRole("listitem");
