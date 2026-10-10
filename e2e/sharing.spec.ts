import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { aMember } from "./change-support.ts";
import { aShareSheetOnTheDevice, noShareSheetOnTheDevice, readTheCard, readTheScreenCode, sharedOnTheDevice } from "./share-support.ts";
import { aBusinessWithOpenHours, aDayFromNow, anInstantAt, API_URL, call, database, ready, signInDirectly, uniquePhone, useEnglish } from "./support.ts";

/**
 * ADR 0028: the one place a business is shared from, once it is open — a pill
 * in its own row of the account drawer, for everyone who works there. It opens
 * the sheet the new business screen has: the link, WhatsApp, copying, the
 * device's share, the page customers see, and the printable QR card.
 */

type Shop = Awaited<ReturnType<typeof aBusinessWithOpenHours>>;

const aShop = (name: string, ownerPhone = uniquePhone()) =>
  aBusinessWithOpenHours({ name: `${name} ${Date.now()}`, ownerPhone });

/** The manage app, signed in with this token, on this business. */
const manage = async (page: Page, token: string, businessId: string) => {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key as string, value as string), ["tor-now.session", token]);
  await page.goto(`/manage?business=${businessId}`);
  await ready(page);
};

const drawer = (page: Page) => page.getByRole("dialog", { name: "החשבון שלי" });
const sheet = (page: Page) => page.getByRole("dialog", { name: "שיתוף העסק" });
const pill = (page: Page) => drawer(page).getByRole("button", { name: "שיתוף העסק" });

const openTheDrawer = async (page: Page) => {
  await page.getByRole("button", { name: "החשבון שלי" }).click();
  await expect(drawer(page)).toBeVisible();
};

const openTheShareSheet = async (page: Page) => {
  await openTheDrawer(page);
  await pill(page).click();
  await expect(sheet(page)).toBeVisible();
};

const businessLink = (shop: Shop) => new RegExp(`^https?://[^/]+/business/${shop.business.id}$`);

