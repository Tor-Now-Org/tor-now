import { expect, test, type Page } from "@playwright/test";
import {
  aBusinessWithOpenHours,
  aDayFromNow,
  call,
  database,
  localDayOf,
  movedIntoThePast,
  ready,
  signInDirectly,
  theNextStart,
  uniquePhone,
} from "./support.ts";
import { anAdministrator } from "./cost-support.ts";

/**
 * Statistics, a Feature: where the plan gives it, the owner has a tab for it
 * and the customer list moves into the Business tab; where it does not,
 * nothing changes.
 */

const aShop = async (statistics: boolean) => {
  const shop = await aBusinessWithOpenHours({ name: `סטטיסטיקה ${Date.now()}`, ownerPhone: uniquePhone() });
  if (statistics) {
    await call(`/admin/businesses/${shop.business.id}/grants`, {
      method: "POST",
      token: await anAdministrator(),
      body: { features: ["STATISTICS"], endsOn: aDayFromNow(30), reason: "בדיקת סטטיסטיקות" },
    });
  }
  return shop;
};

/**
 * The business opened some months ago, as time going by would leave it.
 * Written directly for the reason `movedIntoThePast` is: a test cannot wait.
 */
const openedMonthsAgo = async (businessId: string, months: number): Promise<void> => {
  const sql = database();
  await sql`
    update business set created_at = now() - make_interval(months => ${months})
    where id = ${businessId}`;
};

/** A customer books the next time the shop offers; the appointment's id comes back. */
const aBooking = async (shop: Awaited<ReturnType<typeof aShop>>) => {
  const phone = uniquePhone();
  const { code } = await call<{ code: string }>("/auth/request-code", { method: "POST", body: { phone } });
  const customer = await call<{ token: string }>("/auth/verify", {
    method: "POST",
    body: { phone, code, name: { givenName: "דנה", familyName: "כהן" } },
  });
  return call<{ id: string }>("/appointments", {
    method: "POST",
    token: customer.token,
    body: {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: await theNextStart(shop),
      customerNote: null,
    },
  });
};

const openAsOwner = async (page: Page, token: string, path = "/manage") => {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    ["tor-now.session", token],
  );
  await page.goto(path);
  await ready(page);
};

const sectionsOf = (page: Page) => page.getByRole("navigation", { name: "Sections" });
const tile = (page: Page, label: string) => page.locator(".st-tile", { hasText: label });

