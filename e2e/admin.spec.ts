import { expect, test, type Page } from "@playwright/test";
import {
  aBusinessWithOpenHours,
  call,
  closeDatabase,
  makeAdministrator,
  ready,
  uniquePhone,
} from "./support.ts";

test.afterAll(async () => {
  await closeDatabase();
});

/**
 * The administrator artboard, and the two conditions ADR 0010 puts in front of
 * it. Every screen here runs over a connection that bypasses tenant isolation,
 * so "who is kept out" is as much the subject as "what is shown".
 */

const anAdministrator = async (): Promise<{ token: string; phone: string }> => {
  const phone = uniquePhone();
  const { code } = await call<{ code: string }>("/auth/request-code", {
    method: "POST",
    body: { phone },
  });
  const session = await call<{ token: string; user: { id: string } }>("/auth/verify", {
    method: "POST",
    body: { phone, code, name: { givenName: "הנהלה", familyName: null } },
  });

  // The flag and the allowlist are set out of band, exactly as the seeding
  // migration does — there is deliberately no self-service route to either.
  await makeAdministrator(phone);
  expect(session.user.id).toBeTruthy();

  const again = await call<{ code: string }>("/auth/request-code", {
    method: "POST",
    body: { phone },
  });
  const elevated = await call<{ token: string }>("/auth/verify", {
    method: "POST",
    body: { phone, code: again.code, name: null },
  });
  return { token: elevated.token, phone };
};

const SEARCH = "חיפוש לפי שם עסק, בעלים או טלפון";

const asAdministrator = async (page: Page, token: string): Promise<void> => {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    ["tor-now.session", token],
  );
  await page.goto("/admin");
  await ready(page);
};

/**
 * The suite's database holds every Business any run has made, so a journey
 * finds its own the way an administrator would: by typing its name.
 */
const findInDirectory = async (page: Page, name: string): Promise<void> => {
  await page.getByPlaceholder(SEARCH).fill(name);
  await expect(inDirectory(page, name)).toBeVisible({ timeout: 20_000 });
};

/** A Business's line in the directory: a table row on a desktop, a card on a phone. */
const inDirectory = (page: Page, name: string) =>
  page.locator(".dir-table tbody tr, .dir-card").filter({ hasText: name }).filter({ visible: true });

test.describe("who may reach the panel", () => {
  test("an ordinary session is shown the door, not the data", async ({ page }) => {
    const phone = uniquePhone();
    const { code } = await call<{ code: string }>("/auth/request-code", {
      method: "POST",
      body: { phone },
    });
    const session = await call<{ token: string }>("/auth/verify", {
      method: "POST",
      body: { phone, code, name: { givenName: "רגיל", familyName: null } },
    });

    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", session.token],
    );
    await page.goto("/admin");
    await ready(page);

    await expect(
      page.getByRole("heading", { name: "הנהלת הפלטפורמה" }),
    ).toBeVisible();
    // No business list.
    await expect(page.getByRole("button", { name: "עסקים" })).toHaveCount(0);
  });

  test("with no session at all it offers a way in and nothing else", async ({ page }) => {
    await page.goto("/admin");
    await ready(page);
    await expect(
      page.getByRole("heading", { name: "הנהלת הפלטפורמה" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "עסקים" })).toHaveCount(0);
  });
});