test.describe("sharing the business from the drawer", () => {
  test("is a pill in the business's own row, which costs the drawer no space", async ({ page }) => {
    const shop = await aShop("שורה");
    await manage(page, shop.owner.token, shop.business.id);
    await openTheDrawer(page);

    const row = drawer(page).locator(".place-with-action");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(shop.business.name);
    await expect(row.getByText("בעלים", { exact: true })).toBeVisible();
    // A word as well as an icon, so nobody has to guess what it does.
    await expect(pill(page)).toHaveText("שיתוף");

    // Inside the row, on its line: the row is as tall as its name and role
    // already made it — the pill adds nothing to its height.
    const rowBox = await row.boundingBox();
    const pillBox = await pill(page).boundingBox();
    const contentBox = await row.locator(".place-main").boundingBox();
    expect(rowBox && pillBox && contentBox).toBeTruthy();
    if (rowBox && pillBox && contentBox) {
      expect(pillBox.y).toBeGreaterThanOrEqual(rowBox.y);
      expect(pillBox.y + pillBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height);
      expect(pillBox.x).toBeGreaterThanOrEqual(rowBox.x);
      expect(pillBox.x + pillBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
      // The row's own padding and border, and nothing more.
      expect(rowBox.height - contentBox.height).toBeLessThanOrEqual(16);
      expect(pillBox.height).toBeLessThanOrEqual(contentBox.height);
    }
    // The row is still the place you are in, and nothing else in the drawer shares.
    await expect(row.locator("[aria-current=true]")).toHaveCount(1);
    await expect(drawer(page).getByRole("button", { name: /שיתוף/ })).toHaveCount(1);
  });

  test("opens the sheet with everything the new business screen had", async ({ page, context }) => {
    await noShareSheetOnTheDevice(page);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const shop = await aShop("הכול");
    await manage(page, shop.owner.token, shop.business.id);
    await openTheShareSheet(page);

    // The drawer makes way: one sheet at a time.
    await expect(drawer(page)).toBeHidden();

    // The page customers see, in a new tab.
    const view = sheet(page).getByRole("link", { name: "צפייה כלקוח" });
    await expect(view).toHaveAttribute("href", businessLink(shop));
    await expect(view).toHaveAttribute("target", "_blank");

    // The message and the link.
    await expect(sheet(page).locator(".share-message")).toContainText("אפשר לקבוע אצלי תור כאן, בלי להתקשר:");
    const url = (await sheet(page).locator(".share-message a").getAttribute("href")) ?? "";
    expect(url).toMatch(businessLink(shop));

    // WhatsApp, saying it shares, written and with nobody chosen.
    const whatsapp = (await sheet(page).getByRole("link", { name: "שיתוף בוואטסאפ" }).getAttribute("href")) ?? "";
    expect(whatsapp.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(whatsapp.slice("https://wa.me/?text=".length))).toBe(`אפשר לקבוע אצלי תור כאן, בלי להתקשר:\n${url}`);

    // Copying, said in place.
    await sheet(page).getByRole("button", { name: "העתקת הקישור" }).click();
    await expect(sheet(page).getByRole("button", { name: "הקישור הועתק" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);

    // The QR card: A6, and a camera reads the business's page off it.
    await expect(sheet(page).getByRole("img", { name: `כרטיס QR להדפסה של ${shop.business.name}` })).toBeVisible({ timeout: 15_000 });
    const read = await readTheCard(page);
    expect(read).toMatchObject({ width: 1240, height: 1748, data: url });
    const [download] = await Promise.all([page.waitForEvent("download"), sheet(page).getByRole("link", { name: "הורדה להדפסה" }).click()]);
    expect(download.suggestedFilename()).toBe(`qr-${shop.business.name.replace(/\s+/g, "-")}.png`);
    const bytes = await readFile((await download.path()) ?? "");
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1240, 1748]);

    // No device share sheet here, so no "עוד…" and no picture to share; nothing owed, so no deadline.
    await expect(sheet(page).getByRole("button", { name: "עוד…" })).toHaveCount(0);
    await expect(sheet(page).getByRole("button", { name: "שיתוף כתמונה" })).toHaveCount(0);
    await expect(sheet(page).locator(".warn")).toHaveCount(0);

    await sheet(page).getByRole("button", { name: "סגירה" }).click();
    await expect(sheet(page)).toBeHidden();
  });

  test("hands the link to the device's own share sheet, and the card as a picture, where there is one", async ({ page }) => {
    await aShareSheetOnTheDevice(page, { files: true });
    const shop = await aShop("מכשיר");
    await manage(page, shop.owner.token, shop.business.id);
    await openTheShareSheet(page);

    await sheet(page).getByRole("button", { name: "עוד…" }).click();
    await expect.poll(() => sharedOnTheDevice(page)).toHaveLength(1);
    const [link] = await sharedOnTheDevice(page);
    expect(link).toMatchObject({ title: shop.business.name, text: "אפשר לקבוע אצלי תור כאן, בלי להתקשר:", files: [] });
    expect(link?.url).toMatch(businessLink(shop));
    // Still open: handing the link on is not the end of sharing.
    await expect(sheet(page)).toBeVisible();

    await sheet(page).getByRole("button", { name: "שיתוף כתמונה" }).click();
    await expect.poll(() => sharedOnTheDevice(page)).toHaveLength(2);
    const [, picture] = await sharedOnTheDevice(page);
    expect(picture?.files).toHaveLength(1);
    expect(picture?.files[0]).toMatchObject({ type: "image/png" });
  });

  test("the sheet does not move when the card arrives", async ({ page }) => {
    await aShareSheetOnTheDevice(page);
    const shop = await aShop("יציב");
    // The card is held back, so the sheet is seen both before and after it.
    await page.addInitScript(() => {
      const prototype = HTMLCanvasElement.prototype;
      // Kept to be called with each canvas as `this`, which is what the wrapper does.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const draw = prototype.toBlob;
      prototype.toBlob = function (this: HTMLCanvasElement, ...args: Parameters<HTMLCanvasElement["toBlob"]>) {
        window.setTimeout(() => draw.apply(this, args), 1200);
      };
    });
    await manage(page, shop.owner.token, shop.business.id);
    await openTheShareSheet(page);
    await expect(sheet(page).getByRole("status")).toHaveText("מכינים את הכרטיס…");
    const before = await sheet(page).getByRole("button", { name: "עוד…" }).boundingBox();
    await expect(sheet(page).locator(".share-card img")).toBeVisible({ timeout: 15_000 });
    const after = await sheet(page).getByRole("button", { name: "עוד…" }).boundingBox();
    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(2);
  });

  test("a cancelled device share sheet is not an error", async ({ page }) => {
    await aShareSheetOnTheDevice(page, { cancels: true });
    const shop = await aShop("ביטול");
    await manage(page, shop.owner.token, shop.business.id);
    await openTheShareSheet(page);
    await sheet(page).getByRole("button", { name: "עוד…" }).click();
    await expect.poll(() => sharedOnTheDevice(page)).toHaveLength(1);
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).locator(".crit")).toHaveCount(0);
  });

  test("a manager shares the business too", async ({ page }) => {
    const shop = await aShop("מנהלת");
    const manager = await aMember({ ...shop, second: shop.resource }, "MANAGER", []);
    await manage(page, manager.token, shop.business.id);
    await openTheDrawer(page);
    await expect(drawer(page).getByText("מנהל", { exact: false }).first()).toBeVisible();
    await pill(page).click();
    await expect(sheet(page).getByRole("link", { name: "צפייה כלקוח" })).toHaveAttribute("href", businessLink(shop));
  });

  test("a worker, who has no business tab, shares it from the drawer", async ({ page }) => {
    const shop = await aShop("עובדת");
    const worker = await aMember({ ...shop, second: shop.resource }, "WORKER", [shop.resource.id]);
    await manage(page, worker.token, shop.business.id);
    await expect(page.getByRole("button", { name: "העסק", exact: true })).toHaveCount(0);
    await openTheShareSheet(page);
    await expect(sheet(page).getByRole("link", { name: "צפייה כלקוח" })).toHaveAttribute("href", businessLink(shop));
    await expect(sheet(page).locator(".share-card img")).toBeVisible({ timeout: 15_000 });
    expect((await readTheCard(page))?.data).toMatch(businessLink(shop));
  });

  test("while payment is due, the owner's sheet says when the business leaves search", async ({ page }) => {
    const today = aDayFromNow(0);
    await page.clock.setFixedTime(new Date(anInstantAt(today, "03:00")));
    const shop = await aShop("חוב");
    await database()`update subscription set trial_ends_on = null, paid_through = null where business_id = ${shop.business.id}`;
    const billing = await call<{ status: string }>(`/businesses/${shop.business.id}/subscription`, { token: shop.owner.token });
    expect(billing.status).toBe("LAPSED");

    await manage(page, shop.owner.token, shop.business.id);
    await openTheShareSheet(page);
    const [year, month, day] = today.split("-").map(Number) as [number, number, number];
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
      new Date(Date.UTC(year, month - 1, day, 4)),
    );
    await expect(sheet(page).locator(".warn")).toHaveText(`בלי תשלום, היום ב־${time} העסק יוסר מהחיפוש ולא יקבל תורים חדשים.`);
    // Sharing still works meanwhile: the business is still in search.
    await expect(sheet(page).getByRole("link", { name: "שיתוף בוואטסאפ" })).toBeVisible();
  });

  test("a business that is off cannot be shared: there is no drawer and no pill", async ({ page }) => {
    const shop = await aShop("כבוי");
    await database()`update business set active = false where id = ${shop.business.id}`;
    await manage(page, shop.owner.token, shop.business.id);
    await expect(page.getByText("העסק אינו פעיל")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "שיתוף העסק" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "החשבון שלי" })).toHaveCount(0);
  });

  test("with several businesses, it shares the one being managed, and the header's list stays a list", async ({ page }) => {
    const phone = uniquePhone();
    const first = await aShop("ראשון", phone);
    const second = await aShop("שני", phone);
    await manage(page, second.owner.token, second.business.id);
    await openTheShareSheet(page);
    await expect(sheet(page).getByRole("link", { name: "צפייה כלקוח" })).toHaveAttribute("href", businessLink(second));
    await sheet(page).getByRole("button", { name: "סגירה" }).click();

    // The header's switch draws the same rows, and none of them shares.
    await page.getByRole("button", { name: new RegExp(second.business.name.slice(0, 4)) }).first().click();
    const list = page.getByRole("dialog");
    await expect(list.getByText(first.business.name)).toBeVisible();
    await expect(list.getByRole("button", { name: /שיתוף/ })).toHaveCount(0);
  });

  test("is reached from the keyboard, and Escape puts the sheet away", async ({ page }) => {
    const shop = await aShop("מקלדת");
    await manage(page, shop.owner.token, shop.business.id);
    await openTheDrawer(page);
    await pill(page).focus();
    await page.keyboard.press("Enter");
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();
  });

  test("speaks English in English, the printed card included, whatever the name's letters", async ({ page }) => {
    await useEnglish(page);
    const shop = await aShop("מספרה");
    await manage(page, shop.owner.token, shop.business.id);
    await page.getByRole("button", { name: "Your account" }).click();
    const english = page.getByRole("dialog", { name: "Your account" });
    const share = english.getByRole("button", { name: "Share the business" });
    await expect(share).toHaveText("Share");
    await share.click();
    const shareSheet = page.getByRole("dialog", { name: "Share the business" });
    await expect(shareSheet.getByRole("link", { name: "See it as a customer" })).toBeVisible();
    await expect(shareSheet.getByRole("link", { name: "Share on WhatsApp" })).toBeVisible();
    await expect(shareSheet.getByRole("button", { name: "Copy the link" })).toBeVisible();
    // A Hebrew name, an English app: the card is English.
    await expect(shareSheet.locator(".share-card")).toHaveAttribute("data-language", "en", { timeout: 15_000 });
  });

  test("fits a 320px phone: the pill stays on the row's line, and the sheet does not scroll sideways", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "a phone width");
    await page.setViewportSize({ width: 320, height: 640 });
    const shop = await aBusinessWithOpenHours({ name: `שם ארוך מאוד לעסק שלא נגמר ${Date.now()}`, ownerPhone: uniquePhone() });
    await manage(page, shop.owner.token, shop.business.id);
    await openTheDrawer(page);
    const row = await drawer(page).locator(".place-with-action").boundingBox();
    const pillBox = await pill(page).boundingBox();
    expect(row && pillBox).toBeTruthy();
    if (row && pillBox) {
      expect(pillBox.x).toBeGreaterThanOrEqual(row.x);
      expect(pillBox.x + pillBox.width).toBeLessThanOrEqual(row.x + row.width);
      expect(pillBox.y + pillBox.height).toBeLessThanOrEqual(row.y + row.height);
    }
    await pill(page).click();
    await expect(sheet(page).locator(".share-card img")).toBeVisible({ timeout: 15_000 });
    const sideways = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".sheet, main")).some((element) => element.scrollWidth > element.clientWidth + 1),
    );
    expect(sideways).toBe(false);
  });
});

