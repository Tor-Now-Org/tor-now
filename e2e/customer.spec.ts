import { expect, test } from "@playwright/test";
import {
  aBusinessWithOpenHours,
  ready,
  signInDirectly,
  uniquePhone,
  useEnglish,
} from "./support.ts";

/**
 * The customer artboard: search, choose a service, choose a time, verify inline,
 * confirm, and see the appointment afterwards.
 */
test.describe("finding and booking", () => {
  test("the front door explains itself before anything is typed", async ({ page }) => {
    await page.goto("/");
    await ready(page);

    await expect(page.getByRole("heading", { level: 1 })).toContainText("התור הבא שלך");
    await expect(page.getByPlaceholder("מספרה, קליניקה, מאמן אישי…")).toBeVisible();
    // Both tabs are reachable from the first screen.
    await expect(page.getByRole("button", { name: "חיפוש" })).toBeVisible();
    await expect(page.getByRole("button", { name: "התורים שלי" })).toBeVisible();
  });

  test("says nothing useful until the query can be ranked", async ({ page }) => {
    await page.goto("/");
    await ready(page);

    const search = page.getByPlaceholder("מספרה, קליניקה, מאמן אישי…");
    await search.fill("מ");
    await expect(page.getByText("עוד אות אחת ומתחילים לחפש")).toBeVisible();
  });

  test("finds a business by part of its name and opens it", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `מספרת בדיקה ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });

    await page.goto("/");
    await ready(page);
    await page.getByPlaceholder("מספרה, קליניקה, מאמן אישי…").fill("מספרת בדיקה");

    const card = page.getByText(shop.business.id ? "מספרת בדיקה" : "", { exact: false }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.click();

    await expect(page.getByText("בוחרים שירות")).toBeVisible();
    await expect(page.getByText("תספורת")).toBeVisible();
    await expect(page.getByText("בוחרים שעה")).toBeVisible();
  });

  test("shows nothing found for a name that is not there", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    await page.getByPlaceholder("מספרה, קליניקה, מאמן אישי…").fill("זזזזזזזזזז");
    await expect(page.getByText("לא מצאנו עסק כזה")).toBeVisible({ timeout: 15_000 });
  });

  test("books a slot, verifying the phone inline on the way", async ({ page }) => {
    const name = `קליניקה ${Date.now()}`;
    await aBusinessWithOpenHours({ name, ownerPhone: uniquePhone() });

    await page.goto("/");
    await ready(page);
    await page.getByPlaceholder("מספרה, קליניקה, מאמן אישי…").fill(name.slice(0, 8));
    await page.getByText(name, { exact: false }).first().click();

    // The first offered time.
    const firstSlot = page.locator("[role=radio]", { hasText: /^\d\d:\d\d$/ }).first();
    await expect(firstSlot).toBeVisible({ timeout: 20_000 });
    const chosen = (await firstSlot.textContent())?.trim();
    await firstSlot.click();

    // The confirmation sheet, then verification, because there is no session.
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("מאשרים את התור")).toBeVisible();
    await page.getByRole("button", { name: "אישור התור" }).click();

    await expect(page.getByText("מאמתים מספר טלפון")).toBeVisible();
    await page.getByLabel("מספר טלפון").fill(uniquePhone());
    await page.getByRole("button", { name: "שליחת קוד" }).click();

    // The deployment has no delivery channel, so the code is on screen.
    const notice = page.getByText(/code is returned here: (\d+)/);
    await expect(notice).toBeVisible({ timeout: 15_000 });
    const code = (await notice.textContent())?.match(/(\d{4,8})/)?.[1] ?? "";

    await page.getByLabel("הקוד שקיבלתם").fill(code);
    // The name is not asked for alongside the code: the number has to be
    // verified before the system may say whether it already belongs to anyone.
    await expect(page.getByLabel("שם פרטי")).toHaveCount(0);
    await page.getByRole("button", { name: "אישור הקוד" }).click();

    // This number is new, so now it asks — once, and with no example name
    // sitting in the field.
    await expect(page.getByLabel("שם פרטי")).toBeVisible();
    expect(await page.getByLabel("שם פרטי").getAttribute("placeholder")).toBeNull();
    expect(await page.getByLabel("שם משפחה").getAttribute("placeholder")).toBeNull();
    await page.getByLabel("שם פרטי").fill("דנה");
    await page.getByLabel("שם משפחה").fill("כהן");
    await page.getByRole("button", { name: "ממשיכים" }).click();

    await expect(page.getByRole("button", { name: "אישור התור" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "אישור התור" }).click();

    await expect(page.getByText("התור נקבע")).toBeVisible({ timeout: 20_000 });

    // And it is in the customer's own list, at the time they picked.
    await page.getByRole("button", { name: "לתורים שלי" }).click();
    // The heading, not the navigation item: they are the same two words, and on
    // the desktop layout the rail keeps its label on screen beside the list.
    await expect(page.getByRole("heading", { name: "התורים שלי" })).toBeVisible();
    if (chosen !== undefined) {
      await expect(page.getByText(chosen, { exact: false }).first()).toBeVisible();
    }
  });

  test("a booked slot stops being offered", async ({ page, request }) => {
    const name = `סטודיו ${Date.now()}`;
    const shop = await aBusinessWithOpenHours({ name, ownerPhone: uniquePhone() });

    await page.goto("/");
    await ready(page);
    await page.getByPlaceholder("מספרה, קליניקה, מאמן אישי…").fill(name.slice(0, 7));
    await page.getByText(name, { exact: false }).first().click();

    const slots = page.locator("[role=radio]", { hasText: /^\d\d:\d\d$/ });
    await expect(slots.first()).toBeVisible({ timeout: 20_000 });
    const before = await slots.count();
    const takenLabel = (await slots.first().textContent())?.trim();

    // Someone else takes it, out of band.
    const phone = uniquePhone();
    const codeResponse = await request.post(`${process.env["E2E_API_URL"] ?? "http://127.0.0.1:8787/api"}/auth/request-code`, {
      data: { phone },
    });
    const { code } = (await codeResponse.json()) as { code: string };
    const sessionResponse = await request.post(`${process.env["E2E_API_URL"] ?? "http://127.0.0.1:8787/api"}/auth/verify`, {
      data: { phone, code, name: "אחר" },
    });
    const session = (await sessionResponse.json()) as { token: string };

    const availability = await request.get(
      `${process.env["E2E_API_URL"] ?? "http://127.0.0.1:8787/api"}/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}&resourceId=${shop.resource.id}&from=${today()}&to=${today()}`,
    );
    const days = (await availability.json()) as { slots: { startAt: string }[] }[];

    await request.post(`${process.env["E2E_API_URL"] ?? "http://127.0.0.1:8787/api"}/appointments`, {
      headers: { Authorization: `Bearer ${session.token}` },
      data: {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: shop.resource.id,
        startAt: days[0]!.slots[0]!.startAt,
        customerNote: null,
      },
    });

    await page.reload();
    await ready(page);
    await page.getByPlaceholder("מספרה, קליניקה, מאמן אישי…").fill(name.slice(0, 7));
    await page.getByText(name, { exact: false }).first().click();
    await expect(slots.first()).toBeVisible({ timeout: 20_000 });

    expect(await slots.count()).toBe(before - 1);
    if (takenLabel !== undefined) {
      await expect(page.getByRole("radio", { name: takenLabel, exact: true })).toHaveCount(0);
    }
  });
});

test.describe("a customer's own appointments", () => {
  test("cancels an appointment and is warned about the notice period", async ({ page }) => {
    const name = `מכון ${Date.now()}`;
    const shop = await aBusinessWithOpenHours({ name, ownerPhone: uniquePhone() });
    const phone = uniquePhone();
    const session = await signInDirectly(page, phone, "דנה");

    const days = await (await fetch(
      `${process.env["E2E_API_URL"] ?? "http://127.0.0.1:8787/api"}/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}&resourceId=${shop.resource.id}&from=${today()}&to=${today()}`,
    )).json() as { slots: { startAt: string }[] }[];

    await fetch(`${process.env["E2E_API_URL"] ?? "http://127.0.0.1:8787/api"}/appointments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: shop.resource.id,
        startAt: days[0]!.slots[0]!.startAt,
        customerNote: null,
      }),
    });

    await page.goto("/");
    await ready(page);
    await page.getByRole("button", { name: "התורים שלי" }).click();
    await expect(page.getByText("תספורת").first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "ביטול התור" }).first().click();
    // The window governs visibility, not permission: warned, and still allowed.
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText(/חלון ההתראה|תמיד מתאפשר/)).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "ביטול התור" }).click();

    await expect(page.getByText("בוטל").first()).toBeVisible({ timeout: 15_000 });
  });

  test("an empty list says so rather than showing nothing", async ({ page }) => {
    await signInDirectly(page, uniquePhone(), "ריק");
    await page.goto("/");
    await ready(page);
    await page.getByRole("button", { name: "התורים שלי" }).click();
    await expect(page.getByText("אין לכם תורים קרובים")).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("leaving", () => {
  /**
   * There was no way out: the drawer's only sign-out control was labelled
   * "back to customer", and the owner and administrator screens had none at
   * all. The label is what the test asserts, because the action was never the
   * part that was missing.
   */
  test("signs out from the account drawer and forgets the device", async ({ page }) => {
    const phone = uniquePhone();
    await signInDirectly(page, phone, "יעל אבידן");
    await page.goto("/");
    await ready(page);

    await page.getByRole("button", { name: "החשבון שלי" }).click();
    await page.getByRole("button", { name: "התנתקות" }).click();

    // The account button is the header's only evidence of a session.
    await expect(page.getByRole("button", { name: "החשבון שלי" })).toHaveCount(0);
    // The stored token is what a reload would restore from, so checking it is
    // gone is the durable half. A reload cannot be asserted here: the sign-in
    // helper plants the token with addInitScript, which runs again on every
    // navigation and would put it straight back.
    expect(
      await page.evaluate(() => window.localStorage.getItem("tor-now.session")),
    ).toBeNull();
  });

  test("the same control is on the profile screen", async ({ page }) => {
    await signInDirectly(page, uniquePhone(), "יעל אבידן");
    await page.goto("/");
    await ready(page);

    await page.getByRole("button", { name: "החשבון שלי" }).click();
    await page.getByRole("button", { name: "הפרטים שלי" }).click();

    await expect(page.getByRole("button", { name: "התנתקות" })).toBeVisible();
  });
});

test.describe("signing in again", () => {
  /**
   * The complaint that produced this: a customer who had already given their
   * name was asked for it again on every sign-in. The panel cannot know whether
   * a number is new until the code is checked — asking the API sooner would let
   * anyone learn who has an account here, one message at a time — so the name
   * step exists, and a returning customer must never reach it.
   */
  test("a returning customer is never asked for a name again", async ({ page }) => {
    const phone = uniquePhone();
    await signInDirectly(page, phone, "יעל אבידן");
    await page.goto("/");
    await ready(page);

    // Leave, so the next sign-in is a real one through the interface.
    await page.getByRole("button", { name: "החשבון שלי" }).click();
    await page.getByRole("button", { name: "התנתקות" }).click();
    await expect(page.getByRole("button", { name: "החשבון שלי" })).toHaveCount(0);

    await page.getByRole("button", { name: "התורים שלי" }).click();
    await page.getByLabel("מספר טלפון").fill(phone);
    await page.getByRole("button", { name: "שליחת קוד" }).click();

    const notice = page.getByText(/code is returned here: (\d+)/);
    await expect(notice).toBeVisible({ timeout: 15_000 });
    const code = (await notice.textContent())?.match(/(\d{4,8})/)?.[1] ?? "";

    await page.getByLabel("הקוד שקיבלתם").fill(code);
    await page.getByRole("button", { name: "אישור הקוד" }).click();

    // Straight in, with the name they gave the first time still on the account.
    await expect(page.getByRole("button", { name: "החשבון שלי" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByLabel("שם פרטי")).toHaveCount(0);

    await page.getByRole("button", { name: "החשבון שלי" }).click();
    await page.getByRole("button", { name: "הפרטים שלי" }).click();
    await expect(page.getByLabel("שם פרטי")).toHaveValue("יעל");
  });
});

test.describe("both languages", () => {
  test("the whole screen turns around when the language changes", async ({ page }) => {
    await page.goto("/");
    await ready(page);

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "he");

    await page.getByRole("button", { name: "EN" }).click();

    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Your next appointment");
  });

  test("remembers the choice across a reload", async ({ page }) => {
    await useEnglish(page);
    await page.goto("/");
    await ready(page);
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  });
});

const today = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
