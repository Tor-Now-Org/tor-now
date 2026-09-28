import { expect, test, type Page } from "@playwright/test";
import {
  aBusinessWithOpenHours,
  call,
  closeDatabase,
  makeAdministrator,
  ready,
  signInDirectly,
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

test.describe("the Catalogue", () => {
  test("an administrator corrects a message rate, and it reads as checked by them", async ({ page }) => {
    const admin = await anAdministrator();
    await asAdministrator(page, admin.token);
    await page.getByRole("button", { name: "מחירון" }).click();
    await page.getByRole("tab", { name: "תעריפי הודעות" }).click();

    // The suite shares one database, so this rate may have been corrected
    // already by another run; the journey only asks that the correction lands.
    const card = page.locator(".rate-card", { hasText: "וואטסאפ — קוד כניסה" });
    await card.getByRole("button", { name: "תיקון התעריף" }).click({ timeout: 15_000 });

    const sheet = page.getByRole("dialog", { name: /תעריף חדש/ });
    await sheet.getByLabel("מחיר להודעה (₪)").fill("0.02031");
    await expect(sheet.getByText("מחיר בשקלים, עד ארבע ספרות אחרי הנקודה")).toBeVisible();
    await sheet.getByLabel("מחיר להודעה (₪)").fill("0.0203");
    await sheet.getByLabel("מקור").fill("חשבונית Twilio לספטמבר, שורה 7");
    await sheet.getByRole("button", { name: "שמירת התעריף" }).click();

    await expect(card.getByText(/נבדק · הנהלה/)).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText("מקור: חשבונית Twilio לספטמבר, שורה 7")).toBeVisible();
    await expect(card.getByRole("button", { name: /היסטוריה/ })).toBeVisible();
  });

  test("Features are granted several at once, extended and ended from the Business sheet", async ({ page }) => {
    const admin = await anAdministrator();
    const name = `הענקות ${Date.now()}`;
    await aBusinessWithOpenHours({ name, ownerPhone: uniquePhone(), plan: "SOLO" });

    await asAdministrator(page, admin.token);
    await findInDirectory(page, name);
    await inDirectory(page, name).getByText(name).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.locator(".feature-row", { hasText: "תזכורות" }).getByText("במסלול")).toBeVisible({
      timeout: 15_000,
    });

    await sheet.getByRole("button", { name: "הענקת פיצ'רים" }).click();
    const grant = page.getByRole("dialog", { name: /הענקת פיצ'רים —/ });
    // What the Business has some other way cannot be chosen.
    await expect(grant.getByRole("checkbox", { name: /תזכורות/ })).toBeDisabled();
    await grant.getByRole("checkbox", { name: /היסטוריית לקוח/ }).check();
    await grant.getByRole("checkbox", { name: /חסימת לקוחות/ }).check();
    await grant.getByRole("button", { name: "30 יום" }).click();
    await grant.getByLabel("סיבה").fill("פיילוט: עוברים ממערכת אחרת");
    await grant.getByRole("button", { name: "הענקת 2 פיצ'רים" }).click();

    await expect(sheet.getByText("פיצ'רים · 2 הוענקו")).toBeVisible({ timeout: 15_000 });
    const history = sheet.locator(".feature-row", { hasText: "היסטוריית לקוח" });
    await expect(history.getByText(/״פיילוט: עוברים ממערכת אחרת״/)).toBeVisible();

    await history.getByRole("button", { name: "הארכה" }).click();
    const extend = page.getByRole("dialog", { name: /הארכת היסטוריית לקוח/ });
    await extend.getByRole("button", { name: "60 יום" }).click();
    await extend.getByLabel("סיבה").fill("עוד חודשיים");
    await extend.getByRole("button", { name: /הארכה עד/ }).click();
    await expect(history.getByText(/״עוד חודשיים״/)).toBeVisible({ timeout: 15_000 });

    const blocking = sheet.locator(".feature-row", { hasText: "חסימת לקוחות" });
    await blocking.getByRole("button", { name: "סיום" }).click();
    await blocking.getByRole("button", { name: "כן, לסיים" }).click();
    await expect(blocking.getByText("לא כלול")).toBeVisible({ timeout: 15_000 });
    await expect(sheet.getByText("פיצ'רים · 1 הוענקו")).toBeVisible();
  });

  // The suite shares one database and runs one journey at a time, so a Plan
  // change here is always undone before the journey ends.
  test("a price rise publishes a new edition, reaches the owners, and cancelling puts it all back", async ({ page }) => {
    const admin = await anAdministrator();
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({ name: `מחיר ${Date.now()}`, ownerPhone, plan: "SOLO" });

    await asAdministrator(page, admin.token);
    await page.getByRole("button", { name: "מחירון" }).click();
    const solo = page.locator(".plan-card").filter({ has: page.locator(".plan-badge.p-SOLO") }).first();
    await solo.getByRole("button", { name: "עריכת המסלול" }).click({ timeout: 15_000 });

    const edit = page.getByRole("dialog", { name: /עריכת יחיד/ });
    await edit.getByLabel("מחיר לחודש (₪)").fill("59");
    await expect(edit.getByText(/לוקח ערך — גרסה \d+ חדשה/)).toBeVisible();
    await edit.getByRole("button", { name: /פרסום גרסה \d+/ }).click();

    await expect(solo.locator(".pending-change")).toBeVisible({ timeout: 15_000 });
    await expect(solo.getByText(/שינוי ממתין · .*59/)).toBeVisible();

    // The owner was told, in the app and on WhatsApp.
    const board = await call<{ notices: { kind: string }[] }>(`/businesses/${shop.business.id}/notices`, {
      token: shop.owner.token,
    });
    expect(board.notices.map((notice) => notice.kind)).toContain("EDITION_ANNOUNCED");

    await solo.getByRole("button", { name: "ביטול השינוי" }).click();
    const cancel = page.getByRole("dialog", { name: /ביטול השינוי ביחיד/ });
    await expect(cancel.getByText(shop.business.name)).toBeVisible();
    await cancel.getByRole("button", { name: /ביטול השינוי והודעה/ }).click();

    await expect(solo.locator(".pending-change")).toHaveCount(0, { timeout: 15_000 });
    await expect(solo.locator(".price")).toContainText("49");
  });

  test("an edit that only gives says it applies now, before anything is saved", async ({ page }) => {
    const admin = await anAdministrator();
    await asAdministrator(page, admin.token);
    await page.getByRole("button", { name: "מחירון" }).click();
    const team = page.locator(".plan-card").filter({ has: page.locator(".plan-badge.p-TEAM") }).first();
    await team.getByRole("button", { name: "עריכת המסלול" }).click({ timeout: 15_000 });

    const edit = page.getByRole("dialog", { name: /עריכת צוות/ });
    await expect(edit.getByRole("button", { name: "אין שינוי" })).toBeDisabled();
    await edit.getByRole("button", { name: "+" }).click();
    await expect(edit.getByText("נותן ערך — חל עכשיו")).toBeVisible();
    await expect(edit.getByRole("button", { name: "שמירה — חל עכשיו" })).toBeEnabled();
  });

  test("all plans side by side, and a count opens the Businesses on that edition", async ({ page }) => {
    const admin = await anAdministrator();
    await aBusinessWithOpenHours({ name: `שכבות ${Date.now()}`, ownerPhone: uniquePhone(), plan: "TEAM" });
    await asAdministrator(page, admin.token);
    await page.getByRole("button", { name: "מחירון" }).click();
    await page.getByRole("button", { name: /כל המסלולים זה לצד זה/ }).click({ timeout: 15_000 });

    const table = page.getByRole("dialog", { name: "כל המסלולים זה לצד זה" });
    await expect(table.getByRole("row", { name: /מחיר/ })).toBeVisible();
    await expect(table.getByRole("row", { name: /מנהלים ועובדים/ })).toBeVisible();
    await table.getByRole("row", { name: /עסקים/ }).getByRole("button").last().click();

    await expect(page.locator(".dir-token", { hasText: /צוות v1/ })).toBeVisible({ timeout: 15_000 });
  });

  test("the Features tab says where each Feature is and who has it, and a count opens those Businesses", async ({ page }) => {
    const admin = await anAdministrator();
    await aBusinessWithOpenHours({ name: `פיצרים ${Date.now()}`, ownerPhone: uniquePhone(), plan: "SOLO" });
    await asAdministrator(page, admin.token);
    await page.getByRole("button", { name: "מחירון" }).click();
    await page.getByRole("tab", { name: "פיצ'רים" }).click();

    const waiting = page.locator(".feature-card", { hasText: "רשימת המתנה" });
    await expect(waiting.getByText(/תצוגה מוקדמת בכל המסלולים/)).toBeVisible({ timeout: 15_000 });
    await expect(waiting.getByText(/צריך להחליט עד/)).toBeVisible();

    // Starting a Preview says what it gives before anything is saved.
    const history = page.locator(".feature-card", { hasText: "היסטוריית לקוח" });
    await history.getByRole("button", { name: "תצוגה מוקדמת" }).click();
    const start = page.getByRole("dialog", { name: /תצוגה מוקדמת — היסטוריית לקוח/ });
    await expect(start.getByText(/יחיד: מקבלים היסטוריית לקוח/)).toBeVisible();
    await expect(start.getByText(/צוות: כבר כלול/)).toBeVisible();
    await expect(start.getByRole("button", { name: "התחלת התצוגה המוקדמת" })).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(start).toBeHidden();

    // Deciding where a Preview's Feature goes says what each Plan gains or loses.
    await waiting.getByRole("button", { name: "מה קורה בסוף התצוגה" }).click();
    const place = page.getByRole("dialog", { name: /מה קורה לרשימת המתנה/ });
    await place.getByRole("group", { name: "צוות" }).getByRole("button", { name: "נשאר במסלול" }).click();
    await expect(place.getByText(/צוות — נותן ערך/)).toBeVisible();
    await expect(place.getByText(/יחיד — לוקח ערך/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(place).toBeHidden();

    await waiting.getByRole("button", { name: /בתצוגה מוקדמת/ }).click();
    await expect(page.locator(".dir-token", { hasText: /רשימת המתנה · תצוגה/ })).toBeVisible({ timeout: 15_000 });
  });

  test("the Businesses list filters by a Feature and where it comes from", async ({ page }) => {
    const admin = await anAdministrator();
    const name = `הענקה ${Date.now()}`;
    const shop = await aBusinessWithOpenHours({ name, ownerPhone: uniquePhone(), plan: "SOLO" });
    const endsOn = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    await call(`/admin/businesses/${shop.business.id}/grants`, {
      method: "POST",
      token: admin.token,
      body: { features: ["TEAM_ROLES"], endsOn, reason: "פיילוט" },
    });

    await asAdministrator(page, admin.token);
    await findInDirectory(page, name);
    await expect(inDirectory(page, name).getByText("+1 בהענקה")).toBeVisible();

    await page.locator(".filters-btn").click();
    const panel = page.locator(".filters-panel");
    await panel.getByRole("button", { name: /מנהלים ועובדים/ }).click();
    await panel.getByRole("group", { name: "מנהלים ועובדים" }).getByRole("button", { name: /בהענקה/ }).click();
    await panel.getByRole("button", { name: /^הצג/ }).click();

    await expect(page.locator(".dir-token", { hasText: /מנהלים ועובדים · בהענקה/ })).toBeVisible();
    await expect(inDirectory(page, name)).toBeVisible();
  });

  // --- ADR 0021: Add-ons, and a Feature's own "which plans" ------------------

  /** Nothing on sale on its own, whatever an earlier run left: the suite shares one database. */
  const noAddonsOnSale = async (token: string): Promise<void> => {
    const { features } = await call<{ features: { feature: string; addon?: unknown }[] }>("/admin/catalogue/features", { token });
    for (const view of features) {
      if (view.addon !== null && view.addon !== undefined) {
        await call(`/admin/catalogue/features/${view.feature}/addon/stop`, { method: "POST", token });
      }
    }
  };

  const openFeatures = async (page: Page) => {
    await page.getByRole("button", { name: "מחירון" }).click();
    await page.getByRole("tab", { name: "פיצ'רים" }).click();
  };

  test("a Feature goes on sale as an Add-on, is repriced, and its sale stops", async ({ page }) => {
    const admin = await anAdministrator();
    await noAddonsOnSale(admin.token);
    await asAdministrator(page, admin.token);
    await openFeatures(page);

    const blocking = page.locator(".feature-card", { hasText: "חסימת לקוחות" });
    await blocking.getByRole("button", { name: "מכירה כתוספת" }).click({ timeout: 15_000 });
    const sell = page.getByRole("dialog", { name: /מכירה כתוספת — חסימת לקוחות/ });
    await sell.getByLabel("מחיר לחודש (₪)").fill("9");
    await expect(sell.getByText(/יכולים להוסיף חסימת לקוחות/)).toBeVisible({ timeout: 15_000 });
    await sell.getByRole("button", { name: "התחלת המכירה" }).click();
    await expect(blocking.getByText(/ביחיד כתוספת/)).toBeVisible({ timeout: 15_000 });

    await blocking.getByRole("button", { name: "שינוי מחיר" }).click();
    const price = page.getByRole("dialog", { name: /מחיר חדש — חסימת לקוחות/ });
    await price.getByLabel("מחיר חדש לחודש (₪)").fill("7");
    await expect(price.getByText("נותן ערך — חל עכשיו")).toBeVisible();
    await price.getByRole("button", { name: "שמירה — חל עכשיו" }).click();
    await expect(blocking.getByText(/ביחיד כתוספת · .*7/)).toBeVisible({ timeout: 15_000 });

    await blocking.getByRole("button", { name: "הפסקת המכירה" }).click();
    const stop = page.getByRole("dialog", { name: /הפסקת המכירה — חסימת לקוחות/ });
    await expect(stop.getByText("לא לוקח מאף אחד")).toBeVisible();
    await stop.getByRole("button", { name: "הפסקת המכירה" }).click();
    await expect(blocking.getByRole("button", { name: "מכירה כתוספת" })).toBeVisible({ timeout: 15_000 });
  });

  test("an owner keeps an Add-on after the Trial, sees the next payment, cancels it and takes it back", async ({ page }) => {
    const admin = await anAdministrator();
    await noAddonsOnSale(admin.token);
    await call("/admin/catalogue/features/CUSTOMER_BLOCKING/addon", { method: "POST", token: admin.token, body: { priceMinor: 900 } });
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({ name: `תוספות ${Date.now()}`, ownerPhone, plan: "SOLO" });
    try {
      await signInDirectly(page, ownerPhone, "בעלים");
      await page.goto(`/manage?business=${shop.business.id}`);
      await ready(page);
      await page.getByRole("button", { name: "העסק", exact: true }).click();
      await page.getByRole("button", { name: "מנוי ותשלומים" }).click();

      const row = page.locator(".addon-row", { hasText: "חסימת לקוחות" });
      await expect(row.getByText(/כלולה בניסיון עד/)).toBeVisible({ timeout: 15_000 });
      await row.getByRole("button", { name: "להמשיך אחרי הניסיון" }).click();
      const add = page.getByRole("dialog", { name: "הוספת חסימת לקוחות" });
      await expect(add.getByText("זמינה מעכשיו.")).toBeVisible();
      await add.getByRole("button", { name: /הוספה ב־/ }).click();
      await expect(row.getByText("פעיל")).toBeVisible({ timeout: 15_000 });
      await expect(page.locator(".pay-row.total")).toContainText("58");

      await row.getByRole("button", { name: "ביטול" }).click();
      const cancel = page.getByRole("dialog", { name: "ביטול חסימת לקוחות" });
      await cancel.getByRole("button", { name: "ביטול התוספת" }).click();
      await expect(row.getByText(/בוטלה · נשארת עד/)).toBeVisible({ timeout: 15_000 });
      await row.getByRole("button", { name: "חידוש" }).click();
      await expect(row.getByText("פעיל")).toBeVisible({ timeout: 15_000 });
    } finally {
      await call("/admin/catalogue/features/CUSTOMER_BLOCKING/addon/stop", { method: "POST", token: admin.token }).catch(() => undefined);
    }
  });

  test("which plans, and a Preview's end sold as an Add-on, say what they do before anything is saved", async ({ page }) => {
    const admin = await anAdministrator();
    await noAddonsOnSale(admin.token);
    await asAdministrator(page, admin.token);
    await openFeatures(page);

    const history = page.locator(".feature-card", { hasText: "היסטוריית לקוח" });
    await history.getByRole("button", { name: "באילו מסלולים" }).click({ timeout: 15_000 });
    const which = page.getByRole("dialog", { name: /באילו מסלולים — היסטוריית לקוח/ });
    await which.getByRole("group", { name: "יחיד" }).getByRole("button", { name: "כלול", exact: true }).click({ timeout: 15_000 });
    await expect(which.getByText("יחיד — נותן ערך, חל עכשיו")).toBeVisible();
    await which.getByRole("group", { name: "צוות" }).getByRole("button", { name: "לא כלול" }).click();
    await expect(which.getByText(/צוות — לוקח ערך · גרסה \d+ חדשה/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(which).toBeHidden();

    const waiting = page.locator(".feature-card", { hasText: "רשימת המתנה" });
    await waiting.getByRole("button", { name: "מה קורה בסוף התצוגה" }).click();
    const place = page.getByRole("dialog", { name: /מה קורה לרשימת המתנה/ });
    await place.getByRole("group", { name: "צוות" }).getByRole("button", { name: "נשאר במסלול" }).click();
    await place.getByText("למכור כתוספת למי שיוצא").click();
    await place.getByLabel("מחיר לחודש (₪)").fill("15");
    await expect(place.getByText(/אפשר להשאיר אותו כתוספת ב־/)).toBeVisible();
    await page.keyboard.press("Escape");
  });
});
