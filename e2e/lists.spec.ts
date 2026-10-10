import { expect, test, type Locator, type Page } from "@playwright/test";
import { aMember } from "./change-support.ts";
import {
  aBusinessWithOpenHours,
  aDayFromNow,
  anInstantAt,
  call,
  database,
  ready,
  uniquePhone,
  useEnglish,
} from "./support.ts";

/**
 * The business's lists — services, calendars, team, customers — in one design:
 * a header with the count and the way to add, one card of rows, a sheet per
 * row; and the customer page in the booked screen's family.
 */

type Shop = Awaited<ReturnType<typeof aBusinessWithOpenHours>>;

const aShop = (name: string, options: { plan?: "SOLO" | "TEAM"; ownerPhone?: string } = {}) =>
  aBusinessWithOpenHours({
    name: `${name} ${Date.now()}`,
    ownerPhone: options.ownerPhone ?? uniquePhone(),
    hours: { start: "07:00", end: "22:00" },
    ...(options.plan === undefined ? {} : { plan: options.plan }),
  });

const signedIn = async (page: Page, token: string) =>
  page.addInitScript(([key, value]) => window.localStorage.setItem(key as string, value as string), ["tor-now.session", token]);

const openPanel = async (page: Page, shop: Shop, panel: string, token = shop.owner.token) => {
  await signedIn(page, token);
  await page.goto(`/manage?business=${shop.business.id}&tab=business&panel=${panel}`);
  await ready(page);
};

const list = (page: Page, title: string) => page.getByRole("list", { name: new RegExp(`^${title}`) });
const rows = (page: Page, title: string) => list(page, title).locator(":scope > li:not(.list-divider)");
const row = (page: Page, title: string, name: string) => rows(page, title).filter({ hasText: name });
const sheet = (page: Page) => page.getByRole("dialog");

/** A customer, signed in through the API, with a phone of their own. */
const aCustomer = async (givenName: string, familyName: string | null = "כהן") => {
  const phone = uniquePhone();
  const { code } = await call<{ code: string }>("/auth/request-code", { method: "POST", body: { phone } });
  const session = await call<{ token: string; user: { id: string } }>("/auth/verify", {
    method: "POST",
    body: { phone, code, name: { givenName, familyName } },
  });
  return { phone, token: session.token, id: session.user.id };
};

const bookAs = (shop: Shop, customer: { token: string }, days: number, clock: string, resourceId = shop.resource.id) =>
  call<{ id: string }>("/appointments", {
    method: "POST",
    token: customer.token,
    body: { businessId: shop.business.id, serviceId: shop.service.id, resourceId, startAt: anInstantAt(aDayFromNow(days), clock), customerNote: null },
  });

/** An appointment moved this many days into the past, as time going by would. */
const intoThePast = async (id: string, daysAgo: number) => {
  const at = (minutes: number) => new Date(Date.now() - daysAgo * 86_400_000 + minutes * 60_000).toISOString();
  await database()`update appointment set start_at = ${at(0)}, end_at = ${at(30)}, occupied_until = ${at(40)} where id = ${id}`;
};

/** As dialled in Israel: +972549534655 is 054-953-4655. */
const dialled = (e164: string) => {
  const national = `0${e164.slice(4)}`;
  return `${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`;
};

const noSidewaysScroll = (page: Page) =>
  page.evaluate(() =>
    [document.scrollingElement, ...Array.from(document.querySelectorAll("main, .sheet"))].every(
      (element) => element === null || element.scrollWidth <= element.clientWidth + 1,
    ),
  );

const styleOf = (locator: Locator) => locator.evaluate((element) => element.getAttribute("style") ?? "");

