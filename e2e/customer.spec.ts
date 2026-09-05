import { expect, test } from "@playwright/test";
import {
  aBusinessWithOpenHours,
  asTyped,
  showDay,
  theNextOfferedTime,
  theStartShownAs,
  theNextStart,
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
    // Opening a business puts it in the address bar, so the page can be shared.
    // Which business is not asserted: the name is shared with earlier runs, so
    // the card that matches is not necessarily the one just created.
    await expect(page).toHaveURL(/\/business\/[0-9a-f-]{36}$/);
  });

  test("a business opens straight from its own address", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `מספרה בקישור ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });

    await page.goto(`/business/${shop.business.id}`);
    await ready(page);

    await expect(page.getByRole("heading", { name: shop.business.name })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("בוחרים שירות")).toBeVisible();
  });

  test("offers one tap to call the business", async ({ page }) => {
    const name = `טלפון ${Date.now()}`;
    const ownerPhone = uniquePhone();
    await aBusinessWithOpenHours({ name, ownerPhone });

    await page.goto("/");
    await ready(page);
    await page.getByPlaceholder("מספרה, קליניקה, מאמן אישי…").fill(name.slice(0, 7));
    await page.getByText(name, { exact: false }).first().click();

    // One tap to ring them, above the times, where somebody with a question can
    // find it. The number itself is not printed — it was a line to read and
    // then dial, and the button does the dialling.
    await expect(
      page.getByRole("link", { name: new RegExp("התקשרו") }).first(),
    ).toHaveAttribute("href", `tel:${ownerPhone}`, { timeout: 15_000 });
  });

  test("hands out a link to the business anyone can open", async ({ page, context }) => {
    const name = `שיתוף ${Date.now()}`;
    const shop = await aBusinessWithOpenHours({ name, ownerPhone: uniquePhone() });

    // No share sheet in this browser, so the address goes to the clipboard.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await ready(page);
    await page.getByPlaceholder("מספרה, קליניקה, מאמן אישי…").fill(name.slice(0, 7));
    await page.getByText(name, { exact: false }).first().click();

    await page.getByRole("button", { name: "שיתוף העסק" }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain(`/business/${shop.business.id}`);

    // And the address is one somebody arriving cold can actually open.
    const stranger = await context.newPage();
    await stranger.goto(copied);
    await expect(stranger.getByRole("heading", { name })).toBeVisible({ timeout: 20_000 });
    await stranger.close();
  });

  test("shows nothing found for a name that is not there", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    await page.getByPlaceholder("מספרה, קליניקה, מאמן אישי…").fill("זזזזזזזזזז");
    await expect(page.getByText("לא מצאנו עסק כזה")).toBeVisible({ timeout: 15_000 });
  });

  test("books a slot, verifying the phone inline on the way", async ({ page }) => {
    const name = `קליניקה ${Date.now()}`;
    const shop = await aBusinessWithOpenHours({ name, ownerPhone: uniquePhone() });

    await page.goto("/");
    await ready(page);
    await page.getByPlaceholder("מספרה, קליניקה, מאמן אישי…").fill(name.slice(0, 8));
    await page.getByText(name, { exact: false }).first().click();

    // The next time on offer, which late in the evening is tomorrow's.
    const { time: firstSlot } = await theNextOfferedTime(page);
    const chosen = (await firstSlot.textContent())?.trim();
    await firstSlot.click();

    // The confirmation sheet, then verification, because there is no session.
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("מאשרים את התור")).toBeVisible();

    // Everything the booking commits to, before it is made: what, with whom,
    // when it starts and finishes, how long it takes and what it costs.
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText(shop.service.name).first()).toBeVisible();
    await expect(sheet.getByText(shop.resource.name).first()).toBeVisible();
    await expect(sheet.getByText(/\d\d:\d\d–\d\d:\d\d/)).toBeVisible();
    await expect(sheet.getByText(/30 דק׳/)).toBeVisible();
    await expect(sheet.getByText(/80/)).toBeVisible();
    await page.getByRole("button", { name: "אישור התור" }).click();

    await expect(page.getByText("מאמתים מספר טלפון")).toBeVisible();
    await page.getByLabel("מספר טלפון").fill(asTyped(uniquePhone()));
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

    const { day } = await theNextOfferedTime(page);
    const slots = page.locator("[role=radio]", { hasText: /^\d\d:\d\d$/ });
    const before = await slots.count();
    // Not the first one on the day: it is the closest to now, and the minimum
    // notice can overtake it between the screen rendering and the API being
    // asked about it — which failed this test as "no slot reads as 15:50" a
    // minute after the screen had offered exactly that.
    const offered = slots.nth(Math.min(SAFELY_PAST_THE_NOTICE, before - 1));
    const takenLabel = (await offered.textContent())?.trim();

    // Someone else takes it, out of band.
    const phone = uniquePhone();
    const codeResponse = await request.post(`${process.env["E2E_API_URL"] ?? "http://127.0.0.1:8787/api"}/auth/request-code`, {
      data: { phone },
    });
    const { code } = (await codeResponse.json()) as { code: string };
    const sessionResponse = await request.post(`${process.env["E2E_API_URL"] ?? "http://127.0.0.1:8787/api"}/auth/verify`, {
      data: { phone, code, name: { givenName: "אחר", familyName: "לגמרי" } },
    });
    expect(sessionResponse.ok()).toBe(true);
    const session = (await sessionResponse.json()) as { token: string };

    const startAt = await theStartShownAs(shop, takenLabel ?? "", day);

    // Asserted, because a booking that silently failed would leave the count
    // unchanged and read as "the slot is still offered" — the very thing this
    // test claims to prove.
    const booked = await request.post(`${process.env["E2E_API_URL"] ?? "http://127.0.0.1:8787/api"}/appointments`, {
      headers: { Authorization: `Bearer ${session.token}` },
      data: {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: shop.resource.id,
        startAt,
        customerNote: null,
      },
    });
    expect(booked.ok(), await booked.text()).toBe(true);

    // A business has an address of its own, so the reload comes back to it
    // rather than to the search screen it was found from.
    await page.reload();
    await ready(page);
    // Back to the same day the count was taken on, which need not be today.
    await showDay(page, day);
    await expect(slots.first()).toBeVisible({ timeout: 20_000 });

    expect(await slots.count()).toBe(before - 1);
    if (takenLabel !== undefined) {
      await expect(page.getByRole("radio", { name: takenLabel, exact: true })).toHaveCount(0);
    }
  });
});

test.describe("who the appointment is with", () => {
  test("names the provider on the customer's own list", async ({ page }) => {
    const name = `נותן שירות ${Date.now()}`;
    const shop = await aBusinessWithOpenHours({ name, ownerPhone: uniquePhone() });
    const phone = uniquePhone();
    const { token } = await signInDirectly(page, phone, "דנה כהן");

    await call("/appointments", {
      method: "POST",
      token,
      body: {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: shop.resource.id,
        startAt: await theNextStart(shop),
        customerNote: null,
      },
    });

    await page.goto("/");
    await ready(page);
    await page.getByRole("button", { name: "התורים שלי" }).click();

    // The calendar's name at booking time, which is what the customer turned up
    // expecting — not whatever it may be renamed to later.
    await expect(page.getByText(new RegExp(`בשירות ${shop.resource.name}`))).toBeVisible({
      timeout: 15_000,
    });
  });
});

/** Far enough along the day that the notice window cannot swallow it mid-test. */
const SAFELY_PAST_THE_NOTICE = 4;

test.describe("booking a second one of the same", () => {
  test("asks before allowing it, and the note reaches the owner", async ({ page }) => {
    const name = `כפול ${Date.now()}`;
    const shop = await aBusinessWithOpenHours({ name, ownerPhone: uniquePhone() });
    const phone = uniquePhone();
    await signInDirectly(page, phone, "דנה כהן");

    // Both bookings have to land on the same day for the rule to be in play, so
    // the first one's day is remembered and the second is taken back to it —
    // "the next day with a free time" can move between two visits.
    let bookedOn: number | null = null;
    const book = async (note: string) => {
      await page.goto("/");
      await ready(page);
      await page.getByPlaceholder("מספרה, קליניקה, מאמן אישי…").fill(name.slice(0, 7));
      await page.getByText(name, { exact: false }).first().click();
      if (bookedOn === null) {
        const { time, day } = await theNextOfferedTime(page);
        bookedOn = day;
        await time.click();
      } else {
        await showDay(page, bookedOn);
        const times = page.locator("[role=radio]", { hasText: /^\d\d:\d\d$/ });
        await expect(times.first()).toBeVisible({ timeout: 20_000 });
        await times.first().click();
      }
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByLabel("הערה לעסק").fill(note);
      await page.getByRole("button", { name: "אישור התור" }).click();
    };

    await book("מגיעה עם ילד");
    await expect(page.getByText("התור נקבע")).toBeVisible({ timeout: 20_000 });

    // The same service again that day: a question, not a refusal — and one that
    // names the appointment they already hold, with the calendar and the hour,
    // since nobody can tell whether they meant it without recognising it.
    await book("השני הוא לילד");
    await expect(page.getByText(/כבר יש לכם תור/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(new RegExp(`עם ${shop.resource.name}`))).toBeVisible();
    await expect(page.getByText(/בשעה \d\d:\d\d/)).toBeVisible();
    await expect(page.getByRole("button", { name: "כן, להזמין עוד תור" })).toBeVisible();

    await page.getByRole("button", { name: "כן, להזמין עוד תור" }).click();
    await expect(page.getByText("התור נקבע")).toBeVisible({ timeout: 20_000 });

    // Both stand, and each carries what the customer wrote.
    const { token } = await signInDirectly(page, phone, "דנה כהן");
    const mine = await call<{ customerNote: string | null }[]>("/me/appointments", {
      token,
    });
    expect(mine).toHaveLength(2);
    expect(mine.map((appointment) => appointment.customerNote).sort()).toEqual(
      ["השני הוא לילד", "מגיעה עם ילד"].sort(),
    );
  });
});

test.describe("booking over an appointment somewhere else", () => {
  test("asks before allowing it, and names where the other one is", async ({ page }) => {
    const clinicName = `קליניקה ${Date.now()}`;
    const barberName = `מספרה ${Date.now()}`;
    const clinic = await aBusinessWithOpenHours({
      name: clinicName,
      ownerPhone: uniquePhone(),
      serviceName: "עיסוי",
    });
    const barber = await aBusinessWithOpenHours({
      name: barberName,
      ownerPhone: uniquePhone(),
    });
    const phone = uniquePhone();
    const { token } = await signInDirectly(page, phone, "דנה כהן");

    await page.goto(`/business/${clinic.business.id}`);
    await ready(page);
    const { time, day } = await theNextOfferedTime(page);
    const label = ((await time.textContent()) ?? "").trim();

    // The clinic's own diary will still be empty at that hour: what makes it
    // unbookable is the customer's morning, spent at the barber. So the barber
    // is booked for exactly the time the clinic is about to offer.
    const startAt = await theStartShownAs(clinic, label, day);
    await call("/appointments", {
      method: "POST",
      token,
      body: {
        businessId: barber.business.id,
        serviceId: barber.service.id,
        resourceId: barber.resource.id,
        startAt,
        customerNote: null,
      },
    });

    await time.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "אישור התור" }).click();

    // Named, because "you are busy then" is no use without saying where: the
    // clash is at a business this screen knows nothing about.
    const warning = page.getByText(/חופפת לתור/);
    await expect(warning).toBeVisible({ timeout: 20_000 });
    await expect(warning).toContainText(barberName);
    // Asserted on the warning itself: the sheet behind it shows a span too, and
    // the point is that this sentence carries one.
    await expect(warning).toContainText(/\d\d:\d\d–\d\d:\d\d/);

    // Their call, not ours: the other one may be for somebody else.
    await page.getByRole("button", { name: "כן, להזמין בכל זאת" }).click();
    await expect(page.getByText("התור נקבע")).toBeVisible({ timeout: 20_000 });

    const mine = await call<{ id: string }[]>("/me/appointments", { token });
    expect(mine).toHaveLength(2);
  });
});

test.describe("a customer's own appointments", () => {
  test("cancels an appointment and is warned about the notice period", async ({ page }) => {
    const name = `מכון ${Date.now()}`;
    const shop = await aBusinessWithOpenHours({ name, ownerPhone: uniquePhone() });
    const phone = uniquePhone();
    const session = await signInDirectly(page, phone, "דנה");

    const startAt = await theNextStart(shop);

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
        startAt,
        customerNote: null,
      }),
    });

    await page.goto("/");
    await ready(page);
    await page.getByRole("button", { name: "התורים שלי" }).click();
    await expect(page.getByText("תספורת").first()).toBeVisible({ timeout: 15_000 });
    // How long it takes and when it ends, not only when it starts.
    await expect(page.getByText("30 דק׳").first()).toBeVisible();
    await expect(page.getByText(/\d{2}:\d{2}–\d{2}:\d{2}/).first()).toBeVisible();

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

  test("and when it carries no contact channels either", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `בלי ערוצים ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });

    // Absent is not null. The screen guarded on null, so an older function —
    // which sends neither key — crashed the page on a `.replace` of undefined
    // rather than simply showing nothing.
    await page.route(`**/businesses/${shop.business.id}?*`, async (route) => {
      const answer = await route.fetch();
      const body = (await answer.json()) as { business: Record<string, unknown> };
      delete body.business["instagram"];
      delete body.business["whatsapp"];
      await route.fulfill({ response: answer, json: body });
    });

    await page.goto("/");
    await ready(page);
    await page.getByPlaceholder("מספרה, קליניקה, מאמן אישי…").fill(shop.business.name.slice(0, 9));
    await page.getByText(shop.business.name).first().click();

    await expect(page.getByRole("heading", { name: shop.business.name })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(shop.service.name).first()).toBeVisible();
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
    await page.getByLabel("מספר טלפון").fill(asTyped(uniquePhone()));
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

    const slot = await theNextStart(shop);
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

    // The country is a flag on the field, so what is typed is the local number
    // and the mistake people actually make is a short one. It is refused before
    // the code is ever sent.
    const phone = page.getByLabel("מספר טלפון");
    await phone.fill("05012");
    await phone.blur();
    await expect(page.getByRole("button", { name: "שליחת קוד" })).toBeDisabled();

    await phone.fill(asTyped(uniquePhone()));
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
    await page.getByLabel("מספר טלפון").fill(asTyped(phone));
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
    await page.getByLabel("מספר טלפון").fill(asTyped(phone));
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
