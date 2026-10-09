import { test, type Page } from "@playwright/test";
import {
  anAdministrator,
  asAdministrator,
  expect,
  openCosts,
  paidUp,
  recordUsage,
  resetCosts,
  shekels,
} from "./cost-support.ts";
import { aBusinessWithOpenHours, API_URL, call, closeDatabase, uniquePhone } from "./support.ts";

/**
 * What Businesses and the platform cost (ADR 0023), as an administrator uses
 * it: the month's figures, the Cost Calculator and its saved Businesses, and
 * Fair Use — each worked out from the usage whenever the screen opens.
 */

test.afterEach(async () => {
  await resetCosts();
});

test.afterAll(async () => {
  await closeDatabase();
});

const aShop = async (plan: "SOLO" | "TEAM" = "TEAM") => {
  const name = `עלויות ${Date.now()}`;
  const shop = await aBusinessWithOpenHours({ name, ownerPhone: uniquePhone(), plan });
  return { id: shop.business.id, name };
};

/** A Business's sheet, as it opens over whatever screen asked for it. */
const businessSheet = (page: Page, name: string) => page.getByRole("dialog").filter({ hasText: name });

test.describe("this month", () => {
  test("names the paying Business that cost the most, and opens its sheet from there", async ({ page }) => {
    const shop = await aShop("TEAM");
    await paidUp(shop.id);
    // Far above anything another journey records, so it is the most expensive on Team.
    await recordUsage({ businessId: shop.id, source: "BOOKING", unit: "WHATSAPP_UTILITY", times: 20_000 });

    await asAdministrator(page, await anAdministrator());
    await openCosts(page, "החודש");

    const team = page.getByLabel("צוות", { exact: true });
    await expect(team.getByText("הכי יקר החודש")).toBeVisible({ timeout: 15_000 });
    await expect(team.getByText(shop.name)).toBeVisible();
    await expect(team.getByText("מרווח", { exact: true })).toBeVisible();

    await team.getByRole("button", { name: new RegExp(shop.name) }).click();
    const sheet = businessSheet(page, shop.name);
    await expect(sheet.getByRole("heading", { name: shop.name })).toBeVisible({ timeout: 15_000 });
    await expect(sheet.getByLabel("שימוש החודש")).toBeVisible();
  });

  test("adds a fixed cost with its source, and the platform card counts it and shares it out", async ({ page }) => {
    const shop = await aShop("SOLO");
    await paidUp(shop.id);
    await asAdministrator(page, await anAdministrator());
    await openCosts(page, "החודש");

    const platform = page.getByLabel("עלויות המערכת", { exact: true });
    await expect(platform).toBeVisible({ timeout: 15_000 });
    const before = shekels(await platform.locator(".cost-figure strong").first().textContent());

    await platform.getByRole("button", { name: "עלויות קבועות" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "הוספת עלות קבועה" }).click();
    await sheet.getByLabel("מה זה").fill("Supabase");
    await sheet.getByLabel("כמה בחודש").fill("92.5");
    await sheet.getByLabel("מקור").fill("חשבונית ספטמבר · $25");
    await sheet.getByRole("button", { name: "הוספה" }).click();

    await expect(sheet.locator('[data-running="Supabase"]')).toContainText("92.50");
    await sheet.getByRole("button", { name: "סגירה" }).click();

    await expect(platform.getByText("Supabase")).toBeVisible({ timeout: 15_000 });
    await expect(platform.getByText("קבוע", { exact: true })).toBeVisible();
    await expect
      .poll(async () => shekels(await platform.locator(".cost-figure strong").first().textContent()))
      .toBeCloseTo(before + 92.5, 2);
    await expect(platform.getByText("לכל עסק משלם")).toBeVisible();
  });

  test("changes a fixed cost from a day, and stops it with zero", async ({ page }) => {
    await asAdministrator(page, await anAdministrator());
    await openCosts(page, "החודש");
    const platform = page.getByLabel("עלויות המערכת", { exact: true });
    await platform.getByRole("button", { name: "עלויות קבועות" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "הוספת עלות קבועה" }).click();
    await sheet.getByLabel("מה זה").fill("Vercel");
    await sheet.getByLabel("כמה בחודש").fill("74");
    await sheet.getByLabel("מקור").fill("חשבונית אוגוסט");
    await sheet.getByRole("button", { name: "הוספה" }).click();

    const row = sheet.locator('[data-running="Vercel"]');
    await row.getByRole("button", { name: "שינוי" }).click();
    await expect(sheet.getByText("עכשיו")).toBeVisible();
    await sheet.getByLabel("כמה בחודש").fill("0");
    await sheet.getByLabel("מקור").fill("בוטל");
    await sheet.getByRole("button", { name: "שמירה" }).click();
    await expect(row).toContainText("הופסק מ־");
    await sheet.getByRole("button", { name: "סגירה" }).click();
    await expect(platform.getByText("Vercel")).toHaveCount(0);
  });

  test("refuses a fixed cost with no source, or an amount that is not shekels", async ({ page }) => {
    await asAdministrator(page, await anAdministrator());
    await openCosts(page, "החודש");
    await page.getByLabel("עלויות המערכת", { exact: true }).getByRole("button", { name: "עלויות קבועות" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "הוספת עלות קבועה" }).click();
    await sheet.getByLabel("מה זה").fill("Twilio");
    await sheet.getByLabel("כמה בחודש").fill("4.261");
    await expect(sheet.getByText("סכום בשקלים, עד שתי ספרות אחרי הנקודה")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "הוספה" })).toBeDisabled();
    await sheet.getByLabel("כמה בחודש").fill("4.26");
    await expect(sheet.getByRole("button", { name: "הוספה" })).toBeDisabled();
    await sheet.getByLabel("מקור").fill("דף המספר");
    await expect(sheet.getByRole("button", { name: "הוספה" })).toBeEnabled();
  });

  test("goes back a month and forward again, and never to a month to come", async ({ page }) => {
    await asAdministrator(page, await anAdministrator());
    await openCosts(page, "החודש");
    const next = page.getByRole("button", { name: "החודש הבא" });
    await expect(next).toBeDisabled({ timeout: 15_000 });
    await expect(page.locator(".month-picker")).toContainText("עד היום");
    await page.getByRole("button", { name: "החודש הקודם" }).click();
    // The month asked for shows at once, and its figures replace the old ones when they come.
    await expect(page.locator(".month-picker")).not.toContainText("עד היום");
    await expect(page.locator(".month-figures")).toHaveAttribute("aria-busy", "false");
    await expect(next).toBeEnabled();
    await next.click();
    await expect(page.locator(".month-picker")).toContainText("עד היום");
    await expect(page.locator(".month-figures")).toHaveAttribute("aria-busy", "false");
  });

  test("two quick taps back land two months back, with that month's figures and no other's", async ({ page }) => {
    await asAdministrator(page, await anAdministrator());
    await openCosts(page, "החודש");
    const figures = page.locator(".month-figures");
    await expect(figures).toHaveAttribute("aria-busy", "false", { timeout: 15_000 });
    // The month as Israel has it, as the screen does — not UTC's, which differs for hours at each month's turn.
    const [year, month] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit" })
      .format(new Date())
      .split("-")
      .map(Number) as [number, number];
    const twoBack = new Date(Date.UTC(year, month - 3, 1)).toISOString().slice(0, 7);
    const back = page.getByRole("button", { name: "החודש הקודם" });
    await back.click();
    await back.click();
    await expect(figures).toHaveAttribute("data-month", twoBack, { timeout: 15_000 });
    await expect(figures).toHaveAttribute("aria-busy", "false");
  });

  test("says what no rate covers, and leads to the rates", async ({ page }) => {
    const shop = await aShop("SOLO");
    // The default rates start on 1 September 2026; August has none.
    await recordUsage({ businessId: shop.id, source: "BOOKING", unit: "SMS_SEGMENT", times: 3, quantity: 2, at: "2026-08-20T10:00:00Z" });
    await asAdministrator(page, await anAdministrator());
    await openCosts(page, "החודש");
    const picker = page.locator(".month-picker");
    const figures = page.locator(".month-figures");
    for (let back = 0; back < 36; back += 1) {
      await expect(figures).toHaveAttribute("aria-busy", "false", { timeout: 15_000 });
      if ((await picker.textContent())?.includes("אוגוסט 2026") === true) break;
      await page.getByRole("button", { name: "החודש הקודם" }).click();
    }
    await expect(picker).toContainText("אוגוסט 2026");
    await expect(figures).toHaveAttribute("aria-busy", "false");
    const note = page.locator(".note").filter({ hasText: "עוד לא מתומחרות" });
    await expect(note).toContainText("SMS");
    await note.getByRole("button", { name: "לתעריפים" }).click();
    await expect(page.getByRole("tab", { name: "תעריפים" })).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("the calculator", () => {
  const total = (page: Page) => page.locator("[data-total]");

  test("works the cost out as a number changes, and offers to update or save", async ({ page }) => {
    await asAdministrator(page, await anAdministrator());
    await openCosts(page, "מחשבון");
    await page.getByRole("button", { name: "בינוני", exact: true }).click();
    const before = shekels(await total(page).textContent());

    await page.locator("#calc-REMINDERS-sms").fill("12");
    await expect.poll(async () => shekels(await total(page).textContent())).toBeGreaterThan(before);
    await expect(page.getByText('שיניתם מספרים ב"בינוני".')).toBeVisible();
    await expect(page.getByRole("button", { name: 'עדכון "בינוני"' })).toBeVisible();

    await page.getByRole("button", { name: "ביטול השינויים" }).click();
    await expect.poll(async () => shekels(await total(page).textContent())).toBe(before);
    await expect(page.locator("#calc-REMINDERS-sms")).toHaveValue("2");
  });

  test("saves the numbers as a new Business, updates it, renames it and deletes it", async ({ page }) => {
    await asAdministrator(page, await anAdministrator());
    await openCosts(page, "מחשבון");
    await page.getByRole("button", { name: "עמוס", exact: true }).click();
    await page.locator("#calc-BOOKING-whatsapp").fill("1500");

    await page.getByRole("button", { name: "שמירה כעסק חדש" }).click();
    const save = page.getByRole("dialog");
    await save.getByLabel("שם").fill("עמוס");
    await save.getByRole("button", { name: "שמירה" }).click();
    await expect(save.getByText("כבר יש עסק שמור בשם הזה")).toBeVisible();
    await save.getByLabel("שם").fill("מספרה עם 3 כיסאות");
    await save.getByRole("button", { name: "שמירה" }).click();

    const chip = page.getByRole("button", { name: "מספרה עם 3 כיסאות", exact: true });
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText('נשמר בתור "מספרה עם 3 כיסאות".')).toBeVisible();

    await page.locator("#calc-BILLING-whatsapp").fill("9");
    await page.getByRole("button", { name: 'עדכון "מספרה עם 3 כיסאות"' }).click();
    await expect(page.getByText('"מספרה עם 3 כיסאות" עודכן.')).toBeVisible();

    // Kept, not only said: after a reload the saved Business opens on its numbers.
    await page.reload();
    await openCosts(page, "מחשבון");
    await page.getByRole("button", { name: "מספרה עם 3 כיסאות", exact: true }).click();
    await expect(page.locator("#calc-BOOKING-whatsapp")).toHaveValue("1500");
    await expect(page.locator("#calc-BILLING-whatsapp")).toHaveValue("9");

    await page.getByRole("button", { name: "ניהול" }).click();
    const manage = page.getByRole("dialog");
    const row = manage.locator('[data-saved="מספרה עם 3 כיסאות"]');
    await row.getByRole("button", { name: "שינוי שם" }).click();
    await manage.getByLabel("שם").fill("שלושה כיסאות");
    await manage.getByRole("button", { name: "שמירה" }).click();
    await expect(manage.locator('[data-saved="שלושה כיסאות"]')).toBeVisible();

    await manage.locator('[data-saved="שלושה כיסאות"]').getByRole("button", { name: "מחיקה" }).click();
    await expect(manage.getByText('למחוק את "שלושה כיסאות"? אי אפשר לבטל.')).toBeVisible();
    await manage.getByRole("group").getByRole("button", { name: "מחיקה" }).click();
    await expect(manage.locator('[data-saved="שלושה כיסאות"]')).toHaveCount(0);
    await manage.getByRole("button", { name: "סגירה" }).click();
    await expect(page.getByRole("button", { name: "שלושה כיסאות", exact: true })).toHaveCount(0);
  });

  test("keeps the total in view without covering the rows it is worked out from", async ({ page }, info) => {
    await asAdministrator(page, await anAdministrator());
    await openCosts(page, "מחשבון");
    await page.getByRole("button", { name: "עמוס", exact: true }).click();
    const line = page.locator(".calc-line");
    const summary = page.locator(".calc-summary");
    const rows = page.locator(".calc-rows");
    const input = page.locator("#calc-BILLING-sms");
    await input.scrollIntoViewIfNeeded();

    const box = await input.boundingBox();
    const cover = info.project.name === "mobile" ? await line.boundingBox() : await summary.boundingBox();
    expect(box).not.toBeNull();
    expect(cover).not.toBeNull();
    if (info.project.name === "mobile") {
      await expect(line).toBeVisible();
      // The line sits above the rows: whatever scrolls stays below it.
      expect((box?.y ?? 0) >= (cover?.y ?? 0) + (cover?.height ?? 0) - 1).toBe(true);
    } else {
      await expect(line).toBeHidden();
      await expect(summary).toBeInViewport();
      // Beside the rows, never on top of them.
      const rowsBox = await rows.boundingBox();
      const apart =
        (cover?.x ?? 0) >= (rowsBox?.x ?? 0) + (rowsBox?.width ?? 0) - 1 ||
        (cover?.x ?? 0) + (cover?.width ?? 0) <= (rowsBox?.x ?? 0) + 1;
      expect(apart).toBe(true);
    }
    await input.fill("7");
    await expect(input).toBeInViewport();
  });
});

test.describe("Fair Use", () => {
  test("a Business over a limit is in the banner, the list and its sheet — and a higher limit clears it at once", async ({ page }) => {
    const shop = await aShop("SOLO");
    await paidUp(shop.id);
    // Eighty SMS parts on the waiting list: ₪76, far over ₪10.
    await recordUsage({ businessId: shop.id, source: "WAITING_LIST", unit: "SMS_SEGMENT", times: 40, quantity: 2 });

    await asAdministrator(page, await anAdministrator());
    const banner = page.locator(".fair-use-banner");
    await expect(banner).toContainText("מעל שימוש הוגן", { timeout: 15_000 });
    await expect(banner).toContainText("רשימת המתנה");
    await banner.getByRole("button", { name: /לשימוש הוגן/ }).click();

    const waiting = page.locator('[data-limit="WAITING_LIST"]');
    await expect(waiting).toBeVisible({ timeout: 15_000 });
    await waiting.getByRole("button", { name: /עברו? החודש/ }).click();
    const list = page.getByRole("dialog");
    await expect(list).toContainText("מחושב עכשיו");
    await list.getByRole("button", { name: new RegExp(shop.name) }).click();

    const sheet = businessSheet(page, shop.name);
    const usage = sheet.getByLabel("שימוש החודש");
    await expect(usage).toBeVisible({ timeout: 15_000 });
    await expect(usage.locator('[data-reading="WAITING_LIST"]')).toContainText("מעל הגבול");
    await expect(usage.locator('[data-reading="BOOKING"]')).not.toContainText("מעל הגבול");
    await page.keyboard.press("Escape");

    await waiting.getByRole("button", { name: "שינוי הגבול" }).click();
    const edit = page.getByRole("dialog");
    await edit.getByLabel("עד כמה לעסק בחודש").fill("100000");
    await edit.getByRole("button", { name: "שמירה" }).click();
    await expect(waiting).toContainText("100,000");
    await expect(waiting.getByRole("button", { name: /עברו? החודש/ })).toHaveCount(0);
  });

  test("refuses a limit that is not an amount above zero", async ({ page }) => {
    await asAdministrator(page, await anAdministrator());
    await openCosts(page, "שימוש הוגן");
    await page.locator('[data-limit="BOOKING"]').getByRole("button", { name: "שינוי הגבול" }).click();
    const edit = page.getByRole("dialog");
    for (const wrong of ["0", "-5", "abc", "1.234"]) {
      await edit.getByLabel("עד כמה לעסק בחודש").fill(wrong);
      await expect(edit.getByRole("button", { name: "שמירה" })).toBeDisabled();
    }
  });

  test("sign-in codes over today's limit are flagged on the card and in the banner", async ({ page }) => {
    await recordUsage({ businessId: null, source: "SIGN_IN", unit: "WHATSAPP_AUTHENTICATION", times: 3 });
    await asAdministrator(page, await anAdministrator());
    await openCosts(page, "שימוש הוגן");
    const signIn = page.locator('[data-limit="SIGN_IN"]');
    await signIn.getByRole("button", { name: "שינוי הגבול" }).click();
    const edit = page.getByRole("dialog");
    await edit.getByLabel("כמה קודים ביום, לכל המערכת").fill("1");
    await edit.getByRole("button", { name: "שמירה" }).click();
    await expect(signIn).toContainText("מעל הגבול היום");

    await page.getByRole("button", { name: "עסקים", exact: true }).click();
    await expect(page.locator(".fair-use-banner")).toContainText("קודי כניסה היום, מעל 1");
    await page.locator(".fair-use-banner").getByRole("button", { name: "הסתרה" }).click();
    await expect(page.locator(".fair-use-banner")).toHaveCount(0);
  });
});

test("sends a sign-in code only to an Israeli number", async () => {
  await expect(call("/auth/request-code", { method: "POST", body: { phone: "+14155238886" } })).rejects.toThrow(/400/);
  const israeli = await call<{ code: string }>("/auth/request-code", { method: "POST", body: { phone: uniquePhone() } });
  expect(israeli.code).toMatch(/^\d{6}$/);
});

test("sends no sign-in code to a caller who skips the sign-in page", async () => {
  // ADR 0027: only the web app's route, which checks for bots, holds the secret.
  const response = await fetch(`${API_URL}/auth/request-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: uniquePhone() }),
  });
  expect(response.status).toBe(403);
});
