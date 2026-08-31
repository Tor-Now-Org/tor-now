import { expect, test } from "@playwright/test";
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
    body: { phone, code, name: "הנהלה" },
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

test.describe("who may reach the panel", () => {
  test("an ordinary session is shown the door, not the data", async ({ page }) => {
    const phone = uniquePhone();
    const { code } = await call<{ code: string }>("/auth/request-code", {
      method: "POST",
      body: { phone },
    });
    const session = await call<{ token: string }>("/auth/verify", {
      method: "POST",
      body: { phone, code, name: "רגיל" },
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
    // No business list, and the allowlist rule is stated rather than hidden.
    await expect(page.getByRole("button", { name: "עסקים" })).toHaveCount(0);
    await expect(page.getByText(/דגל ההרשאה לבדו לא מספיק/)).toBeVisible();
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
  test("lists businesses with their owner and state", async ({ page }) => {
    const admin = await anAdministrator();
    const shop = await aBusinessWithOpenHours({
      name: `הנהלה ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });

    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", admin.token],
    );
    await page.goto("/admin");
    await ready(page);

    // The warning is part of the control, not decoration.
    await expect(page.getByText(/עוקף את בידוד הנתונים/)).toBeVisible();
    await expect(page.getByText(shop.business.name)).toBeVisible({ timeout: 20_000 });
  });

  test("deactivating a business removes it from search", async ({ page }) => {
    const admin = await anAdministrator();
    const name = `להשבתה ${Date.now()}`;
    await aBusinessWithOpenHours({ name, ownerPhone: uniquePhone() });

    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", admin.token],
    );
    await page.goto("/admin");
    await ready(page);

    await page.getByText(name).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText(/לעולם לא מבטלת תורים קיימים/)).toBeVisible();
    await page.getByRole("button", { name: "השבתת העסק" }).click();

    await expect(page.getByText("מושבת").first()).toBeVisible({ timeout: 20_000 });

    const found = await call<{ name: string }[]>(
      `/businesses/search?q=${encodeURIComponent(name.slice(0, 6))}`,
    );
    expect(found.some((business) => business.name === name)).toBe(false);
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