test.describe("services", () => {
  test("one card of rows: each in its calendar colour, with what a customer reads under its name", async ({ page }) => {
    const shop = await aShop("שירותים");
    const t = shop.owner.token;
    const b = shop.business.id;
    await call(`/businesses/${b}`, { method: "PATCH", token: t, body: { defaultBufferMinutes: 10 } });
    for (const service of [
      { name: "צבע ופן", durationMinutes: 90, priceMinor: 25000, bufferMinutes: 15 },
      { name: "שיחת ייעוץ", durationMinutes: 15, priceMinor: 0, bufferMinutes: 0 },
      { name: "החלקה", durationMinutes: 120, priceMinor: 60000, bufferMinutes: null },
    ]) {
      const made = await call<{ id: string }>(`/businesses/${b}/services`, { method: "POST", token: t, body: service });
      if (service.name === "החלקה") await call(`/businesses/${b}/services/${made.id}`, { method: "PATCH", token: t, body: { active: false } });
    }
    await openPanel(page, shop, "services");

    await expect(page.getByRole("heading", { name: /^שירותים/ })).toContainText("4");
    await expect(page.getByRole("button", { name: "הוספה" })).toBeVisible();
    await expect(rows(page, "שירותים")).toHaveCount(4);

    // The line under each name: length, price or "בלי מחיר", and recovery — its own, or the business's.
    await expect(row(page, "שירותים", "תספורת").locator(".list-line")).toHaveText(/^30 דק׳ · .*80.*₪ · ועוד 10 דק׳ התאוששות של העסק$/);
    await expect(row(page, "שירותים", "צבע ופן").locator(".list-line")).toHaveText(/^90 דק׳ · .*250.*₪ · ועוד 15 דק׳ התאוששות$/);
    await expect(row(page, "שירותים", "שיחת ייעוץ").locator(".list-line")).toHaveText("15 דק׳ · בלי מחיר");

    // Each service is its calendar colour, by its place in the list, as the day view draws it.
    for (const [index, name] of ["תספורת", "צבע ופן", "שיחת ייעוץ", "החלקה"].entries()) {
      expect(await styleOf(row(page, "שירותים", name).locator(".list-row"))).toContain(`--rail: var(--event-${index + 1})`);
    }

    // A hidden service recedes and says so; the others carry no tag.
    const hidden = row(page, "שירותים", "החלקה").locator(".list-row");
    await expect(hidden).toHaveClass(/muted/);
    await expect(hidden.locator(".list-tag")).toHaveText("מוסתר");
    await expect(row(page, "שירותים", "תספורת").locator(".list-tag")).toHaveCount(0);

    // No buttons on the rows any more: each row is one button.
    await expect(rows(page, "שירותים").getByRole("button")).toHaveCount(4);
    await expect(page.getByText("הסתרת שירות לא נוגעת בתורים שכבר נקבעו.")).toBeVisible();
  });

  test("a row opens its sheet: standing as a switch, the form, and the timeline in its colour", async ({ page }) => {
    const shop = await aShop("גיליון שירות");
    await openPanel(page, shop, "services");
    await row(page, "שירותים", "תספורת").getByRole("button").click();

    const dialog = sheet(page);
    await expect(dialog.getByRole("heading", { name: "תספורת" })).toBeVisible();
    const shown = dialog.getByRole("switch", { name: "מוצג ללקוחות" });
    await expect(shown).toHaveAttribute("aria-checked", "true");
    await expect(dialog.getByText("הסתרה לא נוגעת בתורים שכבר נקבעו.")).toBeVisible();

    // Minutes and price side by side.
    const minutes = await dialog.getByLabel(/משך/).boundingBox();
    const price = await dialog.getByLabel(/מחיר/).boundingBox();
    expect(Math.abs((minutes?.y ?? 0) - (price?.y ?? 1))).toBeLessThan(2);

    // The recovery timeline wears the service's colour.
    expect(await styleOf(dialog.locator(".buffer-track"))).toContain("--track-rail: var(--event-1)");

    // Hiding is saved with the rest.
    await shown.click();
    await expect(shown).toHaveAttribute("aria-checked", "false");
    await dialog.getByRole("button", { name: "שמירה" }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(row(page, "שירותים", "תספורת").locator(".list-tag")).toHaveText("מוסתר");
    let services = await call<{ id: string; active: boolean }[]>(`/businesses/${shop.business.id}/services`, { token: shop.owner.token });
    expect(services.find((service) => service.id === shop.service.id)?.active).toBe(false);

    // And shown again the same way.
    await row(page, "שירותים", "תספורת").getByRole("button").click();
    await sheet(page).getByRole("switch", { name: "מוצג ללקוחות" }).click();
    await sheet(page).getByRole("button", { name: "שמירה" }).click();
    await expect(sheet(page)).toBeHidden({ timeout: 15_000 });
    await expect(row(page, "שירותים", "תספורת").locator(".list-tag")).toHaveCount(0);
    services = await call(`/businesses/${shop.business.id}/services`, { token: shop.owner.token });
    expect(services.find((service) => service.id === shop.service.id)?.active).toBe(true);
  });

  test("closing the sheet without saving keeps the service as it was", async ({ page }) => {
    const shop = await aShop("בלי שמירה");
    await openPanel(page, shop, "services");
    await row(page, "שירותים", "תספורת").getByRole("button").click();
    await sheet(page).getByRole("switch", { name: "מוצג ללקוחות" }).click();
    await sheet(page).getByLabel(/שם השירות/).fill("שם אחר");
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();
    await expect(row(page, "שירותים", "תספורת")).toBeVisible();
    await expect(row(page, "שירותים", "תספורת").locator(".list-tag")).toHaveCount(0);
  });

  test("adding a service from the header: no switch, and it joins the list in the next colour", async ({ page }) => {
    const shop = await aShop("הוספת שירות");
    await openPanel(page, shop, "services");
    await page.getByRole("button", { name: "הוספה" }).click();
    const dialog = sheet(page);
    await expect(dialog.getByRole("heading", { name: "שירות חדש" })).toBeVisible();
    await expect(dialog.getByRole("switch")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "הסרת השירות" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "שמירה" })).toBeDisabled();
    await dialog.getByLabel(/שם השירות/).fill("זקן");
    await dialog.getByLabel(/משך/).fill("20");
    await dialog.getByLabel(/מחיר/).click();
    await dialog.getByLabel(/מחיר/).pressSequentially("40");
    await dialog.getByRole("button", { name: "שמירה" }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(rows(page, "שירותים")).toHaveCount(2);
    await expect(row(page, "שירותים", "זקן").locator(".list-line")).toHaveText(/^20 דק׳ · .*40.*₪$/);
    expect(await styleOf(row(page, "שירותים", "זקן").locator(".list-row"))).toContain("--rail: var(--event-2)");
    await expect(page.getByRole("heading", { name: /^שירותים/ })).toContainText("2");
  });

  test("removing a service is last in its sheet", async ({ page }) => {
    const shop = await aShop("הסרת שירות");
    const extra = await call<{ id: string }>(`/businesses/${shop.business.id}/services`, {
      method: "POST",
      token: shop.owner.token,
      body: { name: "זמני", durationMinutes: 20, priceMinor: 0, bufferMinutes: null },
    });
    await openPanel(page, shop, "services");
    await row(page, "שירותים", "זמני").getByRole("button").click();
    const remove = sheet(page).getByRole("button", { name: "הסרת השירות" });
    // Below saving: the action that takes something away comes last.
    const save = await sheet(page).getByRole("button", { name: "שמירה" }).boundingBox();
    expect((await remove.boundingBox())?.y ?? 0).toBeGreaterThan(save?.y ?? 0);
    await remove.click();
    await expect(sheet(page)).toBeHidden({ timeout: 15_000 });
    await expect(row(page, "שירותים", "זמני")).toHaveCount(0);
    const services = await call<{ id: string }[]>(`/businesses/${shop.business.id}/services`, { token: shop.owner.token });
    expect(services.some((service) => service.id === extra.id)).toBe(false);
  });

  test("the settings link in the sheet goes to the business's recovery time", async ({ page }) => {
    const shop = await aShop("קישור הגדרות");
    await openPanel(page, shop, "services");
    await row(page, "שירותים", "תספורת").getByRole("button").click();
    await sheet(page).getByRole("button", { name: /ברירת המחדל של העסק נקבעת בהגדרות העסק/ }).click();
    await expect(sheet(page)).toBeHidden();
    await expect(page.getByRole("button", { name: "הגדרות העסק" })).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("calendars", () => {
  const withCalendars = async () => {
    const shop = await aShop("יומנים");
    const t = shop.owner.token;
    const b = shop.business.id;
    await call(`/businesses/${b}/resources/${shop.resource.id}`, { method: "PATCH", token: t, body: { name: "דנה" } });
    const ron = await call<{ id: string }>(`/businesses/${b}/resources`, { method: "POST", token: t, body: { name: "רון" } });
    const maya = await call<{ id: string }>(`/businesses/${b}/resources`, { method: "POST", token: t, body: { name: "מאיה" } });
    const chair = await call<{ id: string }>(`/businesses/${b}/resources`, { method: "POST", token: t, body: { name: "כיסא 4" } });
    await call(`/businesses/${b}/resources/${chair.id}`, { method: "PATCH", token: t, body: { active: false } });
    // One a day for the same service, so two people book Dana's day.
    const first = await aCustomer("לקוח");
    const second = await aCustomer("לקוחה");
    await bookAs(shop, first, 2, "10:00", shop.resource.id);
    await bookAs(shop, second, 2, "12:00", shop.resource.id);
    await bookAs(shop, first, 3, "10:00", ron.id);
    return { shop, ron, maya, chair };
  };

  test("each wears its day-view colour, and says what is still booked on it", async ({ page }) => {
    const { shop } = await withCalendars();
    await openPanel(page, shop, "resources");
    await expect(rows(page, "יומנים")).toHaveCount(4);
    await expect(page.getByRole("heading", { name: /^יומנים/ })).toContainText("4");

    await expect(row(page, "יומנים", "דנה").locator(".list-line")).toHaveText("2 תורים קרובים");
    await expect(row(page, "יומנים", "רון").locator(".list-line")).toHaveText("תור קרוב אחד");
    await expect(row(page, "יומנים", "מאיה").locator(".list-line")).toHaveText("אין תורים קרובים");
    await expect(row(page, "יומנים", "כיסא 4").locator(".list-line")).toHaveText("לא מוצג ללקוחות");
    await expect(row(page, "יומנים", "כיסא 4").locator(".list-tag")).toHaveText("מוסתר");

    // The mark is the calendar's lane colour, by its place in the list.
    for (const [index, name] of ["דנה", "רון", "מאיה", "כיסא 4"].entries()) {
      expect(await styleOf(row(page, "יומנים", name).locator(".list-lead > span"))).toContain(`var(--lane-${index + 1})`);
    }
    await expect(page.getByText("יומן הוא כיסא, חדר או אדם. השעות של כל יומן נקבעות בלוח הזמנים.")).toBeVisible();
  });

  test("its sheet: hours on the schedule, renaming, hiding and showing, and deleting last", async ({ page }) => {
    const { shop, maya } = await withCalendars();
    await openPanel(page, shop, "resources");

    // Renaming.
    await row(page, "יומנים", "מאיה").getByRole("button").click();
    await expect(sheet(page).getByRole("heading", { name: "מאיה" })).toBeVisible();
    await sheet(page).getByRole("button", { name: "שינוי שם" }).click();
    const field = page.getByRole("dialog").getByLabel(/שם/);
    await field.fill("מאיה לוי");
    await field.press("Enter");
    await expect(row(page, "יומנים", "מאיה לוי")).toBeVisible({ timeout: 15_000 });

    // Back on the calendar's sheet, hiding takes it out of booking and says so.
    const shown = page.getByRole("dialog").getByRole("switch", { name: "מוצג ללקוחות" });
    await expect(shown).toHaveAttribute("aria-checked", "true");
    await shown.click();
    await expect(shown).toHaveAttribute("aria-checked", "false", { timeout: 15_000 });
    await expect(row(page, "יומנים", "מאיה לוי").locator(".list-tag")).toHaveText("מוסתר");
    let calendars = await call<{ id: string; active: boolean; name: string }[]>(`/businesses/${shop.business.id}/resources`, { token: shop.owner.token });
    expect(calendars.find((calendar) => calendar.id === maya.id)).toMatchObject({ active: false, name: "מאיה לוי" });
    await shown.click();
    await expect(shown).toHaveAttribute("aria-checked", "true", { timeout: 15_000 });
    calendars = await call(`/businesses/${shop.business.id}/resources`, { token: shop.owner.token });
    expect(calendars.find((calendar) => calendar.id === maya.id)?.active).toBe(true);

    // Deleting asks first, and goes.
    await page.getByRole("dialog").getByRole("button", { name: "מחיקת היומן" }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: /מאיה לוי/ })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "להסיר את היומן" }).click();
    await expect(row(page, "יומנים", "מאיה לוי")).toHaveCount(0, { timeout: 15_000 });
  });

  test("deleting a calendar with bookings asks what becomes of them", async ({ page }) => {
    const { shop } = await withCalendars();
    await openPanel(page, shop, "resources");
    await row(page, "יומנים", "רון").getByRole("button").click();
    await sheet(page).getByRole("button", { name: "מחיקת היומן" }).click();
    const ask = page.getByRole("dialog");
    await expect(ask.getByRole("button", { name: "להסיר ולהשאיר את התורים העתידיים" })).toBeVisible();
    await expect(ask.getByRole("button", { name: "להסיר ולבטל את התורים העתידיים" })).toBeVisible();
    await ask.getByRole("button", { name: "לא עכשיו" }).click();
    await expect(row(page, "יומנים", "רון")).toBeVisible();
  });

  test("hours and changes opens the schedule on that calendar", async ({ page }) => {
    const { shop, ron } = await withCalendars();
    await openPanel(page, shop, "resources");
    await row(page, "יומנים", "רון").getByRole("button").click();
    await sheet(page).getByRole("button", { name: "שעות ושינויים ביומן" }).click();
    await expect(page.getByRole("button", { name: "לוח זמנים" }).last()).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("רון").first()).toBeVisible();
    expect(ron.id).toBeTruthy();
  });

  test("the last calendar shown to customers cannot be hidden or deleted, and says why", async ({ page }) => {
    const shop = await aShop("אחרון");
    await openPanel(page, shop, "resources");
    await rows(page, "יומנים").first().getByRole("button").click();
    await expect(sheet(page).getByText("זה היומן האחרון שמוצג ללקוחות, ולכן אי אפשר להסתיר או למחוק אותו.")).toBeVisible();
    await expect(sheet(page).getByRole("switch")).toHaveCount(0);
    await expect(sheet(page).getByRole("button", { name: "מחיקת היומן" })).toHaveCount(0);
    await expect(sheet(page).getByRole("button", { name: "שינוי שם" })).toBeVisible();
  });

  test("with the plan full, adding waits: no add in the header, the lock says why, a hidden calendar cannot be shown", async ({ page }) => {
    const shop = await aShop("מלא", { plan: "SOLO" });
    // A second calendar, hidden, on a plan that holds one.
    const chair = await database()<{ id: string }[]>`
      insert into resource (id, business_id, name, active) values (gen_random_uuid(), ${shop.business.id}, 'כיסא נוסף', false) returning id`;
    expect(chair).toHaveLength(1);
    await openPanel(page, shop, "resources");
    await expect(page.getByRole("button", { name: "הוספה" })).toHaveCount(0);
    await expect(page.locator(".locked").first()).toBeVisible();
    await row(page, "יומנים", "כיסא נוסף").getByRole("button").click();
    const shown = sheet(page).getByRole("switch", { name: "מוצג ללקוחות" });
    await expect(shown).toBeDisabled();
    await expect(sheet(page).getByText("המסלול מלא: כדי להציג את היומן הזה צריך להסתיר יומן אחר או לעבור מסלול.")).toBeVisible();
  });

  test("adding a calendar from the header", async ({ page }) => {
    const shop = await aShop("יומן חדש");
    await openPanel(page, shop, "resources");
    await page.getByRole("button", { name: "הוספה" }).click();
    await sheet(page).locator("#res-name").fill("רון");
    await sheet(page).getByRole("button", { name: "הוספה" }).click();
    await expect(row(page, "יומנים", "רון")).toBeVisible({ timeout: 15_000 });
    await expect(sheet(page)).toBeHidden();
  });
});

