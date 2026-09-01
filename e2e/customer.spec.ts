import { expect, test } from "@playwright/test";
import {
  aBusinessWithOpenHours,
  call,
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

test.describe("an API older than the interface", () => {
  /**
   * The two halves deploy separately, so for a few minutes a browser running
   * the new page talks to the function that came before it. A page that assumes
   * a field it has never seen before goes blank for everybody in that window —
   * which is exactly what the photos field did, on a screen that had no test
   * for the absence because nothing was absent locally.
   */
  test("a business page still draws when the profile carries no photos", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `בלי תמונות ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });

    // The response an older function would have sent: no photos field at all.
    await page.route(`**/businesses/${shop.business.id}?*`, async (route) => {
      const answer = await route.fetch();
      const body = (await answer.json()) as Record<string, unknown>;
      delete body["photos"];
      await route.fulfill({ response: answer, json: body });
    });

    await page.goto("/");
    await ready(page);
    await page.getByPlaceholder("מספרה, קליניקה, מאמן אישי…").fill(shop.business.name.slice(0, 8));
    await page.getByText(shop.business.name).first().click();

    // The screen is the screen, minus the pictures nobody sent.
    await expect(page.getByRole("heading", { name: shop.business.name })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(shop.service.name).first()).toBeVisible();
    await expect(page.getByRole("region", { name: "תמונות מהעסק" })).toHaveCount(0);
  });
});

test.describe("the way in", () => {
  test("the header offers a way in before anyone has signed in", async ({ page }) => {
    await page.goto("/");
    await ready(page);

    // The same corner as the account circle, because it is the same control.
    const wayIn = page.getByRole("button", { name: "כניסה או הרשמה" });
    await expect(wayIn).toBeVisible();
    await expect(page.getByRole("button", { name: "החשבון שלי" })).toHaveCount(0);

    await wayIn.click();
    await expect(page.getByLabel("מספר טלפון")).toBeVisible();
  });

  test("signing in from the header leaves you where you were", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `דלת כניסה ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });

    await page.goto("/");
    await ready(page);
    await page.getByPlaceholder("מספרה, קליניקה, מאמן אישי…").fill(shop.business.name.slice(0, 8));
    await page.getByText(shop.business.name).first().click();
    await expect(page.getByText(shop.service.name).first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "כניסה או הרשמה" }).click();
    await page.getByLabel("מספר טלפון").fill(uniquePhone());
    await page.getByRole("button", { name: "שליחת קוד" }).click();

    const notice = page.getByText(/code is returned here: (\d+)/);
    await expect(notice).toBeVisible({ timeout: 15_000 });
    const code = (await notice.textContent())?.match(/(\d{4,8})/)?.[1] ?? "";
    await page.getByLabel("הקוד שקיבלתם").fill(code);
    await page.getByRole("button", { name: "אישור הקוד" }).click();
    await page.getByLabel("שם פרטי").fill("דנה");
    await page.getByLabel("שם משפחה").fill("כהן");
    await page.getByRole("button", { name: "ממשיכים" }).click();

    // Still on the business they were reading, now with an account.
    await expect(page.getByRole("button", { name: "החשבון שלי" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(shop.service.name).first()).toBeVisible();
  });
});

test.describe("a cancelled appointment", () => {
  test("stays on the list, struck through rather than gone", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `ביטול ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });
    const phone = uniquePhone();
    const { token } = await signInDirectly(page, phone, "דנה כהן");

    const [day] = await call<{ slots: { startAt: string }[] }[]>(
      `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
        `&resourceId=${shop.resource.id}&from=${today()}&to=${today()}`,
    );
    const slot = day?.slots[0]?.startAt ?? "";
    const booking = await call<{ id: string }>("/appointments", {
      method: "POST",
      token,
      body: {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: shop.resource.id,
        startAt: slot,
        customerNote: null,
      },
    });
    await call(`/appointments/${booking.id}/cancel`, { method: "POST", token });

    await page.goto("/");
    await ready(page);
    await page.getByRole("button", { name: "התורים שלי" }).click();

    // Still listed — a customer wants to see that it was called off, not find
    // it silently missing — and struck through so that reads without reading.
    const struck = page.locator(".cancelled").first();
    await expect(struck).toBeVisible({ timeout: 15_000 });
    await expect(struck).toHaveCSS("text-decoration-line", "line-through");
  });
});

test.describe("what a form will not accept", () => {
  test("signing up asks for both halves of a name and will not go on without them", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    await page.getByRole("button", { name: "כניסה או הרשמה" }).click();

    // A local number is the mistake people actually make, and it is refused
    // before the code is ever sent.
    const phone = page.getByLabel("מספר טלפון");
    await phone.fill("0501234567");
    await phone.blur();
    await expect(page.getByText(/פורמט בינלאומי/)).toBeVisible();
    await expect(page.getByRole("button", { name: "שליחת קוד" })).toBeDisabled();

    await phone.fill(uniquePhone());
    await expect(page.getByRole("button", { name: "שליחת קוד" })).toBeEnabled();
    await page.getByRole("button", { name: "שליחת קוד" }).click();

    const notice = page.getByText(/code is returned here: (\d+)/);
    await expect(notice).toBeVisible({ timeout: 15_000 });
    const code = (await notice.textContent())?.match(/(\d{4,8})/)?.[1] ?? "";
    await page.getByLabel("הקוד שקיבלתם").fill(code);
    await page.getByRole("button", { name: "אישור הקוד" }).click();

    // Neither half may be skipped.
    const goOn = page.getByRole("button", { name: "ממשיכים" });
    await expect(goOn).toBeDisabled();
    await page.getByLabel("שם פרטי").fill("יעל");
    await expect(goOn).toBeDisabled();
    await page.getByLabel("שם משפחה").fill("אבידן");
    await expect(goOn).toBeEnabled();

    await goOn.click();
    await expect(page.getByRole("button", { name: "החשבון שלי" })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("someone who abandoned the name step is asked again, not let through", async ({ page }) => {
    // A row with a verified number and no name: exactly what closing the sheet
    // on the name step leaves behind.
    const phone = uniquePhone();
    const { code } = await call<{ code: string }>("/auth/request-code", {
      method: "POST",
      body: { phone },
    });
    await call("/auth/verify", { method: "POST", body: { phone, code } });

    await page.goto("/");
    await ready(page);
    await page.getByRole("button", { name: "כניסה או הרשמה" }).click();
    await page.getByLabel("מספר טלפון").fill(phone);
    await page.getByRole("button", { name: "שליחת קוד" }).click();

    const notice = page.getByText(/code is returned here: (\d+)/);
    await expect(notice).toBeVisible({ timeout: 15_000 });
    const again = (await notice.textContent())?.match(/(\d{4,8})/)?.[1] ?? "";
    await page.getByLabel("הקוד שקיבלתם").fill(again);
    await page.getByRole("button", { name: "אישור הקוד" }).click();

    // Returning, but still nameless — so the question comes round again.
    await expect(page.getByLabel("שם פרטי")).toBeVisible({ timeout: 15_000 });
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