test.describe("a customer sharing a business from its page", () => {
  const A_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const theBusinessPage = async (page: Page, shop: Shop) => {
    await page.goto(`/business/${shop.business.id}`);
    await ready(page);
    await expect(page.getByRole("heading", { level: 1, name: shop.business.name })).toBeVisible({ timeout: 20_000 });
  };
  const customerSheet = (page: Page) => page.getByRole("dialog", { name: "שיתוף העסק" });

  test("opens the owner's sheet in a friend's voice, with the business at the top", async ({ page, context }) => {
    await noShareSheetOnTheDevice(page);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const shop = await aShop("המלצה");
    await theBusinessPage(page, shop);
    await page.getByRole("button", { name: "שיתוף העסק" }).click();
    const sheet = customerSheet(page);
    await expect(sheet).toBeVisible();

    // What is being sent, at the top: its name, main category and address.
    const business = sheet.locator(".share-business");
    await expect(business).toContainText(shop.business.name);
    await expect(business).toContainText(/מספרה \/ ספר · רחוב הבדיקה 1/);
    // Without a cover photo, the initial stands in.
    await expect(business.locator(".share-business-thumb.empty")).toHaveText(shop.business.name.charAt(0));

    // A friend's message, and the business's own link.
    const message = `מכירים את ${shop.business.name}? קובעים שם תור בלי להתקשר:`;
    await expect(sheet.locator(".share-message")).toContainText(message);
    const url = (await sheet.locator(".share-message a").getAttribute("href")) ?? "";
    expect(url).toMatch(businessLink(shop));
    const whatsapp = (await sheet.getByRole("link", { name: "שיתוף בוואטסאפ" }).getAttribute("href")) ?? "";
    expect(decodeURIComponent(whatsapp.slice("https://wa.me/?text=".length))).toBe(`${message}\n${url}`);
    await sheet.getByRole("button", { name: "העתקת הקישור" }).click();
    await expect(sheet.getByRole("button", { name: "הקישור הועתק" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);

    // Nothing of the owner's: no customer view, no card to print, no deadline.
    await expect(sheet.getByRole("link", { name: "צפייה כלקוח" })).toHaveCount(0);
    await expect(sheet.getByRole("link", { name: "הורדה להדפסה" })).toHaveCount(0);
    await expect(sheet.locator(".share-card, .warn")).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "עוד…" })).toHaveCount(0);

    await sheet.getByRole("button", { name: "סגירה" }).click();
    await expect(sheet).toBeHidden();
  });

  test("shows a code on the screen for a friend to scan, and folds it away again", async ({ page }) => {
    const shop = await aShop("קוד במסך");
    await theBusinessPage(page, shop);
    await page.getByRole("button", { name: "שיתוף העסק" }).click();
    const sheet = customerSheet(page);
    const toggle = sheet.getByRole("button", { name: "להראות קוד לסריקה" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(sheet.locator(".qr-on-screen")).toHaveCount(0);

    await toggle.click();
    const code = sheet.getByRole("img", { name: `קוד QR לעמוד של ${shop.business.name}` });
    await expect(code).toBeVisible();
    await expect(sheet.getByRole("button", { name: "הסתרת הקוד" })).toHaveAttribute("aria-expanded", "true");
    await expect(sheet.locator(".share-code figcaption")).toContainText(shop.business.name);
    await expect(sheet.locator(".share-code figcaption")).toContainText("מכוונים מצלמה וקובעים תור");
    // A camera reads the business's page off it, logo and all.
    expect(await readTheScreenCode(page)).toMatch(businessLink(shop));

    await sheet.getByRole("button", { name: "הסתרת הקוד" }).click();
    await expect(sheet.locator(".qr-on-screen")).toHaveCount(0);

    // Opened again, the sheet starts folded.
    await toggle.click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "שיתוף העסק" }).click();
    await expect(customerSheet(page).locator(".qr-on-screen")).toHaveCount(0);
  });

  test("hands the friend's message to the device's own share sheet where there is one", async ({ page }) => {
    await aShareSheetOnTheDevice(page);
    const shop = await aShop("מכשיר לקוח");
    await theBusinessPage(page, shop);
    await page.getByRole("button", { name: "שיתוף העסק" }).click();
    await customerSheet(page).getByRole("button", { name: "עוד…" }).click();
    await expect.poll(() => sharedOnTheDevice(page)).toHaveLength(1);
    const [handed] = await sharedOnTheDevice(page);
    expect(handed).toMatchObject({ title: shop.business.name, text: `מכירים את ${shop.business.name}? קובעים שם תור בלי להתקשר:` });
    expect(handed?.url).toMatch(businessLink(shop));
  });

  test("shows the business's cover beside its name", async ({ page }) => {
    const shop = await aShop("עם תמונה");
    const response = await fetch(`${API_URL}/businesses/${shop.business.id}/photos/0`, {
      method: "PUT",
      headers: { authorization: `Bearer ${shop.owner.token}`, "content-type": "image/png" },
      body: A_PNG,
    });
    expect(response.ok, await response.clone().text()).toBe(true);
    await theBusinessPage(page, shop);
    await page.getByRole("button", { name: "שיתוף העסק" }).click();
    const thumb = customerSheet(page).locator("img.share-business-thumb");
    await expect(thumb).toBeVisible();
    expect(await thumb.getAttribute("src")).toMatch(/photos|storage|http/);
  });

  test("a signed-in customer shares the same way", async ({ page }) => {
    const shop = await aShop("לקוח מחובר");
    await signInDirectly(page, uniquePhone(), "לקוחה");
    await theBusinessPage(page, shop);
    await page.getByRole("button", { name: "שיתוף העסק" }).click();
    await expect(customerSheet(page).locator(".share-message")).toContainText(`מכירים את ${shop.business.name}?`);
  });

  test("a business that is off has no share button", async ({ page }) => {
    const shop = await aShop("כבוי ללקוח");
    await database()`update business set active = false where id = ${shop.business.id}`;
    await page.goto(`/business/${shop.business.id}`);
    await ready(page);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "שיתוף העסק" })).toHaveCount(0);
  });

  test("in English, the friend speaks English", async ({ page }) => {
    await useEnglish(page);
    const shop = await aShop("English share");
    await page.goto(`/business/${shop.business.id}`);
    await ready(page);
    await page.getByRole("button", { name: "Share this business" }).click({ timeout: 20_000 });
    const sheet = page.getByRole("dialog", { name: "Share the business" });
    await expect(sheet.locator(".share-message")).toContainText(`Have you tried ${shop.business.name}? You can book there without a phone call:`);
    await expect(sheet.locator(".share-business")).toContainText("Barbershop");
    await sheet.getByRole("button", { name: "Show a code to scan" }).click();
    await expect(sheet.getByRole("img", { name: `QR code for ${shop.business.name}'s page` })).toBeVisible();
  });

  test("fits a 320px phone with the code open", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "a phone width");
    await page.setViewportSize({ width: 320, height: 640 });
    const shop = await aShop("עסק עם שם ארוך מאוד שלא נגמר");
    await theBusinessPage(page, shop);
    await page.getByRole("button", { name: "שיתוף העסק" }).click();
    await customerSheet(page).getByRole("button", { name: "להראות קוד לסריקה" }).click();
    await expect(customerSheet(page).locator(".qr-on-screen")).toBeVisible();
    const sideways = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".sheet, main")).some((element) => element.scrollWidth > element.clientWidth + 1),
    );
    expect(sideways).toBe(false);
    const box = await customerSheet(page).locator(".qr-on-screen").boundingBox();
    expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= 320).toBe(true);
  });
});