test.describe("team", () => {
  test("rows say the role and a worker's calendars; your own row opens nothing; a colleague's sheet calls and edits", async ({ page }) => {
    const shop = await aShop("צוות");
    const t = shop.owner.token;
    const b = shop.business.id;
    const ron = await call<{ id: string }>(`/businesses/${b}/resources`, { method: "POST", token: t, body: { name: "רון" } });
    const worker = await aMember({ ...shop, second: shop.resource }, "WORKER", [ron.id], "רון");
    await call(`/businesses/${b}/users`, { method: "POST", token: t, body: { phone: uniquePhone(), givenName: "נועה", familyName: "לוי", role: "MANAGER", resourceIds: [] } });
    await openPanel(page, shop, "team");

    await expect(page.getByRole("heading", { name: /^צוות/ })).toContainText("3");
    await expect(page.getByRole("button", { name: "הזמנה" })).toBeVisible();

    // Your own row: marked, and not a button.
    const mine = rows(page, "צוות").filter({ has: page.locator(".list-you") });
    await expect(mine).toHaveCount(1);
    await expect(mine.locator(".list-you")).toHaveText("את/ה");
    await expect(mine.getByRole("button")).toHaveCount(0);

    // A worker's row names their calendar, in its colour.
    const workerRow = row(page, "צוות", "רון").filter({ hasNot: page.locator(".list-you") });
    await expect(workerRow.locator(".list-line")).toContainText("עובד ביומן");
    await expect(workerRow.locator(".list-line")).toContainText("רון");
    expect(await styleOf(workerRow.locator(".list-dot"))).toContain("var(--lane-2)");
    // Not signed up with a family name yet: said as a tag that does not break.
    await expect(workerRow.locator(".list-tag")).toHaveText("ממתין להצטרפות");

    // The worker's sheet: the number as dialled, the ways to reach them, the terms.
    await workerRow.getByRole("button").click();
    const dialog = sheet(page);
    await expect(dialog.getByRole("heading", { name: "רון" })).toBeVisible();
    await expect(dialog.getByText(dialled(worker.phone))).toBeVisible();
    await expect(dialog.getByRole("link", { name: new RegExp(`התקשרות`) })).toHaveAttribute("href", `tel:${worker.phone}`);
    await expect(dialog.getByRole("link", { name: /וואטסאפ/ })).toHaveAttribute("href", `https://wa.me/${worker.phone.replace(/\D/g, "")}`);
    await expect(dialog.getByRole("button", { name: /תפקיד/ })).toContainText("עובד ביומן");
    await expect(dialog.getByRole("button", { name: /יומנים/ })).toContainText("רון");

    // Changing the role goes through the same terms sheet as before.
    await dialog.getByRole("button", { name: /תפקיד/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^מנהל/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "שמירה" }).click();
    await expect(workerRow.locator(".list-line")).toHaveText("מנהל", { timeout: 15_000 });
  });

  test("removing a colleague is last in their sheet and asks first", async ({ page }) => {
    const shop = await aShop("הסרה");
    const member = await aMember({ ...shop, second: shop.resource }, "WORKER", [shop.resource.id], "שירה");
    await openPanel(page, shop, "team");
    await row(page, "צוות", "שירה").getByRole("button").click();
    await sheet(page).getByRole("button", { name: "הסרה מהצוות" }).click();
    const ask = page.getByRole("dialog");
    await expect(ask.getByRole("heading", { name: /שירה/ })).toBeVisible();
    await ask.getByRole("button", { name: "להסיר מהצוות" }).click();
    await expect(row(page, "צוות", "שירה")).toHaveCount(0, { timeout: 15_000 });
    const team = await call<{ phone: string }[]>(`/businesses/${shop.business.id}/users`, { token: shop.owner.token });
    expect(team.some((person) => person.phone === member.phone)).toBe(false);
  });

  test("a manager sees the owner's row, but it opens nothing", async ({ page }) => {
    const shop = await aShop("מנהל");
    const manager = await aMember({ ...shop, second: shop.resource }, "MANAGER", [], "נועה");
    await openPanel(page, shop, "team", manager.token);
    const owner = rows(page, "צוות").filter({ hasText: "בעלים" }).filter({ hasNot: page.locator(".list-you") });
    await expect(owner).toHaveCount(1);
    await expect(owner.getByRole("button")).toHaveCount(0);
  });

  test("inviting from the header adds the colleague to the list", async ({ page }) => {
    const shop = await aShop("הזמנה");
    await openPanel(page, shop, "team");
    await page.getByRole("button", { name: "הזמנה" }).click();
    const dialog = sheet(page);
    await dialog.getByLabel(/טלפון/).fill(uniquePhone().replace("+972", ""));
    await dialog.getByLabel(/שם פרטי/).fill("גיל");
    await dialog.getByRole("button", { name: /^עובד ביומן/ }).click();
    await dialog.getByRole("button", { name: /^יומן א$|יומן א/ }).first().click();
    await dialog.getByRole("button", { name: /^הוספה$|^הזמנה$/ }).last().click();
    await expect(row(page, "צוות", "גיל")).toBeVisible({ timeout: 15_000 });
  });

  test("without team roles on the plan, inviting is locked and the team stays listed", async ({ page }) => {
    const shop = await aShop("בלי צוות", { plan: "SOLO" });
    await openPanel(page, shop, "team");
    await expect(page.getByRole("button", { name: "הזמנה" })).toHaveCount(0);
    await expect(rows(page, "צוות")).toHaveCount(1);
    await expect(page.locator(".locked").first()).toBeVisible();
  });
});

