import { expect, test } from "@playwright/test";
import {
  aBusinessWithOpenHours,
  call,
  makeAdministrator,
  paymentFellDue,
  ready,
  runTheDailyBillingJob,
  signInDirectly,
  uniquePhone,
} from "./support.ts";

/**
 * Notices (ADR 0020): what the platform tells an owner about their
 * Subscription — a bell beside the account button, one banner above whatever
 * tab is open, and the list the bell opens.
 */
test.describe("notices", () => {
  const banner = (page: import("@playwright/test").Page) => page.locator(".notice-banner");

  test("a new owner is told their Trial started, and 'Got it' puts the banner away for good", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({ name: `הודעות ${Date.now()}`, ownerPhone });
    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);

    await expect(banner(page).getByText("תקופת הניסיון התחילה")).toBeVisible({ timeout: 15_000 });
    await expect(banner(page).getByText(/30 יום על מסלול צוות/)).toBeVisible();

    // The bell counts it, and opening the list reads it.
    await page.getByRole("button", { name: "הודעה אחת שלא נקראה" }).click();
    const list = page.getByRole("dialog", { name: "הודעות" });
    await expect(list.getByText("תקופת הניסיון התחילה")).toBeVisible();
    await expect(list.getByRole("heading", { name: "חדשות" })).toBeVisible();
    await list.getByRole("button", { name: "סגירה" }).click();
    await expect(page.getByRole("button", { name: "הודעות", exact: true })).toBeVisible();

    await banner(page).getByRole("button", { name: "הבנתי" }).click();
    await expect(banner(page)).toHaveCount(0);

    await page.reload();
    await ready(page);
    await expect(page.getByRole("button", { name: "הודעות", exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(banner(page)).toHaveCount(0);
    // Still kept in the list, now among the earlier ones.
    await page.getByRole("button", { name: "הודעות", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "הודעות" }).getByRole("heading", { name: "קודמות" })).toBeVisible();
  });

  test("a late payment stands above every tab, and leads to paying", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({ name: `באיחור ${Date.now()}`, ownerPhone });
    await paymentFellDue(shop.business.id);
    await runTheDailyBillingJob();

    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);

    // What costs the most to miss stands; the Trial's start waits in the bell.
    await expect(banner(page).getByText("התשלום באיחור")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("עוד הודעה אחת בפעמון")).toBeVisible();

    await page.getByRole("button", { name: "לקוחות", exact: true }).click();
    await expect(banner(page).getByText("התשלום באיחור")).toBeVisible();

    await banner(page).getByRole("button", { name: "איך משלמים" }).click();
    await expect(page.getByText("המסלולים")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("בחסד", { exact: true })).toBeVisible();
  });

  test("a manager sees no bell and no banner: billing is the owner's", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({ name: `מנהלת ${Date.now()}`, ownerPhone });
    const managerPhone = uniquePhone();
    await call(`/businesses/${shop.business.id}/users`, {
      method: "POST",
      token: shop.owner.token,
      body: { phone: managerPhone, givenName: "מנהלת", familyName: null, role: "MANAGER" },
    });

    await signInDirectly(page, managerPhone, "מנהלת");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);

    await expect(page.getByRole("button", { name: "העסק", exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".notice-bell")).toHaveCount(0);
    await expect(banner(page)).toHaveCount(0);
  });

  test("an owner given Features is told once, and sees where each comes from", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({ name: `קיבלו ${Date.now()}`, ownerPhone, plan: "SOLO" });
    const adminPhone = uniquePhone();
    const { code } = await call<{ code: string }>("/auth/request-code", { method: "POST", body: { phone: adminPhone } });
    await call("/auth/verify", { method: "POST", body: { phone: adminPhone, code, name: { givenName: "הנהלה", familyName: null } } });
    await makeAdministrator(adminPhone);
    const again = await call<{ code: string }>("/auth/request-code", { method: "POST", body: { phone: adminPhone } });
    const admin = await call<{ token: string }>("/auth/verify", { method: "POST", body: { phone: adminPhone, code: again.code } });
    const endsOn = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await call(`/admin/businesses/${shop.business.id}/grants`, {
      method: "POST",
      token: admin.token,
      body: { features: ["CUSTOMER_HISTORY", "CUSTOMER_BLOCKING"], endsOn, reason: "פיילוט" },
    });

    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);

    await expect(banner(page).getByText("קיבלתם 2 פיצ'רים")).toBeVisible({ timeout: 15_000 });
    await banner(page).getByRole("button", { name: "מה כלול אצלכם" }).click();

    const included = page.locator(".card", { has: page.locator(".feature-row.compact") });
    await expect(included.locator(".feature-row", { hasText: "תזכורות" }).getByText("במסלול")).toBeVisible({
      timeout: 15_000,
    });
    await expect(included.locator(".feature-row", { hasText: "היסטוריית לקוח" }).getByText(/קיבלתם · עד/)).toBeVisible();
    await expect(included.locator(".feature-row", { hasText: "מנהלים ועובדים" }).getByText("במסלול צוות")).toBeVisible();
  });
});