test.describe("the panel itself", () => {
  test("lists businesses with their owner, plan and state", async ({ page }) => {
    const admin = await anAdministrator();
    const shop = await aBusinessWithOpenHours({
      name: `הנהלה ${Date.now()}`,
      ownerPhone: uniquePhone(), plan: "SOLO",
    });

    await asAdministrator(page, admin.token);
    await findInDirectory(page, shop.business.name);

    const entry = inDirectory(page, shop.business.name);
    await expect(entry.getByText("יחיד")).toBeVisible();
    await expect(entry.getByText("ניסיון", { exact: true })).toBeVisible();
    await expect(entry.getByText("ניסיון עד")).toBeVisible();
  });

  test("deactivating a business removes it from search and shows it deactivated", async ({ page }) => {
    const admin = await anAdministrator();
    const name = `להשבתה ${Date.now()}`;
    await aBusinessWithOpenHours({ name, ownerPhone: uniquePhone() });

    await asAdministrator(page, admin.token);
    await findInDirectory(page, name);

    await inDirectory(page, name).getByText(name).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText(/לעולם לא מבטלת תורים קיימים/)).toBeVisible();
    await page.getByRole("button", { name: "השבתת העסק" }).click();

    // Switched off while it owes nothing: deactivated by an administrator, not lapsed.
    await expect(inDirectory(page, name).getByText("מושבת")).toBeVisible({ timeout: 20_000 });

    const found = await call<{ name: string }[]>(
      `/businesses/search?q=${encodeURIComponent(name.slice(0, 6))}`,
    );
    expect(found.some((business) => business.name === name)).toBe(false);
  });

  test("filters in the Filters panel, and a token takes its filter back off", async ({ page }) => {
    const admin = await anAdministrator();
    const name = `סינון ${Date.now()}`;
    await aBusinessWithOpenHours({ name, ownerPhone: uniquePhone(), plan: "SOLO" });

    await asAdministrator(page, admin.token);
    await findInDirectory(page, name);

    await page.getByRole("button", { name: "מסננים", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "מסננים" });
    await expect(panel).toBeVisible();

    // An option with nothing behind it cannot be chosen: with this search,
    // nothing is paid for yet.
    await expect(panel.getByRole("button", { name: /משולם/ })).toBeDisabled();

    await panel.getByRole("button", { name: /ניסיון/ }).click();
    await expect(panel.getByRole("button", { name: /ניסיון/ })).toHaveAttribute("aria-pressed", "true");
    await expect(inDirectory(page, name)).toBeVisible({ timeout: 15_000 });

    // Team: this Business is on Solo, so it leaves the list — and the panel
    // says so on its last button before it is closed.
    await panel.getByRole("button", { name: /^צוות/ }).click();
    await expect(panel.getByRole("button", { name: "אין עסקים מתאימים" })).toBeDisabled({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^מסננים\s*2$/ })).toBeVisible();
    await expect(inDirectory(page, name)).toHaveCount(0);

    // Taking the Team token off brings it back; the Trial choice stays.
    await page.getByRole("button", { name: "הסרה צוות" }).click();
    await expect(inDirectory(page, name)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /^מסננים\s*1$/ })).toBeVisible();

    await page.getByRole("button", { name: "ניקוי מסננים" }).click();
    await expect(page.getByPlaceholder(SEARCH)).toHaveValue("");
    await expect(page.getByRole("button", { name: /^מסננים$/ })).toBeVisible();
  });

  test("moves a business to Team at once, and says so before the button is pressed", async ({ page }) => {
    const admin = await anAdministrator();
    const name = `שדרוג ${Date.now()}`;
    await aBusinessWithOpenHours({ name, ownerPhone: uniquePhone(), plan: "SOLO" });

    await asAdministrator(page, admin.token);
    await findInDirectory(page, name);
    await inDirectory(page, name).getByText(name).click();

    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("העברה למסלול")).toBeVisible({ timeout: 15_000 });
    await sheet.getByRole("button", { name: /^צוות/ }).click();
    await expect(sheet.getByText(/השדרוג חל מיד/)).toBeVisible();
    await sheet.getByRole("button", { name: "העבר לצוות עכשיו" }).click();

    await expect(inDirectory(page, name).getByText("צוות")).toBeVisible({ timeout: 20_000 });
  });

  test("a business over its calendar limit is settled by choosing the one that stays", async ({ page }) => {
    const admin = await anAdministrator();
    const name = `מכסה ${Date.now()}`;
    const shop = await aBusinessWithOpenHours({ name, ownerPhone: uniquePhone() });
    await call(`/businesses/${shop.business.id}/resources`, {
      method: "POST",
      token: shop.owner.token,
      body: { name: "כיסא שני" },
    });
    await call(`/admin/businesses/${shop.business.id}/subscription`, {
      method: "PATCH",
      token: admin.token,
      body: { plan: "SOLO" },
    });

    await asAdministrator(page, admin.token);
    await findInDirectory(page, name);
    await inDirectory(page, name).getByText(name).click();

    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText(/2 יומנים פעילים, והמסלול כולל אחד/)).toBeVisible({ timeout: 15_000 });
    await sheet.getByRole("radio", { name: /יומן א/ }).check();
    await sheet.getByRole("button", { name: "השהיית היומן האחר" }).click();

    // Read once the pause has landed: the click answers before the server does.
    const pausedOf = async (calendarName: string) =>
      (
        await call<{ id: string; name: string; paused: boolean }[]>(`/businesses/${shop.business.id}/resources`, {
          token: shop.owner.token,
        })
      ).find((calendar) => calendar.name === calendarName)?.paused;
    await expect.poll(() => pausedOf("כיסא שני"), { timeout: 15_000 }).toBe(true);
    expect(await pausedOf("יומן א")).toBe(false);
  });

  test("a state in the statistics opens the Businesses filtered to it", async ({ page }) => {
    const admin = await anAdministrator();
    await aBusinessWithOpenHours({ name: `סטטיסטיקה ${Date.now()}`, ownerPhone: uniquePhone() });

    await asAdministrator(page, admin.token);
    await page.getByRole("button", { name: "סטטיסטיקה" }).click();
    await page.locator(".stat-status", { hasText: "ניסיון" }).click();

    await expect(page.getByRole("button", { name: "הסרה ניסיון" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /^מסננים\s*1$/ })).toBeVisible();
  });

  test("opening a customer record writes it to the audit log", async ({ page }) => {
    const admin = await anAdministrator();
    const shop = await aBusinessWithOpenHours({
      name: `ביקורת ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });

    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", admin.token],
    );
    await page.goto("/admin");
    await ready(page);

    await page.getByRole("button", { name: "משתמשים" }).click();
    await page.getByPlaceholder("חיפוש לפי שם או טלפון").fill("בעלים");
    await page.getByRole("button", { name: /בעלים/ }).first().click();

    await expect(page.getByRole("dialog")).toBeVisible();
    // ADR 0006: the read is logged, and the screen says so plainly.
    await expect(page.getByText(/נרשמה ביומן הביקורת/)).toBeVisible();

    const trail = await call<{ action: string }[]>("/admin/audit?limit=50", {
      token: admin.token,
    });
    expect(trail.some((entry) => entry.action === "CUSTOMER_RECORD_READ")).toBe(true);
    expect(shop.business.id).toBeTruthy();
  });

  test("the audit log is presented as unchangeable", async ({ page }) => {
    const admin = await anAdministrator();
    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", admin.token],
    );
    await page.goto("/admin");
    await ready(page);

    await page.getByRole("button", { name: "מערכת" }).click();
    await page.getByRole("button", { name: "יומן ביקורת" }).click();
    await expect(page.getByText(/אי אפשר לערוך או למחוק/)).toBeVisible();
  });
});