test.describe("customers", () => {
  const withCustomers = async (count: number, blockedIndex: number | null = null) => {
    const shop = await aShop("לקוחות");
    const names = ["אורי שמש", "בן דוד", "ברק אלון", "גלית רז", "דנה לוי", "הדר כץ", "ורד מור", "זיו אור", "חן בר", "טל גיל", "יעל רון", "כרמל טל", "ליאת שני", "מיכל נוי"];
    const made: { id: string; name: string; phone: string }[] = [];
    // Booked in reverse, so the list's order is the list's doing.
    for (const [index, name] of names.slice(0, count).reverse().entries()) {
      const [givenName, familyName] = name.split(" ");
      const customer = await aCustomer(givenName ?? name, familyName ?? null);
      await bookAs(shop, customer, 3, `${String(7 + index).padStart(2, "0")}:00`);
      made.push({ id: customer.id, name, phone: customer.phone });
    }
    if (blockedIndex !== null) {
      const target = made.find((one) => one.name === names[blockedIndex]);
      await call(`/businesses/${shop.business.id}/customers/${target?.id}/blocked`, { method: "PATCH", token: shop.owner.token, body: { blocked: true } });
    }
    return { shop, made, names: names.slice(0, count) };
  };

  test("sorted by name, with each number as dialled, a red tag for the blocked, and no letters in a short list", async ({ page }) => {
    const { shop, made, names } = await withCustomers(5, 1);
    await signedIn(page, shop.owner.token);
    await page.goto(`/manage?business=${shop.business.id}&tab=customers`);
    await ready(page);
    await expect(page.getByRole("heading", { name: /^לקוחות/ })).toContainText("5");
    await expect(rows(page, "לקוחות").locator(".list-title")).toHaveText(names);
    await expect(list(page, "לקוחות").locator(".list-divider")).toHaveCount(0);
    const uri = made.find((one) => one.name === "אורי שמש");
    await expect(row(page, "לקוחות", "אורי שמש").locator(".list-line")).toHaveText(dialled(uri?.phone ?? ""));
    await expect(row(page, "לקוחות", "בן דוד").locator(".list-tag")).toHaveText("חסום");
    await expect(row(page, "לקוחות", "אורי שמש").locator(".list-tag")).toHaveCount(0);
    await expect(page.getByText("פעיל", { exact: true })).toHaveCount(0);
  });

  test("the filter says how many each holds, and search narrows the list", async ({ page }) => {
    const { shop } = await withCustomers(5, 1);
    await signedIn(page, shop.owner.token);
    await page.goto(`/manage?business=${shop.business.id}&tab=customers`);
    await ready(page);
    const filters = page.getByRole("group", { name: "סינון הלקוחות" });
    await expect(filters.getByRole("button")).toHaveText(["הכול 5", "פעילים 4", "חסומים 1"]);
    await expect(filters.getByRole("button", { name: "הכול 5" })).toHaveAttribute("aria-pressed", "true");

    await filters.getByRole("button", { name: "חסומים 1" }).click();
    await expect(rows(page, "לקוחות").locator(".list-title")).toHaveText(["בן דוד"]);
    await filters.getByRole("button", { name: "פעילים 4" }).click();
    await expect(rows(page, "לקוחות")).toHaveCount(4);
    await expect(row(page, "לקוחות", "בן דוד")).toHaveCount(0);

    await filters.getByRole("button", { name: "הכול 5" }).click();
    await page.getByLabel("חיפוש לפי שם או טלפון").fill("גלית");
    await expect(rows(page, "לקוחות").locator(".list-title")).toHaveText(["גלית רז"]);
    await page.getByLabel("חיפוש לפי שם או טלפון").fill("אין כזה");
    await expect(page.getByText("אין לקוחות להצגה")).toBeVisible();
    // The note is said once, in the empty state, not again under it.
    await expect(page.getByText("לקוח נוצר ברגע שהוא קובע תור. אין ״הוספת לקוח״ ידנית.")).toHaveCount(1);
  });

  test("past a dozen, the list is split by first letter", async ({ page }) => {
    const { shop, names } = await withCustomers(14);
    await signedIn(page, shop.owner.token);
    await page.goto(`/manage?business=${shop.business.id}&tab=customers`);
    await ready(page);
    await expect(rows(page, "לקוחות")).toHaveCount(14);
    const letters = [...new Set(names.map((name) => name.charAt(0)))];
    await expect(list(page, "לקוחות").locator(".list-divider")).toHaveText(letters);
  });

  test("a row opens the customer's page", async ({ page }) => {
    const { shop, made } = await withCustomers(2);
    await signedIn(page, shop.owner.token);
    await page.goto(`/manage?business=${shop.business.id}&tab=customers`);
    await ready(page);
    await row(page, "לקוחות", "בן דוד").getByRole("button").click();
    const ben = made.find((one) => one.name === "בן דוד");
    await expect(page).toHaveURL(new RegExp(`/manage/customers/${ben?.id}\\?business=${shop.business.id}`));
  });
});