test.describe("statistics", () => {
  test("an owner whose plan gives it reads the month, and finds customers under the business", async ({ page }) => {
    const shop = await aShop(true);
    await aBooking(shop);

    await openAsOwner(page, shop.owner.token);
    await expect(sectionsOf(page).getByRole("button", { name: "לקוחות" })).toHaveCount(0);

    await sectionsOf(page).getByRole("button", { name: "סטטיסטיקות" }).click();
    await expect(page.getByText("תורים יום אחר יום")).toBeVisible({ timeout: 20_000 });
    await expect(tile(page, "תורים שהתקיימו")).toBeVisible();
    // Opened today: there is no month before this one, and none after.
    await expect(page.getByRole("button", { name: "החודש הקודם" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "החודש הבא" })).toBeDisabled();

    await sectionsOf(page).getByRole("button", { name: "העסק" }).click();
    await page.getByRole("button", { name: "לקוחות", exact: true }).click();
    await expect(page.getByText("דנה כהן")).toBeVisible({ timeout: 20_000 });
  });

  test("a visit that has happened is counted, and its customer opens from the list", async ({ page }) => {
    const shop = await aShop(true);
    await openedMonthsAgo(shop.business.id, 2);
    const booking = await aBooking(shop);
    await movedIntoThePast(booking.id);
    // Moved to a day ago, which on the first of a month is last month.
    const month = localDayOf(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).slice(0, 7);

    await openAsOwner(page, shop.owner.token, `/manage?business=${shop.business.id}&tab=statistics&month=${month}`);
    await expect(tile(page, "תורים שהתקיימו")).toContainText("1", { timeout: 20_000 });
    await expect(tile(page, "הכנסות")).toContainText("80");
    await expect(tile(page, "לקוחות חדשים")).toContainText("1");

    await page.locator(".st-people").getByRole("button", { name: /דנה כהן/ }).click();
    await page.waitForURL(/\/manage\/customers\//);
    // The customer page's way back is named for where it goes.
    await page.getByRole("button", { name: "לקוחות" }).first().click();

    // Back to the list it came from — which now lives under the business.
    await expect(page.getByRole("button", { name: "לקוחות", exact: true })).toHaveAttribute("aria-pressed", "true", {
      timeout: 20_000,
    });
    await expect(page.getByText("דנה כהן")).toBeVisible();
    await expect(sectionsOf(page).getByRole("button", { name: "סטטיסטיקות" })).toBeVisible();
  });

  test("while the month runs, one line above the tiles names the days compared", async ({ page }) => {
    const shop = await aShop(true);
    await openedMonthsAgo(shop.business.id, 1);

    await openAsOwner(page, shop.owner.token, `/manage?business=${shop.business.id}&tab=statistics`);
    await expect(page.locator(".st-so-far")).toHaveText(/^השוואה של 1/, { timeout: 20_000 });
  });

  test("goes back to the month the business opened, and no further", async ({ page }) => {
    const shop = await aShop(true);
    await openedMonthsAgo(shop.business.id, 2);

    await openAsOwner(page, shop.owner.token, `/manage?business=${shop.business.id}&tab=statistics`);
    const previous = page.getByRole("button", { name: "החודש הקודם" });
    const next = page.getByRole("button", { name: "החודש הבא" });
    await expect(next).toBeDisabled({ timeout: 20_000 });

    await previous.click();
    await expect(page).toHaveURL(/month=\d{4}-\d{2}/);
    await previous.click();
    await expect(previous).toBeDisabled();
    await expect(next).toBeEnabled();
    // Three months to choose from, each saying its year.
    const list = page.getByRole("combobox", { name: "בחירת חודש" });
    await expect(list.locator("option")).toHaveCount(3);
    await expect(list).toContainText(/20\d\d/);
  });

  test("one calendar at a time, once there is more than one", async ({ page }) => {
    const shop = await aShop(true);
    await call(`/businesses/${shop.business.id}/resources`, {
      method: "POST",
      token: shop.owner.token,
      body: { name: "יומן ב" },
    });

    await openAsOwner(page, shop.owner.token, `/manage?business=${shop.business.id}&tab=statistics`);
    await expect(page.getByText("לפי יומן")).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "יומן ב", exact: true }).click();
    await expect(page.getByRole("button", { name: "יומן ב", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("לפי יומן")).toBeHidden({ timeout: 20_000 });
  });

  test("a manager has no statistics, and finds customers under the business", async ({ page }) => {
    const shop = await aShop(true);
    const managerPhone = uniquePhone();
    await call(`/businesses/${shop.business.id}/users`, {
      method: "POST",
      token: shop.owner.token,
      body: { phone: managerPhone, givenName: "מנהלת", familyName: null, role: "MANAGER" },
    });

    await signInDirectly(page, managerPhone, "מנהלת");
    await page.goto(`/manage?business=${shop.business.id}&tab=statistics`);
    await ready(page);

    // Asked for statistics, shown the calendar.
    await expect(sectionsOf(page).getByRole("button", { name: "היומן" })).toHaveAttribute("aria-current", "page", {
      timeout: 20_000,
    });
    await expect(sectionsOf(page).getByRole("button", { name: "סטטיסטיקות" })).toHaveCount(0);
    await expect(sectionsOf(page).getByRole("button", { name: "לקוחות" })).toHaveCount(0);

    await sectionsOf(page).getByRole("button", { name: "העסק" }).click();
    await expect(page.getByRole("button", { name: "לקוחות", exact: true })).toBeVisible();
  });

  test("without it, the bar keeps its customers tab and has no statistics", async ({ page }) => {
    const shop = await aShop(false);
    await openAsOwner(page, shop.owner.token, `/manage?business=${shop.business.id}&tab=statistics`);

    await expect(sectionsOf(page).getByRole("button", { name: "לקוחות" })).toBeVisible({ timeout: 20_000 });
    await expect(sectionsOf(page).getByRole("button", { name: "סטטיסטיקות" })).toHaveCount(0);
    // An old link to the tab lands on the calendar rather than an empty screen.
    await expect(sectionsOf(page).getByRole("button", { name: "היומן" })).toHaveAttribute("aria-current", "page");
  });
});