test.describe("the customer page", () => {
  /** A regular: some appointments to come, and a history behind them. */
  const aRegular = async (options: { upcoming: number; past: number; plan?: "SOLO" | "TEAM" }) => {
    const shop = await aShop("עמוד לקוח", options.plan === undefined ? {} : { plan: options.plan });
    const customer = await aCustomer("אביגיל", "פרץ");
    const past: string[] = [];
    for (let index = 0; index < options.past; index += 1) {
      past.push((await bookAs(shop, customer, 30 + index, "10:00")).id);
    }
    for (const [index, id] of past.entries()) await intoThePast(id, (index + 1) * 6);
    const upcoming: string[] = [];
    for (let index = 0; index < options.upcoming; index += 1) {
      upcoming.push((await bookAs(shop, customer, 2 + index * 2, "16:00")).id);
    }
    return { shop, customer, past, upcoming };
  };

  const openRecord = async (page: Page, shop: Shop, customerId: string) => {
    await signedIn(page, shop.owner.token);
    await page.goto(`/manage/customers/${customerId}?business=${shop.business.id}`);
    await ready(page);
    await expect(page.locator(".record-band")).toBeVisible({ timeout: 15_000 });
  };

  test("the band says who and how to reach them; the tiles count; booking is pinned", async ({ page }) => {
    const { shop, customer, past } = await aRegular({ upcoming: 2, past: 3 });
    await call(`/appointments/${past[0]}/no-show`, { method: "POST", token: shop.owner.token });
    await openRecord(page, shop, customer.id);

    const band = page.locator(".record-band");
    await expect(band.getByRole("heading", { level: 1 })).toHaveText("אביגיל פרץ");
    await expect(band.getByText(dialled(customer.phone))).toBeVisible();
    await expect(band.locator(".record-since")).toHaveText(/^לקוח מאז \S+ \d{4}$/);
    await expect(band.getByRole("link", { name: /התקשרות/ })).toHaveAttribute("href", `tel:${customer.phone}`);
    await expect(band.getByRole("link", { name: /וואטסאפ/ })).toHaveAttribute("href", `https://wa.me/${customer.phone.replace(/\D/g, "")}`);

    const tiles = page.locator(".record-tiles");
    await expect(tiles.locator("[data-tile=visits] dd")).toHaveText("5");
    await expect(tiles.locator("[data-tile=no-shows] dd")).toHaveText("1");
    await expect(tiles.locator("[data-tile=no-shows]")).toHaveClass(/warn/);
    await expect(tiles.locator("[data-tile=late] dd")).toHaveText("0");
    await expect(tiles.locator("[data-tile=late]")).not.toHaveClass(/warn/);

    const book = page.getByRole("button", { name: "תור חדש לאביגיל" });
    await expect(book).toBeInViewport();
    await book.click();
    await expect(page).toHaveURL(new RegExp(`/manage\\?business=${shop.business.id}&book=${customer.id}`));
  });

  test("up to three upcoming are all shown, the first as the next one, with nothing to fold", async ({ page }) => {
    const { shop, customer } = await aRegular({ upcoming: 3, past: 0 });
    await openRecord(page, shop, customer.id);
    const card = page.locator(".upcoming-card");
    await expect(card.getByRole("heading", { name: "התור הבא" })).toBeVisible();
    await expect(card.locator(".upcoming-next")).toContainText("16:00");
    await expect(card.locator(".upcoming-rest .dated-row")).toHaveCount(2);
    await expect(card.locator(".upcoming-toggle")).toHaveCount(0);
  });

  test("past three, the rest fold behind 'עוד N', open in place, and fold again", async ({ page }) => {
    const { shop, customer } = await aRegular({ upcoming: 7, past: 0 });
    await openRecord(page, shop, customer.id);
    const card = page.locator(".upcoming-card");
    const toggle = card.locator(".upcoming-toggle");
    await expect(card.locator(".upcoming-rest .dated-row")).toHaveCount(2);
    await expect(toggle).toHaveText("עוד 4 תורים קרובים");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(card.locator(".upcoming-rest .dated-row")).toHaveCount(6);
    await expect(toggle).toHaveText("הצגת פחות");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await expect(card.locator(".upcoming-rest .dated-row")).toHaveCount(2);
    await expect(toggle).toHaveText("עוד 4 תורים קרובים");
  });

  test("exactly four upcoming fold one, said as one", async ({ page }) => {
    const { shop, customer } = await aRegular({ upcoming: 4, past: 0 });
    await openRecord(page, shop, customer.id);
    await expect(page.locator(".upcoming-toggle")).toHaveText("עוד תור קרוב אחד");
  });

  test("every upcoming appointment opens its own sheet, as the calendar does", async ({ page }) => {
    const { shop, customer } = await aRegular({ upcoming: 5, past: 0 });
    await openRecord(page, shop, customer.id);
    await page.locator(".upcoming-next").click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "מה קרה עם התור הזה" })).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("תספורת");
    await page.keyboard.press("Escape");
    await page.locator(".upcoming-toggle").click();
    await page.locator(".upcoming-rest .dated-row").last().click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "מה קרה עם התור הזה" })).toBeVisible();
  });

  test("no upcoming appointments means no card at all", async ({ page }) => {
    const { shop, customer } = await aRegular({ upcoming: 0, past: 2 });
    await openRecord(page, shop, customer.id);
    await expect(page.locator(".upcoming-card")).toHaveCount(0);
    await expect(page.locator(".history .dated-row")).toHaveCount(2);
  });

  test("the history: newest first, what happened in a tag, and a cancellation struck through", async ({ page }) => {
    const { shop, customer, past } = await aRegular({ upcoming: 1, past: 3 });
    await call(`/appointments/${past[1]}/no-show`, { method: "POST", token: shop.owner.token });
    const cancelled = await bookAs(shop, customer, 40, "11:00");
    await call(`/appointments/${cancelled.id}/cancel`, { method: "POST", token: customer.token });
    await intoThePast(cancelled.id, 40);
    await openRecord(page, shop, customer.id);

    const history = page.locator(".history .dated-row");
    await expect(history).toHaveCount(4);
    await expect(page.locator(".history .list-divider")).toHaveCount(0);
    await expect(history.locator(".list-tags")).toHaveText(["התקיים", "לא הגיע", "התקיים", "בוטל"]);
    await expect(history.last().locator(".list-title")).toHaveClass(/cancelled/);
    // A cancelled one was never paid: no price on it.
    await expect(history.last().locator(".list-line")).not.toContainText("₪");
    await expect(history.first().locator(".list-line")).toContainText("₪");
  });

  test("past a dozen visits, the history is split by month", async ({ page }) => {
    const { shop, customer } = await aRegular({ upcoming: 0, past: 14 });
    await openRecord(page, shop, customer.id);
    await expect(page.locator(".history .dated-row")).toHaveCount(14);
    const months = await page.locator(".history .list-divider").allTextContents();
    expect(months.length).toBeGreaterThan(1);
    expect(months.every((month) => /\S+ \d{4}/.test(month))).toBe(true);
  });

  test("blocking asks first, then says so in the band and stops booking; lifting it brings booking back", async ({ page }) => {
    const { shop, customer } = await aRegular({ upcoming: 1, past: 1 });
    await openRecord(page, shop, customer.id);

    // Cancelling the question changes nothing.
    await page.getByRole("button", { name: /חסימת הלקוח/ }).click();
    const ask = page.getByRole("dialog", { name: "לחסום את אביגיל פרץ?" });
    await expect(ask).toBeVisible();
    await expect(ask).toContainText("לקוח חסום לא יכול לקבוע תורים חדשים אצלכם.");
    await ask.getByRole("button", { name: "ביטול" }).click();
    await expect(ask).toBeHidden();
    await expect(page.locator(".record-blocked")).toHaveCount(0);

    await page.getByRole("button", { name: /חסימת הלקוח/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "חסימה" }).click();
    await expect(page.locator(".record-blocked")).toHaveText("חסום · לא יכול לקבוע תורים חדשים", { timeout: 15_000 });
    await expect(page.getByRole("button", { name: /תור חדש ל/ })).toHaveCount(0);
    await expect(page.locator(".record-since")).toHaveCount(0);
    let record = await call<{ blocked: boolean }>(`/businesses/${shop.business.id}/customers/${customer.id}`, { token: shop.owner.token });
    expect(record.blocked).toBe(true);

    // Lifting it is not red and asks nothing: it undoes.
    const lift = page.getByRole("button", { name: /ביטול החסימה/ });
    await expect(lift).not.toHaveClass(/danger/);
    await lift.click();
    await expect(page.locator(".record-blocked")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "תור חדש לאביגיל" })).toBeVisible();
    record = await call(`/businesses/${shop.business.id}/customers/${customer.id}`, { token: shop.owner.token });
    expect(record.blocked).toBe(false);
  });

  test("without Customer History, the counts and the past are one lock; the band, what is coming and booking stay", async ({ page }) => {
    const { shop, customer } = await aRegular({ upcoming: 2, past: 2, plan: "SOLO" });
    await openRecord(page, shop, customer.id);
    await expect(page.locator(".record-tiles")).toHaveCount(0);
    await expect(page.locator(".history")).toHaveCount(0);
    await expect(page.locator(".locked").first()).toBeVisible();
    await expect(page.locator(".record-since")).toHaveCount(0);
    await expect(page.locator(".upcoming-card")).toBeVisible();
    await expect(page.getByRole("button", { name: "תור חדש לאביגיל" })).toBeVisible();
    await expect(page.getByRole("button", { name: /חסימת הלקוח/ })).toHaveCount(0);
  });

  test("an owner's own record has no blocking row", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aShop("בעלים כלקוח", { ownerPhone });
    await bookAs(shop, shop.owner, 2, "11:00");
    await openRecord(page, shop, shop.owner.user.id);
    await expect(page.locator(".record-band")).toBeVisible();
    await expect(page.getByRole("button", { name: /חסימת הלקוח/ })).toHaveCount(0);
  });
});

test.describe("in English, and on a narrow phone", () => {
  test("the lists and the customer page speak English", async ({ page }) => {
    await useEnglish(page);
    const shop = await aShop("English");
    const customer = await aCustomer("Dana", "Levi");
    await bookAs(shop, customer, 2, "10:00");
    await openPanel(page, shop, "services");
    await expect(page.getByRole("heading", { name: /^Services/ })).toContainText("1");
    await expect(page.getByRole("button", { name: "Add" })).toBeVisible();
    await expect(rows(page, "Services").first().locator(".list-line")).toHaveText(/^30 min · ₪80$/);
    await page.goto(`/manage/customers/${customer.id}?business=${shop.business.id}`);
    await ready(page);
    await expect(page.locator(".record-since")).toHaveText(/^A customer since \w+ \d{4}$/);
    await expect(page.getByRole("heading", { name: "Next appointment" })).toBeVisible();
    await expect(page.getByRole("button", { name: "New appointment for Dana" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Block this customer/ })).toBeVisible();
  });

  test("320px: nothing scrolls sideways, in the lists or on the customer page", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "a phone width");
    await page.setViewportSize({ width: 320, height: 640 });
    const shop = await aShop("צר מאוד עם שם ארוך");
    const customer = await aCustomer("אביגיל", "פרץ-רוזנבלום");
    await bookAs(shop, customer, 2, "10:00");
    await call(`/businesses/${shop.business.id}/services`, {
      method: "POST",
      token: shop.owner.token,
      body: { name: "טיפול פנים מלא עם עיסוי ומסכה", durationMinutes: 120, priceMinor: 125050, bufferMinutes: 30 },
    });
    await openPanel(page, shop, "services");
    expect(await noSidewaysScroll(page)).toBe(true);
    await rows(page, "שירותים").last().getByRole("button").click();
    expect(await noSidewaysScroll(page)).toBe(true);
    await page.keyboard.press("Escape");
    await page.goto(`/manage/customers/${customer.id}?business=${shop.business.id}`);
    await ready(page);
    await expect(page.locator(".record-band")).toBeVisible();
    expect(await noSidewaysScroll(page)).toBe(true);
  });
});
