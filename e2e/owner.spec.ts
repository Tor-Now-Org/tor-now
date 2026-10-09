import { expect, test, type Page } from "@playwright/test";
import {
  aBusinessWithOpenHours,
  asTyped,
  aDayFromNow,
  localClockOf,
  localDayOf,
  theNextStart,
  aFreeStretch,
  anInstantAt,
  call,
  aRunInOneMonth,
  aRunInOneWeek,
  useEnglish,
  openTheDayOf,
  showTheMonthOf,
  pickACategory,
  pickAnAddress,
  stubAddressSearch,
  ready,
  movedIntoThePast,
  signInDirectly,
  uniquePhone,
} from "./support.ts";
import { anAdministrator } from "./cost-support.ts";

/**
 * The owner artboards: onboarding, the day, the three schedule layers, the
 * business panel, and the customer record.
 */

/**
 * Days a journey works with — so many days from today — moved on together,
 * gaps kept, until all of them fall in one month, with `after` more days of it
 * to spare. The month grid shows one month: in the last days of one, "the day
 * after tomorrow and the two after it" is partly next month's.
 */
const inOneMonth = <const Offsets extends readonly number[]>(
  offsets: Offsets,
  after = 0,
): { readonly [K in keyof Offsets]: string } => {
  const low = Math.min(...offsets);
  const high = Math.max(...offsets);
  const start = aRunInOneMonth(high - low + 1, { earliest: low, after });
  return offsets.map((offset) => aDayFromNow(offset - low + start)) as unknown as { readonly [K in keyof Offsets]: string };
};
/**
 * Read every calendar at once.
 *
 * Which calendar the screen is on is one chip on the toolbar now, opening the
 * list — where it used to be a row of chips above the month, costing the
 * calendar a row of its own to hold them.
 */
const showEveryCalendar = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: /^יומן:/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /כל היומנים/ }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });
};

/**
 * Bring the search box out.
 *
 * It is a button until somebody wants it: a full-width field above the calendar
 * was costing the month a row of days to answer a question nobody had asked.
 */
const openTheSearch = async (page: Page): Promise<void> => {
  const box = page.getByLabel("חיפוש תור לפי שם או טלפון");
  if ((await box.count()) === 0) {
    await page.getByRole("button", { name: "חיפוש" }).click();
  }
};

/**
 * Bring the owner's screen to the day an appointment falls on.
 *
 * The month is the owner's calendar — there is no day strip to slide — so a day
 * is reached by its square, which is labelled with the date, once the grid is
 * on its month: tomorrow is next month's on the last day of every month.
 */
const showOwnerDay = async (page: Page, startAt: string): Promise<void> => {
  await openTheDayOf(page, localDayOf(startAt));
};

test.describe("opening a business", () => {
  test("the wizard takes five steps and puts the business in search", async ({ page }) => {
    const phone = uniquePhone();
    await stubAddressSearch(page);
    await signInDirectly(page, phone, "בעלים חדש");
    const name = `עסק חדש ${Date.now()}`;

    // The plan is chosen once, on the pricing page, and the wizard opens on it.
    await page.goto("/pricing");
    await ready(page);
    await page.getByRole("button", { name: "מתחילים בצוות" }).click();
    await expect(page).toHaveURL(/\/onboarding\?plan=TEAM/, { timeout: 15_000 });
    await expect(page.getByText(/מסלול: צוות · 30 יום ניסיון/)).toBeVisible();

    // 1 — details
    await expect(page.getByText("פרטי העסק")).toBeVisible();
    await page.getByLabel("שם העסק").fill(name);
    await page.getByLabel("טלפון").fill(asTyped(phone));
    // The address is a place on the map now, so it is picked rather than
    // typed: the wizard will not continue without the pin.
    await pickAnAddress(page, "הרצל 1");
    // ADR 0017: and a Category, without which the wizard will not continue.
    await pickACategory(page);
    await page.getByRole("button", { name: "המשך" }).click();

    // 2 — photos, which nothing requires
    await expect(page.getByText("תמונות", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "המשך" }).click();

    // 3 — calendars
    await expect(page.getByText("מי נותן את השירות")).toBeVisible();
    await page.getByLabel("שם היומן").fill("ראשי");
    await page.getByRole("button", { name: "המשך" }).click();

    // 4 — services
    await expect(page.getByText("מה אתם נותנים")).toBeVisible();
    await page.getByLabel("שם השירות").fill("ייעוץ");
    // A new business keeps no recovery time, and the choice says so in minutes.
    const recovery = page.getByRole("group", { name: "זמן התאוששות אחרי התור" });
    await expect(recovery.getByRole("button", { name: /כמו בעסק\s*בלי/ })).toHaveAttribute("aria-pressed", "true");
    await expect(recovery.getByText("בלי זמן התאוששות: כל תור תופס ביומן 30 דק׳.")).toBeVisible();
    await page.getByRole("button", { name: "המשך" }).click();

    // 5 — hours, then live
    await expect(page.getByText("מתי אתם פתוחים")).toBeVisible();
    await page.getByRole("checkbox", { name: /קראתי ואני מסכים/ }).check();
    await page.getByRole("button", { name: "סיום" }).click();

    await expect(page.getByText("באוויר")).toBeVisible({ timeout: 20_000 });

    // ADR 0011: discoverable the moment it registers, with no approval queue.
    const found = await call<{ name: string }[]>(
      `/businesses/search?q=${encodeURIComponent(name.slice(0, 8))}`,
    );
    expect(found.some((business) => business.name === name)).toBe(true);
  });
});

test.describe("the owner's day", () => {
  test("shows a booking with the customer on the card", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `יומן ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });

    // A customer books, out of band.
    const customerPhone = uniquePhone();
    const { code } = await call<{ code: string }>("/auth/request-code", {
      method: "POST",
      body: { phone: customerPhone },
    });
    const customer = await call<{ token: string }>("/auth/verify", {
      method: "POST",
      body: { phone: customerPhone, code, name: { givenName: "דנה", familyName: "כהן" } },
    });
    const startAt = await theNextStart(shop);
    await call("/appointments", {
      method: "POST",
      token: customer.token,
      body: {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: shop.resource.id,
        startAt,
        customerNote: null,
      },
    });

    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );

    await page.goto("/manage");
    await ready(page);
    await showOwnerDay(page, startAt);

    await expect(page.getByText("דנה כהן")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("תספורת").first()).toBeVisible();
  });

  test("a booking that has not started offers no no-show mark", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `נוכחות ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });
    const customerPhone = uniquePhone();
    const { code } = await call<{ code: string }>("/auth/request-code", {
      method: "POST",
      body: { phone: customerPhone },
    });
    const customer = await call<{ token: string }>("/auth/verify", {
      method: "POST",
      body: { phone: customerPhone, code, name: { givenName: "לא", familyName: "הגיע" } },
    });
    const startAt = await theNextStart(shop);
    await call("/appointments", {
      method: "POST",
      token: customer.token,
      body: {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: shop.resource.id,
        startAt,
        customerNote: null,
      },
    });

    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto("/manage");
    await ready(page);
    await showOwnerDay(page, startAt);

    await page.getByRole("button", { name: /לא הגיע/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("button", { name: "העברת התור לשעה אחרת" })).toBeVisible();
    // The appointment has not started, so there is nothing to say yet about
    // whether anybody turned up: the control is absent rather than offered and
    // refused, and nothing explains an absence that needs no explaining.
    await expect(page.getByRole("button", { name: "סימון שלא הגיע" })).toHaveCount(0);
  });

  test("marks a no show once the time has passed, and takes the mark off again", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({ name: `לא הגיע ${Date.now()}`, ownerPhone: uniquePhone() });
    const customerPhone = uniquePhone();
    const { code } = await call<{ code: string }>("/auth/request-code", { method: "POST", body: { phone: customerPhone } });
    const customer = await call<{ token: string }>("/auth/verify", {
      method: "POST",
      body: { phone: customerPhone, code, name: { givenName: "נעדר", familyName: "מהתור" } },
    });
    const booking = await call<{ id: string }>("/appointments", {
      method: "POST",
      token: customer.token,
      body: {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: shop.resource.id,
        startAt: await theNextStart(shop),
        customerNote: null,
      },
    });
    await movedIntoThePast(booking.id);
    const statusOf = async () =>
      (
        await call<{ id: string; status: string }[]>(
          `/businesses/${shop.business.id}/resources/${shop.resource.id}/calendar?date=${yesterday()}`,
          { token: shop.owner.token },
        ).then((day) => (day as unknown as { appointments: { id: string; status: string }[] }).appointments)
      ).find((appointment) => appointment.id === booking.id)?.status;

    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await openTheDayOf(page, yesterday());
    await page.getByText("נעדר מהתור").first().click();

    // Marked, and the sheet closes on the day as it now stands.
    await page.getByRole("dialog").getByRole("button", { name: "סימון שלא הגיע" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });
    await expect.poll(statusOf, { timeout: 15_000 }).toBe("NO_SHOW");

    // Opened again, it says so, and offers the way back.
    await page.getByText("נעדר מהתור").first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText(/התור מסומן כלא הגיע/)).toBeVisible({ timeout: 15_000 });
    await sheet.getByRole("button", { name: "ביטול הסימון — הלקוח כן הגיע" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });
    await expect.poll(statusOf, { timeout: 15_000 }).toBe("CONFIRMED");
  });
});

test.describe("the schedule layers", () => {
  test("the week shows the hours kept, and a special day replaces them outright", async ({ page }) => {
    // This one is about opening hours, so it states its own rather than taking
    // the fixture's all-day default.
    const shop = await aBusinessWithOpenHours({
      name: `שעות ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "08:00", end: "20:00" },
    });
    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );

    await page.goto("/manage");
    await ready(page);
    await page.getByRole("button", { name: "לוח זמנים" }).click();

    // Hours: the week as a person describes it, showing the times this
    // business actually keeps.
    await expect(page.getByText("רוב הימים")).toBeVisible();
    const usual = page.locator(".card", { hasText: "רוב הימים" }).first();
    await expect(usual.locator('input[type="time"]').first()).toHaveValue("08:00");
    await expect(usual.locator('input[type="time"]').nth(1)).toHaveValue("20:00");
    // Open the same hours every day, so every day is on the usual and nothing
    // is listed as an exception.
    await expect(usual.getByRole("button", { name: "שני" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByText("ימים אחרים")).toHaveCount(0);

    // Other hours for one day replace the weekday entirely: "שינויים", then
    // the same sheet every door opens, with the dates typed.
    await page.getByRole("tab", { name: "שינויים" }).click();
    await expect(page.getByText("אין שינויים קרובים")).toBeVisible();
    await page.getByRole("button", { name: "שינוי ביומן א" }).click();
    const sheet = page.getByRole("dialog");
    // Tomorrow, not today: late in the evening today is already empty because
    // the minimum notice has run past closing, and the shorter day under test
    // would be hidden behind TOO_SOON.
    const shortDay = aDayFromNow(1);
    await sheet.getByLabel("מתאריך").fill(shortDay);
    await sheet.getByLabel("עד תאריך").fill(shortDay);
    await sheet.getByRole("radio", { name: /^עובדים בשעות אחרות/ }).click();
    // It starts from the usual day, which is what is then shortened.
    await expect(sheet.getByLabel("מ־", { exact: true })).toHaveValue("08:00");
    await sheet.getByLabel("מ־", { exact: true }).fill("10:00");
    await sheet.getByLabel("עד", { exact: true }).fill("14:00");
    await sheet.getByRole("button", { name: "שמירת השינוי" }).click();
    // The sheet closing is what says the save went through: reading the
    // availability before the override had landed is what used to flake.
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText("עובדים 10:00–14:00").first()).toBeVisible({ timeout: 15_000 });

    // The day keeps the override's hours, not the week's 08:00–20:00: every
    // time it offers starts inside 10:00–14:00, and some do.
    const clock = (instant: string) =>
      new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" }).format(
        new Date(instant),
      );
    await expect
      .poll(
        async () => {
          const days = await call<{ slots: { startAt: string }[] }[]>(
            `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
              `&resourceId=${shop.resource.id}&from=${shortDay}&to=${shortDay}`,
          );
          const starts = (days[0]?.slots ?? []).map((slot) => clock(slot.startAt));
          return starts.length > 0 && starts.every((start) => start >= "10:00" && start < "14:00");
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  });
});

/**
 * The week editor, gone over properly.
 *
 * It is the screen an owner touches most and the one every booking depends on:
 * a day quietly closed here is a day of appointments nobody can make. These
 * journeys walk it the way a person would, and check the store afterwards
 * rather than the screen — what was saved is the only thing that matters.
 */
test.describe("the week a calendar keeps", () => {
  const anOwnerAt = async (name: string, hours?: { start: string; end: string }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({
      name: `${name} ${Date.now()}`,
      ownerPhone,
      ...(hours === undefined ? {} : { hours }),
    });
    return { shop, ownerPhone };
  };

  const openTheWeek = async (page: Page, shop: { business: { id: string }; owner: { token: string } }) => {
    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await page.getByRole("button", { name: "לוח זמנים" }).click();
    await expect(page.getByText("רוב הימים")).toBeVisible({ timeout: 15_000 });
    return page.locator(".card", { hasText: "רוב הימים" }).first();
  };

  /** What the store holds for this calendar, by day, as the screen would say it. */
  const storedWeek = async (shop: {
    business: { id: string };
    resource: { id: string };
    owner: { token: string };
  }) => {
    const week = await call<{ dayOfWeek: number; start: string; end: string }[]>(
      `/businesses/${shop.business.id}/resources/${shop.resource.id}/working-hours`,
      { token: shop.owner.token },
    );
    return (dayOfWeek: number) =>
      week
        .filter((entry) => entry.dayOfWeek === dayOfWeek)
        .map((entry) => `${entry.start}-${entry.end}`)
        .sort();
  };

  const save = async (page: Page) => {
    // Waited for at the request, not at the banner: the banner from the last
    // save is still on screen, so asserting it passes instantly and the store
    // is then read before the new week has landed.
    const written = page.waitForResponse(
      (response) =>
        response.url().includes("working-hours") && response.request().method() === "PUT",
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: "שמירה" }).last().click();
    expect((await written).status()).toBe(200);
    await expect(page.getByText("ההגדרות נשמרו")).toBeVisible({ timeout: 15_000 });
  };

  test("a day taken off the usual keeps its hours instead of closing", async ({ page }) => {
    const { shop } = await anOwnerAt("יום נפרד", { start: "09:00", end: "17:00" });
    const usual = await openTheWeek(page, shop);

    // "Thursday is different" is not "Thursday is off". Taking the day out
    // used to shut it, so an owner separating a day to move it by half an hour
    // lost the day instead.
    await usual.getByRole("button", { name: "חמישי" }).click();

    const thursday = page.locator(".card", { hasText: "חמישי" }).first();
    await expect(thursday.getByRole("button", { name: "שעות אחרות" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(thursday.locator('input[type="time"]').first()).toHaveValue("09:00");
    await expect(thursday.locator('input[type="time"]').nth(1)).toHaveValue("17:00");

    await save(page);
    expect((await storedWeek(shop))(4)).toEqual(["09:00-17:00"]);
  });

  test("and closing it is the owner's own tap, which can be taken back", async ({ page }) => {
    const { shop } = await anOwnerAt("יום סגור", { start: "09:00", end: "17:00" });
    const usual = await openTheWeek(page, shop);

    await usual.getByRole("button", { name: "שבת" }).click();
    const saturday = page.locator(".card", { hasText: "שבת" }).first();
    await saturday.getByRole("button", { name: "סגור", exact: true }).click();
    await save(page);
    expect((await storedWeek(shop))(6)).toEqual([]);

    // And back again, on the hours the rest of the week keeps.
    await saturday.getByRole("button", { name: "חזרה לרגיל" }).click();
    await save(page);
    expect((await storedWeek(shop))(6)).toEqual(["09:00-17:00"]);
  });

  test("a day given its own hours can be put back on the usual, saved twice", async ({
    page,
  }) => {
    const { shop } = await anOwnerAt("הלוך ושוב", { start: "09:00", end: "17:00" });
    const usual = await openTheWeek(page, shop);

    // Out, with hours of its own, saved.
    await usual.getByRole("button", { name: "רביעי" }).click();
    const wednesday = page.locator(".card", { hasText: "רביעי" }).first();
    await wednesday.locator('input[type="time"]').first().fill("10:00");
    await wednesday.locator('input[type="time"]').nth(1).fill("14:00");
    await save(page);
    expect((await storedWeek(shop))(3)).toEqual(["10:00-14:00"]);

    // Back on the usual by its chip, saved again. This is where it came back
    // as a day off.
    await usual.getByRole("button", { name: "רביעי" }).click();
    await expect(page.locator(".card", { hasText: "רביעי" })).toHaveCount(0);
    await save(page);
    expect((await storedWeek(shop))(3)).toEqual(["09:00-17:00"]);
  });

  test("and put back after leaving the screen and coming back to it", async ({ page }) => {
    const { shop } = await anOwnerAt("הלוך ושוב אחרי טעינה", { start: "09:00", end: "17:00" });
    const usual = await openTheWeek(page, shop);

    await usual.getByRole("button", { name: "רביעי" }).click();
    const wednesday = page.locator(".card", { hasText: "רביעי" }).first();
    await wednesday.locator('input[type="time"]').first().fill("10:00");
    await wednesday.locator('input[type="time"]').nth(1).fill("14:00");
    await save(page);

    // Coming back to it fresh, which is what an owner actually does: the day is
    // an exception now because its hours differ, not because anything on this
    // page remembers that it was pulled out.
    await page.reload();
    await ready(page);
    await page.getByRole("button", { name: "לוח זמנים" }).click();
    await expect(page.getByText("רוב הימים")).toBeVisible({ timeout: 15_000 });
    const reopened = page.locator(".card", { hasText: "רוב הימים" }).first();

    await reopened.getByRole("button", { name: "רביעי" }).click();
    await save(page);
    expect((await storedWeek(shop))(3)).toEqual(["09:00-17:00"]);
  });

  test("and a closed day comes back on the usual from its chip", async ({ page }) => {
    const { shop } = await anOwnerAt("פתיחה מחדש", { start: "09:00", end: "17:00" });
    const usual = await openTheWeek(page, shop);

    await usual.getByRole("button", { name: "שלישי" }).click();
    const tuesday = page.locator(".card", { hasText: "שלישי" }).first();
    await tuesday.getByRole("button", { name: "סגור", exact: true }).click();
    await save(page);
    expect((await storedWeek(shop))(2)).toEqual([]);

    await page.reload();
    await ready(page);
    await page.getByRole("button", { name: "לוח זמנים" }).click();
    await expect(page.getByText("רוב הימים")).toBeVisible({ timeout: 15_000 });
    const reopened = page.locator(".card", { hasText: "רוב הימים" }).first();

    await reopened.getByRole("button", { name: "שלישי" }).click();
    await save(page);
    expect((await storedWeek(shop))(2)).toEqual(["09:00-17:00"]);
  });

  test("editing the usual moves the days on it and leaves the others alone", async ({
    page,
  }) => {
    const { shop } = await anOwnerAt("שינוי כללי", { start: "09:00", end: "17:00" });
    const usual = await openTheWeek(page, shop);

    // Friday goes its own way first: 09:00–13:00.
    await usual.getByRole("button", { name: "שישי" }).click();
    const friday = page.locator(".card", { hasText: "שישי" }).first();
    await friday.locator('input[type="time"]').nth(1).fill("13:00");

    // Then the usual moves to 10:00–16:00. Friday must not follow it, and must
    // not be swallowed back into the group on the way.
    await usual.locator('input[type="time"]').first().fill("10:00");
    await usual.locator('input[type="time"]').nth(1).fill("16:00");
    await expect(page.getByText("ימים אחרים")).toBeVisible();

    await save(page);
    const said = await storedWeek(shop);
    expect(said(0)).toEqual(["10:00-16:00"]);
    expect(said(4)).toEqual(["10:00-16:00"]);
    expect(said(5)).toEqual(["09:00-13:00"]);
  });

  test("a half-typed time holds the save rather than shortening the day", async ({ page }) => {
    const { shop } = await anOwnerAt("שעה חסרה", { start: "09:00", end: "17:00" });
    const usual = await openTheWeek(page, shop);

    await usual.locator('input[type="time"]').nth(1).fill("");

    // Merging drops what it cannot read, so saving this would have stored a
    // day with no hours and said nothing about it.
    await expect(page.getByText(/שעה שלא הושלמה/)).toBeVisible();
    await expect(page.getByRole("button", { name: "שמירה" }).last()).toBeDisabled();

    await usual.locator('input[type="time"]').nth(1).fill("18:00");
    await expect(page.getByRole("button", { name: "שמירה" }).last()).toBeEnabled();
    await save(page);
    expect((await storedWeek(shop))(0)).toEqual(["09:00-18:00"]);
  });

  test("a slow answer for the calendar being left cannot overwrite the one on screen", async ({
    page,
  }) => {
    const { shop } = await anOwnerAt("יומן איטי", { start: "09:00", end: "17:00" });
    await call<{ id: string; name: string }>(
      `/businesses/${shop.business.id}/resources`,
      { method: "POST", token: shop.owner.token, body: { name: "יומן ב" } },
    );

    await openTheWeek(page, shop);

    // The second calendar's hours, held back long enough to be overtaken. This
    // is the slow API a full suite — or a bad afternoon — produces on its own.
    await page.route(/\/working-hours/, async (route) => {
      await new Promise((wake) => setTimeout(wake, 2500));
      await route.continue();
    });

    await page.getByRole("button", { name: "יומן ב" }).click();

    // While that answer is outstanding the week is nobody's: the hours of the
    // calendar just left must not be sitting there to be read or typed into.
    await expect(page.locator('input[type="time"]')).toHaveCount(0);
    await expect(page.locator(".spinner")).toBeVisible();

    // And when it lands, it is this calendar's own week.
    await expect(page.getByText("רוב הימים")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('input[type="time"]').first()).toBeVisible();
  });

  test("each calendar keeps its own week, and switching does not carry one over", async ({
    page,
  }) => {
    const { shop } = await anOwnerAt("שני יומנים", { start: "09:00", end: "17:00" });
    const second = await call<{ id: string; name: string }>(
      `/businesses/${shop.business.id}/resources`,
      { method: "POST", token: shop.owner.token, body: { name: "יומן ב" } },
    );

    const usual = await openTheWeek(page, shop);
    await usual.getByRole("button", { name: "רביעי" }).click();
    await save(page);

    // The second calendar opens on its own week — the day pulled out of the
    // first one is not pulled out of this one.
    await page.getByRole("button", { name: "יומן ב" }).click();
    await expect(page.getByText("רוב הימים")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("ימים אחרים")).toHaveCount(0);

    const usualB = page.locator(".card", { hasText: "רוב הימים" }).first();
    await usualB.locator('input[type="time"]').first().fill("11:00");
    await save(page);

    const secondWeek = await call<{ dayOfWeek: number; start: string }[]>(
      `/businesses/${shop.business.id}/resources/${second.id}/working-hours`,
      { token: shop.owner.token },
    );
    expect(secondWeek.every((entry) => entry.start === "11:00")).toBe(true);
    // And the first calendar is exactly as it was left.
    expect((await storedWeek(shop))(3)).toEqual(["09:00-17:00"]);
  });

  test("saves the whole week in one request", async ({ page }) => {
    const { shop } = await anOwnerAt("שמירה מהירה", { start: "09:00", end: "17:00" });
    const usual = await openTheWeek(page, shop);
    await usual.locator('input[type="time"]').first().fill("08:00");

    // It used to be a delete for every range and a create for every range,
    // one after another. Counting the requests is the only way a test can
    // hold on to that.
    const writes: string[] = [];
    page.on("request", (request) => {
      if (!request.url().includes("working-hours")) return;
      // The preflight is the browser asking permission, not the app writing.
      if (request.method() === "GET" || request.method() === "OPTIONS") return;
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    });

    await save(page);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("PUT");
    expect((await storedWeek(shop))(0)).toEqual(["08:00-17:00"]);
  });

  test("says the pattern has stopped helping once five days go their own way", async ({
    page,
  }) => {
    const { shop } = await anOwnerAt("כל יום שונה", { start: "09:00", end: "17:00" });
    const usual = await openTheWeek(page, shop);

    for (const day of ["ראשון", "שני", "שלישי", "רביעי", "חמישי"]) {
      await usual.getByRole("button", { name: day }).click();
    }

    await expect(page.getByText(/כבר לא מתאר את השבוע/)).toBeVisible();
    await page.getByRole("button", { name: "מעבר לעריכה יום־יום" }).click();

    // The day-by-day list is the whole week — seven days, each with its own
    // switch — and it saves the same way.
    await expect(page.locator(".card", { hasText: "רוב הימים" })).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(7);
    await save(page);
    expect((await storedWeek(shop))(0)).toEqual(["09:00-17:00"]);
  });

  test("the week that was saved is the week that comes back", async ({ page }) => {
    const { shop } = await anOwnerAt("טעינה מחדש", { start: "09:00", end: "17:00" });
    const usual = await openTheWeek(page, shop);

    await usual.getByRole("button", { name: "הוספת טווח שעות" }).click();
    await usual.locator('input[type="time"]').nth(2).fill("19:00");
    await usual.locator('input[type="time"]').nth(3).fill("22:00");
    await save(page);

    await page.reload();
    await ready(page);
    await page.getByRole("button", { name: "לוח זמנים" }).click();
    const reopened = page.locator(".card", { hasText: "רוב הימים" }).first();
    await expect(reopened.locator('input[type="time"]').first()).toHaveValue("09:00", {
      timeout: 15_000,
    });
    await expect(reopened.locator('input[type="time"]').nth(1)).toHaveValue("17:00");
    await expect(reopened.locator('input[type="time"]').nth(2)).toHaveValue("19:00");
    await expect(reopened.locator('input[type="time"]').nth(3)).toHaveValue("22:00");
    await expect(reopened.getByText(/הפסקה · 17:00–19:00/)).toBeVisible();
  });
});

/**
 * The month grid: the whole business at once, and the place a holiday is taken.
 * These drive the real screen and then ask the store what it holds.
 */
test.describe("the month", () => {
  const openTheMonth = async (
    page: Page,
    shop: { business: { id: string }; owner: { token: string } },
  ) => {
    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });
  };

  /** A date in the month or week now shown, as the grid labels it. */
  const dayCell = (page: Page, date: string) => page.getByRole("button", { name: date });

  /** A date tapped once the grid is on its month. */
  const pickDay = async (page: Page, date: string) => {
    await showTheMonthOf(page, date);
    await dayCell(page, date).click();
  };

  test("takes a range in two taps and blocks every day of it", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({
      name: `חודש ${Date.now()}`,
      ownerPhone,
      hours: { start: "09:00", end: "17:00" },
    });
    await openTheMonth(page, shop);

    const [first, middle, last, after] = inOneMonth([1, 2, 3, 4]);

    // What, then when, then the details: the + names the action, the grid asks
    // which days, and only the last step asks anything that needs both.
    await page.getByRole("button", { name: "הוספה ליום" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /שינוי ביומן/ }).click();
    await expect(page.getByText("בחירת ימים לשינוי")).toBeVisible();

    await pickDay(page, first);
    await pickDay(page, last);
    await expect(page.getByText(/3 ימים/).first()).toBeVisible();
    await page.getByRole("button", { name: "המשך" }).click();

    const sheet = page.getByRole("dialog");
    await sheet.getByRole("radio", { name: /^לא עובדים כל היום/ }).click();
    // The sentence says the run of days before anything is saved.
    await expect(sheet.locator(".change-sentence")).toContainText("בין");
    await sheet.getByRole("button", { name: "שמירת השינוי" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // Three days of the customer's month are gone, from one gesture.
    for (const date of [first, middle, last]) {
      const days = await call<{ slots: unknown[] }[]>(
        `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
          `&resourceId=${shop.resource.id}&from=${date}&to=${date}`,
      );
      expect(days[0]?.slots ?? []).toHaveLength(0);
    }
    // And the day after is untouched, so the range ended where it was told.
    const untouched = await call<{ slots: unknown[] }[]>(
      `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
        `&resourceId=${shop.resource.id}&from=${after}&to=${after}`,
    );
    expect((untouched[0]?.slots ?? []).length).toBeGreaterThan(0);
  });

  test("shows that blockage as one band, and takes it back as one", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({
      name: `רצועה ${Date.now()}`,
      ownerPhone,
      hours: { start: "09:00", end: "17:00" },
    });
    await openTheMonth(page, shop);

    const [first, second] = inOneMonth([1, 2]);
    await page.getByRole("button", { name: "הוספה ליום" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /שינוי ביומן/ }).click();
    await pickDay(page, first);
    await pickDay(page, second);
    await page.getByRole("button", { name: "המשך" }).click();
    await page.getByRole("dialog").getByRole("radio", { name: /^לא עובדים כל היום/ }).click();
    await page.getByRole("dialog").getByLabel("הערה (לא חובה)").fill("ספק");
    await page.getByRole("dialog").getByRole("button", { name: "שמירת השינוי" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // One band for the whole thing, not a mark per day, named by what happens.
    const band = page.getByRole("button", { name: "סגור", exact: true }).first();
    await expect(band).toBeVisible({ timeout: 15_000 });
    await band.click();

    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "ספק" })).toBeVisible();
    await sheet.getByRole("button", { name: "מחיקה · 2 הימים חוזרים לשעות הרגילות" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // Both days come back, because the group went as one.
    await expect
      .poll(
        async () => {
          const days = await call<{ slots: unknown[] }[]>(
            `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
              `&resourceId=${shop.resource.id}&from=${first}&to=${first}`,
          );
          return (days[0]?.slots ?? []).length;
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
  });

  test("a plain tap only shows the day, and offers nothing to change", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({ name: `יום ${Date.now()}`, ownerPhone });
    await openTheMonth(page, shop);

    await pickDay(page, aDayFromNow(1));

    // The timeline below is the day that was tapped, on the same screen — and
    // the calendar offers nothing else, because nothing was asked for.
    await expect(aFreeStretch(page).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "המשך" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "ביטול הבחירה" })).toHaveCount(0);
  });

  test("folds to a week that aims days the way the month does, and opens again", async ({
    page,
  }) => {
    const shop = await aBusinessWithOpenHours({
      name: `שבוע ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    await openTheMonth(page, shop);
    const offered = async (date: string) => {
      const days = await call<{ slots: unknown[] }[]>(
        `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
          `&resourceId=${shop.resource.id}&from=${date}&to=${date}`,
      );
      return (days[0]?.slots ?? []).length;
    };
    /** Steps forward a week at a time until that day is on the row. */
    const weekWith = async (date: string) => {
      for (let step = 0; step < 3 && (await dayCell(page, date).count()) === 0; step += 1) {
        await page.getByRole("button", { name: "השבוע הבא" }).click();
      }
      await expect(dayCell(page, date)).toBeVisible();
    };

    await page.getByRole("button", { name: "הצגת שבוע" }).click();
    await expect(page.getByRole("button", { name: "הצגת חודש" })).toBeVisible();
    // One row: seven days, not a month of them.
    await expect(page.getByRole("grid").getByRole("button", { name: /^\d{4}-\d{2}-\d{2}$/ }))
      .toHaveCount(7);

    // A range whose ends are in different weeks, the second tap one week on.
    const first = aDayFromNow(1);
    const last = aDayFromNow(8);
    await page.getByRole("button", { name: "הוספה ליום" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /שינוי ביומן/ }).click();
    await weekWith(first);
    await dayCell(page, first).click();
    await weekWith(last);
    await dayCell(page, last).click();
    await expect(page.getByText(/8 ימים/).first()).toBeVisible();
    await page.getByRole("button", { name: "המשך" }).click();
    await page.getByRole("dialog").getByRole("radio", { name: /^לא עובדים כל היום/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "שמירת השינוי" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "סגור", exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
    for (const date of [first, aDayFromNow(4), last]) {
      await expect.poll(async () => offered(date), { timeout: 15_000 }).toBe(0);
    }

    // Other hours, aimed from the week too.
    const special = aDayFromNow(9);
    await page.getByRole("button", { name: "הוספה ליום" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /שינוי ביומן/ }).click();
    await weekWith(special);
    await dayCell(page, special).click();
    await page.getByRole("button", { name: "המשך" }).click();
    await page.getByRole("dialog").getByRole("radio", { name: /^עובדים בשעות אחרות/ }).click();
    await page.getByRole("dialog").getByLabel("מ־", { exact: true }).fill("16:00");
    await page.getByRole("dialog").getByLabel("עד", { exact: true }).fill("16:30");
    await page.getByRole("dialog").getByRole("button", { name: "שמירת השינוי" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });
    await expect.poll(async () => offered(special), { timeout: 15_000 }).toBe(1);

    // And back to the month.
    await page.getByRole("button", { name: "הצגת חודש" }).click();
    await expect(page.getByRole("button", { name: "הצגת שבוע" })).toBeVisible();
    expect(
      await page.getByRole("grid").getByRole("button", { name: /^\d{4}-\d{2}-\d{2}$/ }).count(),
    ).toBeGreaterThanOrEqual(28);
  });
});

/**
 * The day as a timeline. These drive the screen a finger actually meets — the
 * free stretches, the fold, the sheet — and then ask the store what changed.
 */
test.describe("the day timeline", () => {
  const openTheDay = async (
    page: Page,
    shop: { business: { id: string }; owner: { token: string } },
    date: string,
  ) => {
    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await openTheDayOf(page, date);
    await expect(aFreeStretch(page).first()).toBeVisible({
      timeout: 15_000,
    });
  };

  test("free time is a control, and blocking it takes it out of the day", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `ציר ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    const date = aDayFromNow(1);
    await openTheDay(page, shop, date);

    // A whole empty day is folded, so the first tap opens the fold; the second
    // is the stretch itself. The emptiest part of the screen is the part an
    // owner wants to fill, and both taps lead there.
    await aFreeStretch(page).first().click();
    await aFreeStretch(page).first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(shop.resource.name)).toBeVisible();
    // The sheet offers the two things a gap is for; a change is the second.
    await sheet.getByRole("button", { name: /שינוי ביומן/ }).click();
    // The whole stretch is what the sheet arrives with, so part of the day takes it.
    await sheet.getByRole("radio", { name: /^לא עובדים בחלק מהיום/ }).click();
    await expect(sheet.getByLabel("מ־", { exact: true })).toHaveValue("09:00");
    await expect(sheet.getByLabel("עד", { exact: true })).toHaveValue("17:00");
    await sheet.getByRole("button", { name: "שמירת השינוי" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // The day is gone for a customer, because the whole of it was free.
    await expect
      .poll(
        async () => {
          const days = await call<{ slots: unknown[] }[]>(
            `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
              `&resourceId=${shop.resource.id}&from=${date}&to=${date}`,
          );
          return (days[0]?.slots ?? []).length;
        },
        { timeout: 15_000 },
      )
      .toBe(0);
  });

  test("a long free stretch can be narrowed to the part that is being taken", async ({
    page,
  }) => {
    const shop = await aBusinessWithOpenHours({
      name: `חלק ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    const date = aDayFromNow(1);
    const offered = async () => {
      const days = await call<{ slots: { startAt: string }[] }[]>(
        `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
          `&resourceId=${shop.resource.id}&from=${date}&to=${date}`,
      );
      return (days[0]?.slots ?? []).length;
    };
    const before = await offered();
    await openTheDay(page, shop, date);

    await aFreeStretch(page).first().click();
    await aFreeStretch(page).first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    // The hours are not asked for until a change is what this is about — a gap
    // is tapped to fill it far more often than to shut it.
    await sheet.getByRole("button", { name: /שינוי ביומן/ }).click();
    await sheet.getByRole("radio", { name: /^לא עובדים בחלק מהיום/ }).click();

    // An empty day is eight hours long and almost nobody means all of it. The
    // ordinary lengths are one tap, and the sentence then says what it will do.
    await sheet.getByRole("button", { name: "שעה", exact: true }).click();
    await expect(sheet.locator(".change-sentence")).toContainText("09:00–10:00");
    await sheet.getByRole("button", { name: "שמירת השינוי" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // The hour is gone and the rest of the day is not: blocking a stretch no
    // longer costs the owner the whole afternoon.
    await expect.poll(offered, { timeout: 15_000 }).toBeLessThan(before);
    expect(await offered()).toBeGreaterThan(0);
  });

  test("a blockage on the timeline opens, and can be taken off again", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `הסרה ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    const date = aDayFromNow(1);

    // One hour blocked, set up out of band so the timeline has something on it.
    await call(`/businesses/${shop.business.id}/resources/${shop.resource.id}/blocks`, {
      method: "POST",
      token: shop.owner.token,
      body: {
        blocks: [
          {
            startAt: `${date}T10:00:00.000Z`,
            endAt: `${date}T11:00:00.000Z`,
            reason: "ספק",
          },
        ],
      },
    });

    await openTheDay(page, shop, date);

    // The item on the track, named by its hour — the month above it now draws
    // a band for a single day too, and that band says "ספק" as well.
    await page.getByRole("button", { name: /\d\d:\d\d ספק/ }).first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "מחיקה" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // And the hour comes back.
    await expect
      .poll(
        async () => {
          const blocks = await call<{ id: string }[]>(
            `/businesses/${shop.business.id}/resources/${shop.resource.id}/calendar?date=${date}`,
            { token: shop.owner.token },
          ).then((day) => (day as unknown as { blocks: { id: string }[] }).blocks);
          return blocks.length;
        },
        { timeout: 15_000 },
      )
      .toBe(0);
  });

  test("a quiet day folds, and the fold opens", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `קיפול ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "20:00" },
    });
    const date = aDayFromNow(1);
    await openTheDay(page, shop, date);

    // Eleven empty hours are one band rather than a scroll: the hours inside
    // it are not on the rail.
    const fold = aFreeStretch(page).filter({ hasText: "09:00–20:00" });
    await expect(fold).toBeVisible();
    await expect(page.getByText("14:00", { exact: true })).toHaveCount(0);
    await fold.click();

    // Opened, the band is gone and the hours it held are drawn.
    await expect(fold).toHaveCount(0);
    await expect(page.getByText("14:00", { exact: true }).first()).toBeVisible();
    await expect(aFreeStretch(page).first()).toBeVisible();
  });
});

/**
 * Finding one thing in a day. Two mechanisms, one visible state: a search names
 * a person, the sheet chooses kinds, and everything active narrows together.
 */
test.describe("finding things in a day", () => {
  /** Signs in as somebody already known, for a second booking. */
  const tokenFor = async (phone: string) => {
    const { code } = await call<{ code: string }>("/auth/request-code", {
      method: "POST",
      body: { phone },
    });
    const { token } = await call<{ token: string }>("/auth/verify", {
      method: "POST",
      body: { phone, code },
    });
    return token;
  };

  /** Books an appointment for a named customer, and returns their phone. */
  const bookFor = async (
    shop: { business: { id: string }; service: { id: string }; resource: { id: string } },
    name: { givenName: string; familyName: string },
    startAt: string,
  ) => {
    const phone = uniquePhone();
    const { code } = await call<{ code: string }>("/auth/request-code", {
      method: "POST",
      body: { phone },
    });
    const { token } = await call<{ token: string }>("/auth/verify", {
      method: "POST",
      body: { phone, code, name },
    });
    await call("/appointments", {
      method: "POST",
      token,
      body: {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: shop.resource.id,
        startAt,
        customerNote: null,
      },
    });
    return phone;
  };

  test("names the person meant, rather than filtering on a string", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `חיפוש ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });

    // Two customers called יעל on one day, which is the whole reason a person
    // is chosen rather than a string matched.
    const on = aDayFromNow(1);
    const offered = await call<{ slots: { startAt: string }[] }[]>(
      `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
        `&resourceId=${shop.resource.id}&from=${on}&to=${on}`,
    );
    const slots = offered[0]?.slots ?? [];
    const first = slots[0]?.startAt ?? "";
    const second = slots[4]?.startAt ?? "";
    expect(first).not.toBe("");
    expect(second).not.toBe("");

    await bookFor(shop, { givenName: "יעל", familyName: "כהן" }, first);
    await bookFor(shop, { givenName: "יעל", familyName: "אלון" }, second);

    await signInDirectly(page, uniquePhone(), "צופה");
    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await showOwnerDay(page, first);

    await openTheSearch(page);
    await page.getByLabel("חיפוש תור לפי שם או טלפון").fill("יעל");

    // Two suggestions, not one mixed list: each row is a person, with her own
    // number, which is what makes the filter unambiguous.
    const suggestion = (name: string) =>
      page.getByRole("button", { name: new RegExp(`לקוח\\s+${name}`) });
    await expect(suggestion("יעל כהן")).toBeVisible({ timeout: 15_000 });
    await expect(suggestion("יעל אלון")).toBeVisible();

    // Choosing one leaves her things and nothing else, with a chip saying why.
    await suggestion("יעל כהן").click();
    await expect(page.getByText("יעל אלון")).toHaveCount(0);
    await expect(page.getByText("יעל כהן").first()).toBeVisible();

    // And the whole day is one tap back.
    await page.getByRole("button", { name: "ניקוי" }).first().click();
    await expect(aFreeStretch(page).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("keeps her results when the search box is cleared or edited", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `ניקוי ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });
    const startAt = await theNextStart(shop);
    await bookFor(shop, { givenName: "אורית", familyName: "שגב" }, startAt);

    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await showOwnerDay(page, startAt);

    await openTheSearch(page);
    await page.getByLabel("חיפוש תור לפי שם או טלפון").fill("אורית");
    await page.getByRole("button", { name: /לקוח\s+אורית שגב/ }).click({ timeout: 15_000 });
    await expect(page.getByText("אורית שגב").first()).toBeVisible();

    // Her things are hers, not the search box's: clearing the query used to
    // empty the list the chip was pointing at.
    await page.getByLabel("חיפוש תור לפי שם או טלפון").fill("");
    await expect(page.getByText("אורית שגב").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /תספורת/ }).first()).toBeVisible();
  });

  test("narrows and widens by reach, and clears back to the day", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `טווח ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });
    // One soon, one far enough out that only "everything" reaches it.
    const soon = await theNextStart(shop);
    const far = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000);
    far.setUTCHours(9, 0, 0, 0);
    const farDay = far.toISOString().slice(0, 10);
    const [available] = await call<{ slots: { startAt: string }[] }[]>(
      `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
        `&resourceId=${shop.resource.id}&from=${farDay}&to=${farDay}`,
    );
    const later = available?.slots[0]?.startAt ?? "";
    expect(later).not.toBe("");

    const phone = await bookFor(shop, { givenName: "נועה", familyName: "שדה" }, soon);
    await call("/appointments", {
      method: "POST",
      token: await tokenFor(phone),
      body: {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: shop.resource.id,
        startAt: later,
        customerNote: null,
      },
    });

    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await showOwnerDay(page, soon);

    await openTheSearch(page);
    await page.getByLabel("חיפוש תור לפי שם או טלפון").fill("נועה");
    await page.getByRole("button", { name: /לקוח\s+נועה שדה/ }).click({ timeout: 15_000 });

    // A named person opens at everything: "when is she next in" is rarely
    // about today.
    await expect(page.getByText("2 תורים")).toBeVisible();
    await page.getByRole("button", { name: "היום" }).click();
    // With a customer named, "today" means today, not the day on screen — and
    // the next free start is tomorrow once today's hours are over, so what
    // "today" holds depends on when the suite runs.
    if (localDayOf(soon) === aDayFromNow(0)) {
      await expect(page.getByText("1 תורים")).toBeVisible();
    } else {
      await expect(page.getByText("אין לו תור היום")).toBeVisible();
    }
    await page.getByRole("button", { name: "הכול" }).click();
    await expect(page.getByText("2 תורים")).toBeVisible();

    await page.getByRole("button", { name: "ניקוי" }).first().click();
    await expect(aFreeStretch(page).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  // FILTER_BUTTON is off in day-filter-bar.tsx; back on, unskip.
  test.skip("the sheet chooses kinds, and the button says how many are set", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `סינון ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });
    const startAt = await theNextStart(shop);
    await bookFor(shop, { givenName: "נועה", familyName: "שדה" }, startAt);

    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await showOwnerDay(page, startAt);

    await page.getByRole("button", { name: "סינון" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "עתידי" }).click();
    await sheet.getByRole("button", { name: "הצגת התוצאות" }).click();

    // The count rides on the button, because a filter you forgot you set is
    // the reason people think the screen is broken.
    await expect(page.getByRole("button", { name: /סינון\s*1/ })).toBeVisible();
    await expect(page.getByText("נועה שדה")).toBeVisible();

    // Cleared, the day comes back.
    await page.getByRole("button", { name: "ניקוי" }).first().click();
    await expect(aFreeStretch(page).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});

/**
 * The + button, which is how anything is added to a day without first finding a
 * gap to tap. Each choice carries the day it is about, so "when" is never asked
 * twice.
 */
test.describe("adding to a day", () => {
  const openAt = async (
    page: Page,
    shop: { business: { id: string }; owner: { token: string } },
    date: string,
  ) => {
    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await openTheDayOf(page, date);
  };

  const offeredOn = async (
    shop: { business: { id: string }; service: { id: string }; resource: { id: string } },
    date: string,
  ) => {
    const days = await call<{ slots: { startAt: string }[] }[]>(
      `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
        `&resourceId=${shop.resource.id}&from=${date}&to=${date}`,
    );
    return (days[0]?.slots ?? []).length;
  };

  /** The start times offered that day, as the shop's clock reads them. */
  const hoursOn = async (
    shop: { business: { id: string }; service: { id: string }; resource: { id: string } },
    date: string,
  ) => {
    const days = await call<{ slots: { startAt: string }[] }[]>(
      `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
        `&resourceId=${shop.resource.id}&from=${date}&to=${date}`,
    );
    return (days[0]?.slots ?? []).map((slot) => localClockOf(slot.startAt));
  };

  test("the + gets out of the way while its own sheet is up", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `כפתור ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });
    await openAt(page, shop, aDayFromNow(1));

    const plus = page.getByRole("button", { name: "הוספה ליום" });
    await expect(plus).toBeVisible();
    await plus.click();

    // A round button sitting on top of the sheet it opened is a trap: it
    // covers the choices and does nothing useful if pressed.
    await expect(plus).toHaveCount(0);
    await expect(page.getByRole("dialog")).toBeVisible();

    // It stays away while days are being picked, too — the screen is asking a
    // question, and the button that asked it would only get in the way.
    await page.getByRole("dialog").getByRole("button", { name: /שינוי ביומן/ }).click();
    await expect(page.getByText("בחירת ימים לשינוי")).toBeVisible();
    await expect(plus).toHaveCount(0);

    // And it comes back the moment the question is dropped.
    await page.getByRole("button", { name: "ביטול הבחירה" }).click();
    await expect(plus).toBeVisible({ timeout: 15_000 });
  });

  test("will not aim an action at a day that has already gone", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `עבר ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });
    await openAt(page, shop, aDayFromNow(1));

    await page.getByRole("button", { name: "הוספה ליום" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /שינוי ביומן/ }).click();
    await expect(page.getByText(/אי אפשר לשנות ימים שכבר עברו/)).toBeVisible();

    // Yesterday's square refuses the tap — looked for on its own month, which
    // on the first of one is the month before — and tomorrow's takes it.
    await showTheMonthOf(page, aDayFromNow(-1));
    await expect(page.getByRole("button", { name: aDayFromNow(-1) })).toBeDisabled();
    // Tomorrow may be next month's: the grid turns to it first.
    await showTheMonthOf(page, aDayFromNow(1));
    await page.getByRole("button", { name: aDayFromNow(1) }).click();
    await expect(page.getByRole("button", { name: "המשך" })).toBeEnabled();
  });

  test("adds a blockage of chosen hours", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `הוספה ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    const date = aDayFromNow(1);
    await openAt(page, shop, date);

    await page.getByRole("button", { name: "הוספה ליום" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /שינוי ביומן/ }).click();
    await page.getByRole("button", { name: date }).click();
    await page.getByRole("button", { name: "המשך" }).click();

    const sheet = page.getByRole("dialog");
    await sheet.getByRole("radio", { name: /^לא עובדים בחלק מהיום/ }).click();
    await sheet.getByLabel("מ־", { exact: true }).fill("10:00");
    await sheet.getByLabel("עד", { exact: true }).fill("12:00");
    await sheet.getByRole("button", { name: "שמירת השינוי" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // Those two hours gone from what a customer is offered, and the rest still there.
    await expect.poll(async () => hoursOn(shop, date), { timeout: 15_000 }).not.toContain("10:00");
    const hours = await hoursOn(shop, date);
    expect(hours).not.toContain("11:00");
    expect(hours).toEqual(expect.arrayContaining(["09:00", "12:00", "16:00"]));
  });

  test("adds a special day that closes the shop, and one with other hours", async ({
    page,
  }) => {
    const shop = await aBusinessWithOpenHours({
      name: `מיוחד ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    const date = aDayFromNow(1);
    await openAt(page, shop, date);

    await page.getByRole("button", { name: "הוספה ליום" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /שינוי ביומן/ }).click();
    await page.getByRole("button", { name: date }).click();
    await page.getByRole("button", { name: "המשך" }).click();

    const sheet = page.getByRole("dialog");
    await sheet.getByRole("radio", { name: /^לא עובדים כל היום/ }).click();
    await sheet.getByRole("button", { name: "שמירת השינוי" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    await expect.poll(async () => offeredOn(shop, date), { timeout: 15_000 }).toBe(0);

    // The day now says it is closed, and the change behind it is edited into other hours.
    await expect(page.getByText("סגור כל היום").first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "פרטי השינוי" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "עריכה" }).click();
    const again = page.getByRole("dialog");
    await again.getByRole("radio", { name: /^עובדים בשעות אחרות/ }).click();
    await again.getByLabel("מ־", { exact: true }).fill("10:00");
    await again.getByLabel("עד", { exact: true }).fill("12:00");
    await again.getByRole("button", { name: "שמירת השינוי" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // Open again, and only in the hours it was given.
    await expect
      .poll(
        async () => {
          const hours = await hoursOn(shop, date);
          return hours.length > 0 && hours.every((hour) => hour >= "10:00" && hour < "12:00");
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  });
});

test.describe("special days and blockages", () => {
  const anOwnerAt = async (name: string) =>
    aBusinessWithOpenHours({
      name: `${name} ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "08:00", end: "20:00" },
    });

  /** The schedule's "שינויים", and the sheet its button opens for the one calendar. */
  const openTheChanges = async (page: Page, shop: { business: { id: string }; owner: { token: string } }) => {
    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await page.getByRole("button", { name: "לוח זמנים" }).click();
    await page.getByRole("tab", { name: "שינויים" }).click();
    await page.getByRole("button", { name: "שינוי ביומן א" }).click();
    return page.getByRole("dialog");
  };

  const offeredOn = async (
    shop: { business: { id: string }; service: { id: string }; resource: { id: string } },
    date: string,
  ) => {
    const days = await call<{ slots: { startAt: string }[] }[]>(
      `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
        `&resourceId=${shop.resource.id}&from=${date}&to=${date}`,
    );
    return (days[0]?.slots ?? []).map((slot) => slot.startAt);
  };

  const asHour = (startAt: string) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jerusalem",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(startAt));

  test("a special day can be open twice with a break between", async ({ page }) => {
    const shop = await anOwnerAt("יום חריג");
    const sheet = await openTheChanges(page, shop);

    const day = aDayFromNow(1);
    await sheet.getByLabel("מתאריך").fill(day);
    await sheet.getByLabel("עד תאריך").fill(day);
    await sheet.getByRole("radio", { name: /^עובדים בשעות אחרות/ }).click();

    // Morning, then a gap, then the evening — one change, not two (which the
    // store could not have held anyway: one override per date).
    await sheet.getByLabel("מ־", { exact: true }).first().fill("09:00");
    await sheet.getByLabel("עד", { exact: true }).first().fill("11:00");
    await sheet.getByRole("button", { name: "+ עוד טווח" }).click();
    await sheet.getByLabel("מ־", { exact: true }).nth(1).fill("17:00");
    await sheet.getByLabel("עד", { exact: true }).nth(1).fill("19:00");
    // No "break" named between them here: the owner is saying which hours are
    // open, and the gap is simply the hours that are not. The word belongs to
    // the weekly hours, where it names a real thing.
    await expect(sheet.getByText(/^הפסקה ·/)).toHaveCount(0);
    await expect(sheet.locator(".change-sentence")).toContainText("09:00–11:00, 17:00–19:00");

    await sheet.getByRole("button", { name: "שמירת השינוי" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    await expect
      .poll(async () => (await offeredOn(shop, day)).map(asHour), { timeout: 15_000 })
      .toEqual(expect.arrayContaining(["09:00", "17:00"]));
    const hours = (await offeredOn(shop, day)).map(asHour);
    expect(hours).not.toContain("13:00");
    expect(hours).not.toContain("19:30");
  });

  test("a blockage covers a range of days in one go", async ({ page }) => {
    const shop = await anOwnerAt("חופשה");
    const sheet = await openTheChanges(page, shop);

    const first = aDayFromNow(1);
    const last = aDayFromNow(2);
    await sheet.getByLabel("מתאריך").fill(first);
    await sheet.getByLabel("עד תאריך").fill(last);
    await sheet.getByRole("radio", { name: /^לא עובדים כל היום/ }).click();
    await sheet.getByLabel("הערה (לא חובה)").fill("חופשה");
    await sheet.getByRole("button", { name: "שמירת השינוי" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // Both days are gone for a customer, from one form.
    await expect.poll(async () => (await offeredOn(shop, first)).length, { timeout: 15_000 })
      .toBe(0);
    expect(await offeredOn(shop, last)).toHaveLength(0);
    // And still bookable the day after, so the range ended where it was told to.
    expect((await offeredOn(shop, aDayFromNow(3))).length).toBeGreaterThan(0);
  });

  test("lists a blockage made for a later day, not only today's", async ({ page }) => {
    const shop = await anOwnerAt("רשימת חסימות");
    const sheet = await openTheChanges(page, shop);

    // Two days out: the list is a list of standing decisions, and the day the
    // screen happens to be open on says nothing about which of them exist.
    const later = aDayFromNow(2);
    await sheet.getByLabel("מתאריך").fill(later);
    await sheet.getByLabel("עד תאריך").fill(later);
    await sheet.getByRole("radio", { name: /^לא עובדים בחלק מהיום/ }).click();
    await sheet.getByLabel("מ־", { exact: true }).fill("10:30");
    await sheet.getByLabel("עד", { exact: true }).fill("11:00");
    await sheet.getByLabel("הערה (לא חובה)").fill("פגישה עם ספק");
    await sheet.getByRole("button", { name: "שמירת השינוי" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // It is on the list that exists to show it, without going anywhere.
    await expect(page.getByText("פגישה עם ספק")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("לא עובדים 10:30–11:00")).toBeVisible();
  });

  test("and can keep the same hours free on each of those days", async ({ page }) => {
    const shop = await anOwnerAt("שעה קבועה");
    const sheet = await openTheChanges(page, shop);

    const first = aDayFromNow(1);
    const last = aDayFromNow(2);
    await sheet.getByLabel("מתאריך").fill(first);
    await sheet.getByLabel("עד תאריך").fill(last);
    await sheet.getByRole("radio", { name: /^לא עובדים בחלק מהיום/ }).click();
    await sheet.getByLabel("מ־", { exact: true }).first().fill("10:00");
    await sheet.getByLabel("עד", { exact: true }).first().fill("11:00");
    await sheet.getByRole("button", { name: "+ עוד טווח" }).click();
    await sheet.getByLabel("מ־", { exact: true }).nth(1).fill("14:00");
    await sheet.getByLabel("עד", { exact: true }).nth(1).fill("15:00");
    await sheet.getByLabel("הערה (לא חובה)").fill("שיעור");
    await sheet.getByRole("button", { name: "שמירת השינוי" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // Two hours on each of two days: four blocks from one form, and the rest of
    // both days still open.
    for (const day of [first, last]) {
      await expect
        .poll(async () => (await offeredOn(shop, day)).map(asHour), { timeout: 15_000 })
        .not.toContain("10:00");
      const hours = (await offeredOn(shop, day)).map(asHour);
      expect(hours).not.toContain("14:00");
      expect(hours).toContain("12:00");
    }
  });
});

test.describe("the business panel", () => {
  test("publishes an Instagram and a WhatsApp, and the customer can reach both", async ({
    page,
  }) => {
    const name = `ערוצים ${Date.now()}`;
    const shop = await aBusinessWithOpenHours({ name, ownerPhone: uniquePhone() });
    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );

    await page.goto("/manage");
    await ready(page);
    await page.getByRole("button", { name: "העסק" }).click();
    await page.getByRole("button", { name: "הגדרות העסק" }).click();

    // Typed the way a person writes it: with the @, which is not part of it.
    await page.getByLabel("אינסטגרם").fill("@dreamhair");
    // Local digits behind the flag, like every other number in the app.
    await page.getByLabel("וואטסאפ").fill(asTyped("+972545646946"));
    await page.getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByText("ההגדרות נשמרו")).toBeVisible({ timeout: 15_000 });

    const profile = await call<{ business: { instagram: string; whatsapp: string } }>(
      `/businesses/${shop.business.id}`,
    );
    expect(profile.business.instagram).toBe("dreamhair");
    expect(profile.business.whatsapp).toBe("+972545646946");

    // And on the customer's side, one tap each.
    await page.goto("/?screen=search");
    await ready(page);
    await page.getByPlaceholder("מספרה, קליניקה, מאמן אישי…").fill(name.slice(0, 7));
    await page.getByText(name, { exact: false }).first().click();

    await expect(page.getByRole("link", { name: /וואטסאפ/ })).toHaveAttribute(
      "href",
      "https://wa.me/972545646946",
    );
    // Icon-only, so the accessible name is what a screen reader is given — and
    // what this asserts, since there is no text to look for.
    await expect(
      page.getByRole("link", { name: "אינסטגרם @dreamhair" }),
    ).toHaveAttribute("href", "https://instagram.com/dreamhair");
  });

  test("asks what becomes of the bookings before a calendar is taken away", async ({
    page,
  }) => {
    const shop = await aBusinessWithOpenHours({
      name: `הסרה ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });

    // A second calendar, since the last one on offer cannot be removed, and a
    // customer booked onto it.
    const second = await call<{ id: string; name: string }>(
      `/businesses/${shop.business.id}/resources`,
      { method: "POST", token: shop.owner.token, body: { name: "כיסא שני" } },
    );
    const customerPhone = uniquePhone();
    const { code } = await call<{ code: string }>("/auth/request-code", {
      method: "POST",
      body: { phone: customerPhone },
    });
    const { token } = await call<{ token: string }>("/auth/verify", {
      method: "POST",
      body: {
        phone: customerPhone,
        code,
        name: { givenName: "דנה", familyName: "כהן" },
      },
    });
    const startAt = await theNextStart({ ...shop, resource: second });
    await call("/appointments", {
      method: "POST",
      token,
      body: {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: second.id,
        startAt,
        customerNote: null,
      },
    });

    await page.addInitScript(
      ([key, sessionToken]) =>
        window.localStorage.setItem(key as string, sessionToken as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto("/manage");
    await ready(page);
    await page.getByRole("button", { name: "העסק" }).click();
    await page.getByRole("button", { name: "יומנים" }).click();

    // Both calendars offer removal, so this names the one under test.
    await page
      .locator(".card", { hasText: "כיסא שני" })
      .getByRole("button", { name: "מחיקה" })
      .click();

    // The question, with the number of people it affects in it.
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText(/1 תורים עתידיים/)).toBeVisible();

    await page.getByRole("button", { name: "להסיר ולהשאיר את התורים העתידיים" }).click();

    // The calendar is off the list customers see, and the appointment stands.
    await expect(page.getByText("מוסתר").first()).toBeVisible({ timeout: 15_000 });
    const mine = await call<{ status: string }[]>("/me/appointments", { token });
    expect(mine.map((appointment) => appointment.status)).toEqual(["CONFIRMED"]);
  });

  test("a day can be open more than twice, and overlapping stretches merge", async ({
    page,
  }) => {
    const shop = await aBusinessWithOpenHours({
      name: `טווחים ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );

    await page.goto("/manage");
    await ready(page);
    await page.getByRole("button", { name: "לוח זמנים" }).click();
    await expect(page.getByText("רוב הימים")).toBeVisible({ timeout: 15_000 });

    // 09:00–17:00 already, plus a stretch that overlaps it and a third that
    // stands apart. The overlap is one stretch however it is typed.
    const usual = page.locator(".card", { hasText: "רוב הימים" }).first();
    await usual.getByRole("button", { name: "הוספת טווח שעות" }).click();
    await usual.locator('input[type="time"]').nth(2).fill("16:00");
    await usual.locator('input[type="time"]').nth(3).fill("18:00");
    await usual.getByRole("button", { name: "הוספת טווח שעות" }).click();
    await usual.locator('input[type="time"]').nth(4).fill("20:00");
    await usual.locator('input[type="time"]').nth(5).fill("22:00");

    // What sits between two stretches is named, and what runs into the one
    // before it says so rather than vanishing under the hand that typed it.
    await expect(usual.getByText("חופף — יישמר כטווח אחד")).toBeVisible();
    await expect(usual.getByText(/הפסקה · 18:00–20:00/)).toBeVisible();

    await page.getByRole("button", { name: "שמירה" }).last().click();
    await expect(page.getByText("ההגדרות נשמרו")).toBeVisible({ timeout: 15_000 });

    const week = await call<{ dayOfWeek: number; start: string; end: string }[]>(
      `/businesses/${shop.business.id}/resources/${shop.resource.id}/working-hours`,
      { token: shop.owner.token },
    );
    const mondayRanges = week
      .filter((entry) => entry.dayOfWeek === 1)
      .map((entry) => `${entry.start}-${entry.end}`)
      .sort();
    expect(mondayRanges).toEqual(["09:00-18:00", "20:00-22:00"]);
  });

  test("a calendar's week is edited in the words the wizard used", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `שבוע ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );

    await page.goto("/manage");
    await ready(page);
    await page.getByRole("button", { name: "לוח זמנים" }).click();

    // The wizard's editor: the hours most days keep, and the days that keep
    // them — not seven identical cards.
    await expect(page.getByText("רוב הימים")).toBeVisible({ timeout: 15_000 });

    // Sunday off the usual, then shut — two taps, because "this day is
    // different" and "this day is off" are different sentences and only the
    // owner says the second one.
    const usual = page.locator(".card", { hasText: "רוב הימים" }).first();
    await usual.getByRole("button", { name: "ראשון" }).click();
    await expect(page.getByText("ימים אחרים")).toBeVisible();
    const sunday = page.locator(".card", { hasText: "ראשון" }).first();
    await sunday.getByRole("button", { name: "סגור", exact: true }).click();
    await expect(sunday.getByRole("button", { name: "סגור", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.getByRole("button", { name: "שמירה" }).last().click();
    await expect(page.getByText("ההגדרות נשמרו")).toBeVisible({ timeout: 15_000 });

    // What a customer is offered follows from it.
    const week = await call<{ dayOfWeek: number }[]>(
      `/businesses/${shop.business.id}/resources/${shop.resource.id}/working-hours`,
      { token: shop.owner.token },
    );
    expect(week.map((entry) => entry.dayOfWeek)).not.toContain(0);
    expect(week.length).toBeGreaterThan(0);
  });

  test("one day keeps its own hours while the rest keep the usual", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `שישי קצר ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );

    await page.goto("/manage");
    await ready(page);
    await page.getByRole("button", { name: "לוח זמנים" }).click();
    await expect(page.getByText("רוב הימים")).toBeVisible({ timeout: 15_000 });

    // "Nine to five, Friday till one" — the sentence the screen is built for.
    const usual = page.locator(".card", { hasText: "רוב הימים" }).first();
    await usual.getByRole("button", { name: "שישי" }).click();

    const friday = page.locator(".card", { hasText: "שישי" }).first();
    await friday.getByRole("button", { name: "שעות אחרות" }).click();
    await friday.locator('input[type="time"]').nth(1).fill("13:00");

    await page.getByRole("button", { name: "שמירה" }).last().click();
    await expect(page.getByText("ההגדרות נשמרו")).toBeVisible({ timeout: 15_000 });

    const week = await call<{ dayOfWeek: number; start: string; end: string }[]>(
      `/businesses/${shop.business.id}/resources/${shop.resource.id}/working-hours`,
      { token: shop.owner.token },
    );
    const said = (dayOfWeek: number) =>
      week
        .filter((entry) => entry.dayOfWeek === dayOfWeek)
        .map((entry) => `${entry.start}-${entry.end}`);

    // The one day moved, and the days on the usual did not.
    expect(said(5)).toEqual(["09:00-13:00"]);
    expect(said(0)).toEqual(["09:00-17:00"]);
    expect(said(4)).toEqual(["09:00-17:00"]);
  });

  test("renames a calendar without touching what is booked on it", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `שם ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });
    const customerPhone = uniquePhone();
    const { code } = await call<{ code: string }>("/auth/request-code", { method: "POST", body: { phone: customerPhone } });
    const customer = await call<{ token: string }>("/auth/verify", {
      method: "POST",
      body: { phone: customerPhone, code, name: { givenName: "דנה", familyName: "כהן" } },
    });
    const booked = await call<{ id: string }>("/appointments", {
      method: "POST",
      token: customer.token,
      body: {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: shop.resource.id,
        startAt: await theNextStart(shop),
        customerNote: null,
      },
    });
    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );

    await page.goto("/manage");
    await ready(page);
    await page.getByRole("button", { name: "העסק" }).click();
    await page.getByRole("button", { name: "יומנים" }).click();

    // The name is the control: pressing it is how it is changed.
    await page.getByRole("button", { name: `שינוי שם ${shop.resource.name}` }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // It opens with the name selected and takes Enter as done, so a rename is
    // type-and-return rather than a hunt for a button.
    await page.getByRole("dialog").getByLabel("שם היומן").fill("עמדה ראשית");
    await page.getByRole("dialog").getByLabel("שם היומן").press("Enter");

    await expect(page.getByText("עמדה ראשית")).toBeVisible({ timeout: 15_000 });

    // And a customer choosing between calendars sees the new name.
    const profile = await call<{ resources: { name: string }[] }>(
      `/businesses/${shop.business.id}`,
    );
    expect(profile.resources.map((resource) => resource.name)).toContain("עמדה ראשית");

    // And what was booked on it stands, on the same calendar.
    const theirs = await call<{ id: string; status: string; resourceId: string }[]>("/me/appointments", {
      token: customer.token,
    });
    expect(theirs).toEqual([
      expect.objectContaining({ id: booked.id, status: "CONFIRMED", resourceId: shop.resource.id }),
    ]);
  });

  test("edit on a calendar opens that calendar's schedule", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `עריכה ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });
    await call(`/businesses/${shop.business.id}/resources`, {
      method: "POST",
      token: shop.owner.token,
      body: { name: "כיסא שני" },
    });
    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );

    await page.goto("/manage");
    await ready(page);
    await page.getByRole("button", { name: "העסק" }).click();
    await page.getByRole("button", { name: "יומנים" }).click();

    // The second calendar is not the one the schedule would open on by
    // default, which is the whole point of pressing edit on its row.
    await page
      .locator(".card", { hasText: "כיסא שני" })
      .getByRole("button", { name: "עריכה" })
      .click();

    // The schedule screen, open on the calendar whose row was pressed — not on
    // the first one, which is what it would have shown by default.
    await expect(
      page.getByRole("button", { name: "כיסא שני", pressed: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("tab", { name: "שינויים" })).toBeVisible();
  });

  test("hides a calendar from customers, and brings it back", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `יומנים ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });
    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );

    await page.goto("/manage");
    await ready(page);
    await page.getByRole("button", { name: "העסק" }).click();
    await page.getByRole("button", { name: "יומנים" }).click();

    // A second one, since the last calendar on offer cannot be taken away.
    await page.getByRole("button", { name: "הוספה" }).click();
    await page.getByRole("dialog").getByLabel("יומנים").fill("כיסא שני");
    await page.getByRole("dialog").getByRole("button", { name: "הוספה" }).click();
    await expect(page.getByText("כיסא שני")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "הסתרה" }).first().click();
    await expect(page.getByRole("button", { name: "הצגה" }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("מוסתר").first()).toBeVisible();

    const whileHidden = await call<{ resources: { name: string }[] }>(
      `/businesses/${shop.business.id}`,
    );
    expect(whileHidden.resources).toHaveLength(1);

    await page.getByRole("button", { name: "הצגה" }).first().click();
    await expect(page.getByRole("button", { name: "הסתרה" }).first()).toBeVisible({
      timeout: 15_000,
    });

    const whenShown = await call<{ resources: { name: string }[] }>(
      `/businesses/${shop.business.id}`,
    );
    expect(whenShown.resources).toHaveLength(2);
  });

  test("hides a service from customers, and brings it back", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `הסתרה ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });
    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );

    await page.goto("/manage");
    await ready(page);
    await page.getByRole("button", { name: "העסק" }).click();

    // Hiding is its own control. It used to be reachable only through the
    // editor's "remove", which deletes a service nobody has booked yet — and
    // offered no way back from either outcome.
    await page.getByRole("button", { name: "הסתרה" }).first().click();
    await expect(page.getByRole("button", { name: "הצגה" }).first()).toBeVisible({
      timeout: 15_000,
    });

    // And it says so on the row, not only on the control: the owner should be
    // able to tell at a glance which of their services customers can book.
    await expect(page.getByText("מוסתר").first()).toBeVisible();

    const whileHidden = await call<{ services: { name: string }[] }>(
      `/businesses/${shop.business.id}`,
    );
    expect(whileHidden.services.map((service) => service.name)).not.toContain(
      shop.service.name,
    );

    // And back again, which was impossible before: a withdrawn service could
    // never be offered a second time.
    await page.getByRole("button", { name: "הצגה" }).first().click();
    await expect(page.getByRole("button", { name: "הסתרה" }).first()).toBeVisible({
      timeout: 15_000,
    });

    const whenShown = await call<{ services: { name: string }[] }>(
      `/businesses/${shop.business.id}`,
    );
    expect(whenShown.services.map((service) => service.name)).toContain(shop.service.name);
  });

  test("adds a service, and the customer can then book it", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `שירותים ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });
    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );

    await page.goto("/manage");
    await ready(page);
    await page.getByRole("button", { name: "העסק" }).click();
    await page.getByRole("button", { name: "הוספת שירות" }).click();

    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByLabel("שם השירות").fill("צבע");
    await page.getByLabel("משך בדקות").fill("60");
    await page.getByLabel("מחיר בשקלים").fill("250");
    await page.getByRole("dialog").getByRole("button", { name: "שמירה" }).click();

    await expect(page.getByText("צבע")).toBeVisible({ timeout: 15_000 });

    const profile = await call<{ services: { id: string; name: string; durationMinutes: number }[] }>(
      `/businesses/${shop.business.id}`,
    );
    const colour = profile.services.find((service) => service.name === "צבע");
    expect(colour).toMatchObject({ durationMinutes: 60 });

    // Offered, and a customer takes it.
    const startAt = await theNextStart({ ...shop, service: { id: colour?.id ?? "" } });
    const customerPhone = uniquePhone();
    const { code } = await call<{ code: string }>("/auth/request-code", { method: "POST", body: { phone: customerPhone } });
    const customer = await call<{ token: string }>("/auth/verify", {
      method: "POST",
      body: { phone: customerPhone, code, name: { givenName: "רותם", familyName: "צבע" } },
    });
    const booking = await call<{ status: string; serviceId: string }>("/appointments", {
      method: "POST",
      token: customer.token,
      body: {
        businessId: shop.business.id,
        serviceId: colour?.id,
        resourceId: shop.resource.id,
        startAt,
        customerNote: null,
      },
    });
    expect(booking).toMatchObject({ status: "CONFIRMED", serviceId: colour?.id });
  });

  test("settings changes are warned about and take effect on availability", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `הגדרות ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });
    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );

    await page.goto("/manage");
    await ready(page);
    await page.getByRole("button", { name: "העסק" }).click();
    await page.getByRole("button", { name: "הגדרות העסק" }).click();

    const offeredOn = async (date: string) =>
      (
        await call<{ slots: unknown[] }[]>(
          `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
            `&resourceId=${shop.resource.id}&from=${date}&to=${date}`,
        )
      )[0]?.slots.length ?? 0;
    expect(await offeredOn(aDayFromNow(3))).toBeGreaterThan(0);

    await expect(page.getByText(/שינוי כאן משפיע/)).toBeVisible();
    await page.getByLabel(/עד כמה רחוק אפשר לתפוס תור/).fill("1");
    await page.getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByText("ההגדרות נשמרו.")).toBeVisible({ timeout: 15_000 });

    const profile = await call<{ business: { bookingHorizonDays: number } }>(
      `/businesses/${shop.business.id}`,
    );
    expect(profile.business.bookingHorizonDays).toBe(1);
    // Three days out is now beyond what may be booked.
    expect(await offeredOn(aDayFromNow(3))).toBe(0);
  });
});

const yesterday = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(
    new Date(Date.now() - 24 * 60 * 60 * 1000),
  );


test.describe("the month view", () => {
  test("shows how busy each day is, and opens the day that is clicked", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({
      name: `יומן חודשי ${Date.now()}`,
      ownerPhone,
    });

    // Two on one day, and none on the next, in one month: the squares side by
    // side say which is busy. Built from the shop's own clock, so the bookings
    // land on the square the test opens whatever the hour in UTC.
    const [busyDay, quietDay] = inOneMonth([2, 3]);
    const when = (hour: number) => anInstantAt(busyDay, `${String(hour).padStart(2, "0")}:00`);
    for (const hour of [9, 11]) {
      const customer = uniquePhone();
      const { code } = await call<{ code: string }>("/auth/request-code", {
        method: "POST",
        body: { phone: customer },
      });
      const { token } = await call<{ token: string }>("/auth/verify", {
        method: "POST",
        body: { phone: customer, code, name: { givenName: "דנה", familyName: "כהן" } },
      });
      await call("/appointments", {
        method: "POST",
        token,
        body: {
          businessId: shop.business.id,
          serviceId: shop.service.id,
          resourceId: shop.resource.id,
          startAt: when(hour),
          customerNote: null,
        },
      });
    }

    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);

    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });

    // Each calendar's mark on a square is filled on a day with bookings and an
    // empty outline on a day with none.
    await showTheMonthOf(page, busyDay);
    const mark = (date: string) =>
      page.getByRole("button", { name: date }).locator(`i[title="${shop.resource.name}"]`);
    await expect(mark(busyDay)).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(mark(quietDay)).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

    // The squares are dated, and tapping one draws that day underneath — where
    // both bookings are, which is more than a count ever said.
    await openTheDayOf(page, busyDay);
    await expect(page.getByText("דנה כהן").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /דנה כהן/ })).toHaveCount(2);
  });

});

test.describe("an appointment whose time has passed", () => {
  test("cannot be moved, only cancelled or marked a no show", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({
      name: `עבר ${Date.now()}`,
      ownerPhone,
    });

    // Booked for a moment that has already gone by. The booking window refuses
    // that from outside, so it is written the way the past gets into a
    // calendar in the first place: by time passing.
    const customerPhone = uniquePhone();
    const { code } = await call<{ code: string }>("/auth/request-code", {
      method: "POST",
      body: { phone: customerPhone },
    });
    const { token } = await call<{ token: string }>("/auth/verify", {
      method: "POST",
      body: { phone: customerPhone, code, name: { givenName: "דנה", familyName: "כהן" } },
    });
    const slot = await theNextStart(shop);
    const booking = await call<{ id: string; startAt: string }>("/appointments", {
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
    await movedIntoThePast(booking.id);

    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    // Yesterday, where the appointment now sits. A square is chosen and then
    // opened: the tap says what is in the day before going into it.
    await openTheDayOf(page, yesterday());

    await page.getByText("דנה כהן").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // The one thing it cannot be given is a different time.
    await expect(page.getByRole("button", { name: "העברה לשעה אחרת" })).toHaveCount(0);
    await expect(page.getByText(/כבר התחיל/)).toBeVisible();
    // The two that remain, both on offer because the time has come and gone.
    await expect(page.getByRole("button", { name: "סימון שלא הגיע" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "ביטול התור" })).toBeEnabled();
  });
});

test.describe("finding one appointment", () => {
  test("a name reaches an appointment months out, without paging to it", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({
      name: `חיפוש ${Date.now()}`,
      ownerPhone,
    });
    const customerPhone = uniquePhone();
    const { code } = await call<{ code: string }>("/auth/request-code", {
      method: "POST",
      body: { phone: customerPhone },
    });
    const { token } = await call<{ token: string }>("/auth/verify", {
      method: "POST",
      body: { phone: customerPhone, code, name: { givenName: "אורית", familyName: "שגב" } },
    });

    // Far enough ahead that neither the day strip nor this month reaches it.
    const far = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000);
    far.setUTCHours(9, 0, 0, 0);
    const day = far.toISOString().slice(0, 10);
    const [available] = await call<{ slots: { startAt: string }[] }[]>(
      `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
        `&resourceId=${shop.resource.id}&from=${day}&to=${day}`,
    );
    const slot = available?.slots[0]?.startAt ?? "";
    expect(slot).not.toBe("");
    await call("/appointments", {
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

    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);

    // The day the owner is looking at does not have it.
    await expect(page.getByText("אורית שגב")).toHaveCount(0);

    // Typing offers the person, and choosing her narrows to her things — which
    // is what tells two customers of the same name apart.
    await openTheSearch(page);
    await page.getByPlaceholder("חיפוש תור לפי שם או טלפון").fill("אורית");
    await page
      .getByRole("button", { name: /לקוח\s+אורית שגב/ })
      .click({ timeout: 15_000 });
    await expect(page.getByText("אורית שגב").first()).toBeVisible();

    // And her appointment opens into the same controls as the calendar.
    await page.getByRole("button", { name: /תספורת/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("button", { name: "העברת התור לשעה אחרת" })).toBeVisible();

    // The customer reads as a person: a name, a number under it, and the two
    // things an owner does with a number. Not a field labelled with the
    // customers list's search placeholder, which is what it used to be.
    const sheet = page.getByRole("dialog");
    // Exactly: "book another for her" also carries her name now, and this
    // assertion is about the card that says who she is.
    await expect(sheet.getByText("אורית שגב", { exact: true })).toBeVisible();
    await expect(sheet.getByText("חיפוש לפי שם או טלפון")).toHaveCount(0);
    // Both ways to reach them, as marks rather than words.
    await expect(sheet.getByRole("link", { name: /חיוג/ })).toBeVisible();
    await expect(sheet.getByRole("link", { name: /וואטסאפ/ })).toBeVisible();
  });

  test("a phone number finds it too, and says so when nothing matches", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({
      name: `חיפוש טלפון ${Date.now()}`,
      ownerPhone,
    });
    const customerPhone = uniquePhone();
    const { code } = await call<{ code: string }>("/auth/request-code", { method: "POST", body: { phone: customerPhone } });
    const { token } = await call<{ token: string }>("/auth/verify", {
      method: "POST",
      body: { phone: customerPhone, code, name: { givenName: "טל", familyName: "מספרי" } },
    });
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
    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);

    // The number as an owner reads it off a missed call: local, with the 0.
    await openTheSearch(page);
    const box = page.getByPlaceholder("חיפוש תור לפי שם או טלפון");
    await box.fill(`0${asTyped(customerPhone)}`);
    await expect(page.getByRole("button", { name: /לקוח\s+טל מספרי/ })).toBeVisible({ timeout: 15_000 });

    // And a number nobody booked with says so.
    await box.fill("0500000000");
    await expect(page.getByText("לא נמצא תור מתאים")).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("a customer's own page", () => {
  /** A business, a customer, and one booking between them. */
  const aBookingFor = async (ownerPhone: string, customerPhone: string) => {
    const shop = await aBusinessWithOpenHours({
      name: `לקוחות ${Date.now()}`,
      ownerPhone,
    });
    const { code } = await call<{ code: string }>("/auth/request-code", {
      method: "POST",
      body: { phone: customerPhone },
    });
    const { token } = await call<{ token: string }>("/auth/verify", {
      method: "POST",
      body: {
        phone: customerPhone,
        code,
        name: { givenName: "דנה", familyName: "כהן" },
      },
    });
    const startAt = await theNextStart(shop);
    await call("/appointments", {
      method: "POST",
      token,
      body: {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: shop.resource.id,
        startAt,
        customerNote: null,
      },
    });
    return shop;
  };

  test("opens as a page, with the number ready to call or message", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const customerPhone = uniquePhone();
    const shop = await aBookingFor(ownerPhone, customerPhone);

    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await page.getByRole("button", { name: "לקוחות", exact: true }).click();
    await page.getByText("דנה כהן").first().click();

    // A page of its own, not a sheet over the list.
    await expect(page).toHaveURL(/\/manage\/customers\//, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "דנה כהן" })).toBeVisible();
    // The canvas's card: the counts read as label and value, "customer since"
    // among them, rather than a row of tiles.
    await expect(page.getByText("לקוח מאז")).toBeVisible();
    await expect(page.getByText("היסטוריית התורים")).toBeVisible();

    // One tap to ring them, one to message them; neither asks the owner to
    // transcribe the number first.
    await expect(page.getByRole("link", { name: `חיוג ${customerPhone}` })).toHaveAttribute(
      "href",
      `tel:${customerPhone}`,
    );
    await expect(
      page.getByRole("link", { name: `וואטסאפ ${customerPhone}` }),
    ).toHaveAttribute("href", `https://wa.me/${customerPhone.replace("+", "")}`);
  });

  test("the list finds a customer by the number written the local way", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const customerPhone = uniquePhone();
    const shop = await aBookingFor(ownerPhone, customerPhone);

    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await page.getByRole("button", { name: "לקוחות", exact: true }).click();
    const search = page.getByPlaceholder("חיפוש לפי שם או טלפון");

    // "055-123-4567", as it is read off a missed call.
    const local = `0${asTyped(customerPhone)}`;
    await search.fill(`${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`);
    await expect(page.getByText("דנה כהן")).toBeVisible({ timeout: 15_000 });
    await search.fill("0500000000");
    await expect(page.getByText("דנה כהן")).toHaveCount(0);
  });

  test("going back returns to the customers list, not the calendar", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBookingFor(ownerPhone, uniquePhone());

    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await page.getByRole("button", { name: "לקוחות", exact: true }).click();
    await page.getByText("דנה כהן").first().click();
    await expect(page).toHaveURL(/\/manage\/customers\//, { timeout: 15_000 });

    await page.getByRole("button", { name: "לקוחות" }).first().click();

    // The list they left, not the day view the app opens on.
    await expect(page).toHaveURL(/tab=customers/, { timeout: 15_000 });
    await expect(page.getByPlaceholder("חיפוש לפי שם או טלפון")).toBeVisible();
  });

  test("an appointment can be cancelled from the customer's page", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const ownerPhone = uniquePhone();
    const shop = await aBookingFor(ownerPhone, uniquePhone());

    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await page.getByRole("button", { name: "לקוחות", exact: true }).click();
    await page.getByText("דנה כהן").first().click();
    await expect(page).toHaveURL(/\/manage\/customers\//, { timeout: 15_000 });

    // The same actions the calendar offers, from where the owner is looking.
    await page.getByText(shop.service.name).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "ביטול ופרסום השעה" }).click();

    // The history keeps it, struck through, exactly as the customer sees it.
    await expect(page.locator(".cancelled").first()).toBeVisible({ timeout: 15_000 });
  });

  test("an appointment opened from the record says which day it was", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBookingFor(ownerPhone, uniquePhone());

    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await page.getByRole("button", { name: "לקוחות", exact: true }).click();
    await page.getByText("דנה כהן").first().click();
    await expect(page).toHaveURL(/\/manage\/customers\//, { timeout: 15_000 });

    await page.getByText(shop.service.name).first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    // The record runs back over years, so the hour alone does not say which
    // morning this was: the weekday and the date come with it.
    await expect(sheet.getByText(/יום \S+.*\d+ ב\S+ · \d\d:\d\d–\d\d:\d\d/)).toBeVisible();
  });

  test("an owner who books in their own chair is on their own list", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({
      name: `בעלים לקוח ${Date.now()}`,
      ownerPhone,
    });

    // A one-person business takes appointments with itself; the owner holds the
    // OWNER role there, which is what used to keep them out of the list.
    const startAt = await theNextStart(shop);
    await call("/appointments", {
      method: "POST",
      token: shop.owner.token,
      body: {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: shop.resource.id,
        startAt,
        customerNote: null,
      },
    });

    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await page.getByRole("button", { name: "לקוחות", exact: true }).click();

    // On the list, and the row is theirs: it opens their own record.
    await page.getByPlaceholder("חיפוש לפי שם או טלפון").fill("בעלים");
    await page.getByText("בעלים", { exact: true }).first().click({ timeout: 15_000 });
    await expect(page).toHaveURL(new RegExp(`/manage/customers/${shop.owner.user.id}`), { timeout: 15_000 });
  });
});

test.describe("photos", () => {
  /**
   * A one-pixel PNG. Small enough to write here, real enough that the browser
   * decodes it — the picker re-encodes through a canvas, so a file that is not
   * genuinely an image never reaches the API.
   */
  const photosOf = async (businessId: string) =>
    (await call<{ photos: { id: string; slot: number }[] }>(`/businesses/${businessId}`)).photos;

  const A_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  test("the business panel replaces and removes photos, and the customer sees it", async ({ page }) => {
    const phone = uniquePhone();
    const shop = await aBusinessWithOpenHours({
      name: `עסק לעריכה ${Date.now()}`,
      ownerPhone: phone,
    });
    await signInDirectly(page, phone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);

    // The panel lives behind the business tab, beside services and settings.
    await page.getByRole("button", { name: "העסק", exact: true }).click();
    await page.getByRole("button", { name: "תמונות", exact: true }).click();
    await expect(page.getByText("תמונה ראשית")).toBeVisible();

    const files = page.locator('input[type="file"]');
    await files.nth(0).setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: A_PNG });
    // The cover is there, and the tile now offers to replace rather than add.
    await expect(page.getByRole("button", { name: "החלפה" })).toBeVisible({ timeout: 15_000 });
    const first = await photosOf(shop.business.id);
    expect(first).toHaveLength(1);

    // Replacing is one action, and the slot stays a slot.
    await files.nth(0).setInputFiles({ name: "other.png", mimeType: "image/png", buffer: A_PNG });
    await expect(async () => {
      const after = await photosOf(shop.business.id);
      expect(after).toHaveLength(1);
      expect(after[0]?.id).not.toBe(first[0]?.id);
    }).toPass({ timeout: 15_000 });

    // And removing means removed, not pending.
    await page.getByRole("button", { name: "הסרה" }).first().click();
    await expect(async () => {
      expect(await photosOf(shop.business.id)).toHaveLength(0);
    }).toPass({ timeout: 15_000 });

    // The customer's page follows: no photos, no gallery.
    await page.goto("/?screen=search");
    await ready(page);
    await page.getByPlaceholder("מספרה, קליניקה, מאמן אישי…").fill(shop.business.name.slice(0, 8));
    await page.getByText(shop.business.name).first().click();
    await expect(page.getByText(shop.service.name).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("region", { name: "תמונות מהעסק" })).toHaveCount(0);
  });

  test("a cover chosen in the wizard is on the business page afterwards", async ({ page }) => {
    const phone = uniquePhone();
    await stubAddressSearch(page, "הרצל 2, תל אביב יפו, ישראל");
    await signInDirectly(page, phone, "בעלים עם תמונות");
    const name = `עסק מצולם ${Date.now()}`;

    await page.goto("/onboarding?plan=SOLO");
    await ready(page);

    await page.getByLabel("שם העסק").fill(name);
    await page.getByLabel("טלפון").fill(asTyped(phone));
    await pickAnAddress(page, "הרצל 2");
    await pickACategory(page);
    await page.getByRole("button", { name: "המשך" }).click();

    // The cover, and one of the three optional ones.
    await expect(page.getByText("תמונה ראשית")).toBeVisible();
    const files = page.locator('input[type="file"]');
    await files.nth(0).setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: A_PNG });
    await files.nth(1).setInputFiles({ name: "more.png", mimeType: "image/png", buffer: A_PNG });
    // Both are shown back before anything is uploaded.
    await expect(page.locator("main img")).toHaveCount(2);
    await page.getByRole("button", { name: "המשך" }).click();

    await page.getByLabel("שם היומן").fill("ראשי");
    await page.getByRole("button", { name: "המשך" }).click();
    await page.getByLabel("שם השירות").fill("ייעוץ");
    await page.getByRole("button", { name: "המשך" }).click();
    await page.getByRole("checkbox", { name: /קראתי ואני מסכים/ }).check();
    await page.getByRole("button", { name: "סיום" }).click();
    await expect(page.getByText("באוויר")).toBeVisible({ timeout: 20_000 });

    // The record says two photos, in slot order, with the cover first.
    const found = await call<{ id: string; name: string }[]>(
      `/businesses/search?q=${encodeURIComponent(name.slice(0, 8))}`,
    );
    const businessId = found.find((business) => business.name === name)?.id ?? "";
    expect(businessId).not.toBe("");
    const profile = await call<{ photos: { slot: number; url: string }[] }>(
      `/businesses/${businessId}`,
    );
    expect(profile.photos.map((photo) => photo.slot)).toEqual([0, 1]);

    // And a customer looking at the business sees them, cover large.
    await page.goto("/?screen=search");
    await ready(page);
    await page.getByPlaceholder("מספרה, קליניקה, מאמן אישי…").fill(name.slice(0, 8));
    await page.getByText(name).first().click();
    const gallery = page.getByRole("region", { name: "תמונות מהעסק" });
    await expect(gallery).toBeVisible({ timeout: 15_000 });
    await expect(gallery.getByRole("button", { name: /^הצגת תמונה/ })).toHaveCount(2);

    // The bytes really load, rather than the page holding two broken frames.
    const loaded = await gallery
      .locator("img")
      .first()
      .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0);
    expect(loaded).toBe(true);
  });
});

/**
 * Who else gets in, and how far (ADR 0016). One journey, because the whole
 * point of the feature is what the other person then sees.
 */
test.describe("the team", () => {
  test("a worker gets their calendars and nothing else", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `צוות ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });
    // The fixture opens with one calendar. A worker put on some of them only
    // means something where there are some to leave out.
    for (const name of ["יומן ב", "יומן ג"]) {
      await call(`/businesses/${shop.business.id}/resources`, {
        method: "POST",
        token: shop.owner.token,
        body: { name },
      });
    }

    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto("/manage");
    await ready(page);
    // The team lives inside the business panel rather than on the bottom bar.
    await page.getByRole("button", { name: "העסק" }).click();
    await page.getByRole("button", { name: "צוות" }).click();


    const worker = uniquePhone();
    // The list's own button, not the sheet's — both read "הוספה", which is the
    // right word in both places and the reason this needs saying.
    await page.getByRole("button", { name: "הוספה", exact: true }).first().click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("מספר הטלפון שלו").fill(asTyped(worker));
    await sheet.getByLabel("שם פרטי").fill("עובדת");
    await sheet.getByLabel("שם משפחה").fill("חדשה");
    await sheet.getByRole("button", { name: /עובד ביומן/ }).click();
    await sheet.getByRole("button", { name: "יומן ב" }).click();
    await sheet.getByRole("button", { name: "יומן ג" }).click();
    await sheet.getByRole("button", { name: "הוספה", exact: true }).click();

    // The row says the terms and the calendars, which is the whole of the answer.
    await expect(page.getByText("עובדת חדשה")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("יומן ב, יומן ג")).toBeVisible();

    // And now the other side of it, on the same phone number the invite named.
    await signInDirectly(page, worker, "עובדת חדשה");
    await page.goto("/manage");
    await ready(page);

    // Their calendars, and only theirs — now behind the toolbar's scope chip
    // rather than a row of chips of their own.
    await page.getByRole("button", { name: /^יומן:/ }).click();
    const calendars = page.getByRole("dialog");
    await expect(calendars.getByRole("button", { name: /יומן ב/ })).toBeVisible({
      timeout: 15_000,
    });
    await expect(calendars.getByRole("button", { name: /יומן ג/ })).toBeVisible();
    await expect(calendars.getByRole("button", { name: /יומן א/ })).toHaveCount(0);

    // The day and the schedule are theirs. The business, its customers and the
    // team are not, and a tab that is not offered cannot be reached by accident
    // — the team included, since it now sits inside the business panel.
    await expect(page.getByRole("button", { name: "היומן" })).toBeVisible();
    await expect(page.getByRole("button", { name: "לוח זמנים" })).toBeVisible();
    for (const tab of ["העסק", "לקוחות", "צוות"]) {
      await expect(page.getByRole("button", { name: tab })).toHaveCount(0);
    }
  });
});

/**
 * Closing the shop, which is the one calendar change that reaches other people.
 *
 * The screen used to write an override per calendar and stop there: the days
 * were shaded shut, every appointment inside them still stood, nobody was told,
 * and the owner could not see any of it. These follow the whole decision —
 * what the owner is warned about, what is called off, what the customer is
 * sent, what the calendar says afterwards, and the way back out.
 */
test.describe("closing the business", () => {
  const aCustomerWithABooking = async (
    shop: { business: { id: string }; service: { id: string }; resource: { id: string } },
    name: { givenName: string; familyName: string },
    startAt: string,
  ) => {
    const phone = uniquePhone();
    const { code } = await call<{ code: string }>("/auth/request-code", {
      method: "POST",
      body: { phone },
    });
    const { token } = await call<{ token: string }>("/auth/verify", {
      method: "POST",
      body: { phone, code, name },
    });
    const appointment = await call<{ id: string }>("/appointments", {
      method: "POST",
      token,
      body: {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: shop.resource.id,
        startAt,
        customerNote: null,
      },
    });
    return { phone, token, appointment };
  };

  const openTheCalendar = async (page: Page, shop: { business: { id: string } }, token: string) => {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });
  };

  /** A second calendar, so "the whole business" is a choice of its own. */
  const withASecondCalendar = async (shop: { business: { id: string }; owner: { token: string } }) =>
    call(`/businesses/${shop.business.id}/resources`, { method: "POST", token: shop.owner.token, body: { name: "כיסא שני" } });

  /** The + opens "שינוי ביומן", the grid asks which days, then the sheet: the whole business, closed all day. */
  const aimAtDays = async (page: Page, days: readonly string[]) => {
    await page.getByRole("button", { name: "הוספה ליום" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /שינוי ביומן/ }).click();
    for (const day of days) {
      await showTheMonthOf(page, day);
      await page.getByRole("button", { name: day }).click();
    }
    await page.getByRole("button", { name: "המשך" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("group", { name: "למי" }).getByRole("button", { name: "כל העסק" }).click();
    await sheet.getByRole("radio", { name: /^לא עובדים כל היום/ }).click();
    return sheet;
  };

  const slotsOn = async (
    shop: { business: { id: string }; service: { id: string }; resource: { id: string } },
    date: string,
  ) => {
    const days = await call<{ slots: unknown[] }[]>(
      `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
        `&resourceId=${shop.resource.id}&from=${date}&to=${date}`,
    );
    return (days[0]?.slots ?? []).length;
  };

  test("warns by name, calls the appointments off, and shuts the days", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `סגירה ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    await withASecondCalendar(shop);
    const [first, middle, last] = inOneMonth([2, 3, 4]);
    const onFirst = anInstantAt(first, "10:00");
    const { token: theirs, appointment } = await aCustomerWithABooking(
      shop,
      { givenName: "נועה", familyName: "שדה" },
      onFirst,
    );

    await openTheCalendar(page, shop, shop.owner.token);
    const sheet = await aimAtDays(page, [first, last]);
    // The warning names the person, because "1 appointment" is not the
    // decision the owner is being asked to make.
    await expect(sheet.getByText("נועה שדה")).toBeVisible({ timeout: 15_000 });
    await expect(sheet.getByText("תור אחד בימים האלה")).toBeVisible();

    await sheet.getByRole("button", { name: "סגירת העסק וביטול תור אחד" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // Every day of the range is shut for customers, not only the first.
    for (const date of [first, middle, last]) {
      await expect.poll(async () => slotsOn(shop, date), { timeout: 15_000 }).toBe(0);
    }

    // The appointment is called off, and the customer can see that it was.
    const mine = await call<{ id: string; status: string }[]>("/me/appointments", {
      token: theirs,
    });
    expect(mine.find((one) => one.id === appointment.id)?.status).toBe("CANCELLED");
  });

  test("shuts the days and keeps the appointments when the owner says so", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `שמירה ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    await withASecondCalendar(shop);
    const day = aDayFromNow(2);
    const { token: theirs, appointment } = await aCustomerWithABooking(
      shop,
      { givenName: "רון", familyName: "לוי" },
      `${day}T07:00:00.000Z`,
    );

    await openTheCalendar(page, shop, shop.owner.token);
    const sheet = await aimAtDays(page, [day]);
    await expect(sheet.getByText("רון לוי")).toBeVisible({ timeout: 15_000 });
    await sheet.getByRole("radio", { name: "להשאיר אותו, אדבר איתו בעצמי" }).click();
    await sheet.getByRole("button", { name: "סגירת העסק ליום הזה" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    await expect.poll(async () => slotsOn(shop, day), { timeout: 15_000 }).toBe(0);
    const mine = await call<{ id: string; status: string }[]>("/me/appointments", {
      token: theirs,
    });
    // Both answers are real: the owner who means to ring round keeps them.
    expect(mine.find((one) => one.id === appointment.id)?.status).toBe("CONFIRMED");
  });

  test("draws the shut days as one band, and gives them back again", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `רצועה ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    await withASecondCalendar(shop);
    const [first, last] = inOneMonth([2, 4]);

    await openTheCalendar(page, shop, shop.owner.token);
    const sheet = await aimAtDays(page, [first, last]);
    await expect(sheet.getByText("אין תורים בימים האלה.")).toBeVisible({ timeout: 15_000 });
    await sheet.getByLabel("הערה (לא חובה)").fill("חופשה");
    await sheet.getByRole("button", { name: "סגירת העסק לימים האלה" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // One band across the three days rather than three squares each saying so.
    // It says what it is; the words the owner typed are in the sheet.
    const band = page.getByRole("button", { name: "סגור", exact: true });
    await expect(band.first()).toBeVisible({ timeout: 15_000 });

    await band.first().click();
    const closure = page.getByRole("dialog");
    await expect(closure.getByRole("heading", { name: "חופשה" })).toBeVisible();
    await expect(closure.locator(".change-sentence")).toContainText("העסק סגור");
    await closure.getByRole("button", { name: "מחיקה · 3 הימים חוזרים לשעות הרגילות" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // The days are bookable again — and the band is gone with them.
    await expect.poll(async () => slotsOn(shop, first), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: "סגור", exact: true })).toHaveCount(0);
  });

  test("is not offered to a worker, who may still change their own calendar", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `הרשאות ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    await withASecondCalendar(shop);
    const worker = uniquePhone();
    await call(`/businesses/${shop.business.id}/users`, {
      method: "POST",
      token: shop.owner.token,
      body: {
        phone: worker,
        givenName: "עובדת",
        familyName: null,
        role: "WORKER",
        resourceIds: [shop.resource.id],
      },
    });

    await signInDirectly(page, worker, "עובדת");
    await page.goto("/manage");
    await ready(page);
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "הוספה ליום" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /שינוי ביומן/ }).click();
    const day = aDayFromNow(2);
    await showTheMonthOf(page, day);
    await page.getByRole("button", { name: day }).click();
    await page.getByRole("button", { name: "המשך" }).click();
    const sheet = page.getByRole("dialog");
    // Their own time is theirs to keep; the shop's days are not theirs to say.
    await expect(sheet.getByText("ביומן א", { exact: true })).toBeVisible();
    await expect(sheet.getByText("כל העסק")).toHaveCount(0);
  });

  test("refuses a worker at the API, not only in the interface", async () => {
    const shop = await aBusinessWithOpenHours({
      name: `שרת ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    const phone = uniquePhone();
    await call(`/businesses/${shop.business.id}/users`, {
      method: "POST",
      token: shop.owner.token,
      body: {
        phone,
        givenName: "עובדת",
        familyName: null,
        role: "WORKER",
        resourceIds: [shop.resource.id],
      },
    });
    const { code } = await call<{ code: string }>("/auth/request-code", {
      method: "POST",
      body: { phone },
    });
    const { token } = await call<{ token: string }>("/auth/verify", {
      method: "POST",
      body: { phone, code, name: { givenName: "עובדת", familyName: null } },
    });

    // A hidden button is a courtesy; this is the rule — on the old route and the new one.
    await expect(
      call(`/businesses/${shop.business.id}/changes`, {
        method: "POST",
        token,
        body: { scope: { kind: "BUSINESS" }, fromDate: aDayFromNow(2), toDate: aDayFromNow(2), outcome: "OFF_ALL_DAY", ranges: [], upcoming: "KEEP" },
      }),
    ).rejects.toThrow(/403/);
    await expect(
      call(`/businesses/${shop.business.id}/closures`, {
        method: "POST",
        token,
        body: {
          fromDate: aDayFromNow(2),
          toDate: aDayFromNow(2),
          note: null,
          ranges: [],
          upcoming: "KEEP",
        },
      }),
    ).rejects.toThrow(/403/);
  });
});

test.describe("reading a day at a glance", () => {
  test("draws every appointment in a colour, not only the first", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `צבעים ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    // A second service, because the bug only showed once a day held two: the
    // colour was the service's position in that day's list, and every hue past
    // the first named a variable the stylesheet never defined.
    await call(`/businesses/${shop.business.id}/services`, {
      method: "POST",
      token: shop.owner.token,
      body: { name: "צבע לשיער", durationMinutes: 30, priceMinor: 20000, bufferMinutes: null },
    });
    const services = await call<{ services: { id: string; name: string }[] }>(
      `/businesses/${shop.business.id}`,
    );
    const dye = services.services.find((one) => one.name === "צבע לשיער");
    expect(dye).toBeTruthy();

    const day = aDayFromNow(2);
    for (const [at, serviceId] of [
      ["07:00", shop.service.id],
      ["08:00", dye?.id ?? ""],
      ["09:00", shop.service.id],
    ] as const) {
      const phone = uniquePhone();
      const { code } = await call<{ code: string }>("/auth/request-code", {
        method: "POST",
        body: { phone },
      });
      const { token } = await call<{ token: string }>("/auth/verify", {
        method: "POST",
        body: { phone, code, name: { givenName: `דגם${at.slice(0, 2)}`, familyName: "צבעוני" } },
      });
      await call("/appointments", {
        method: "POST",
        token,
        body: {
          businessId: shop.business.id,
          serviceId,
          resourceId: shop.resource.id,
          startAt: `${day}T${at}:00.000Z`,
          customerNote: null,
        },
      });
    }

    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await openTheDayOf(page, day);

    const drawn = page.getByRole("button", { name: /דגם\d\d/ });
    await expect(drawn).toHaveCount(3, { timeout: 15_000 });

    // Every one of them has a ground and a rail. "Blank" was literally
    // transparent: an undefined custom property drops the whole declaration.
    const painted = await drawn.evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = window.getComputedStyle(node);
        return {
          background: style.backgroundColor,
          rail: style.borderInlineStartColor,
          width: style.borderInlineStartWidth,
        };
      }),
    );
    expect(painted).toHaveLength(3);
    painted.forEach((one) => {
      expect(one.background).not.toBe("rgba(0, 0, 0, 0)");
      expect(one.rail).not.toBe("rgba(0, 0, 0, 0)");
      expect(one.width).toBe("5px");
    });

    // The same service keeps one colour; a different one is told apart.
    expect(painted[0]?.background).toBe(painted[2]?.background);
    expect(painted[1]?.background).not.toBe(painted[0]?.background);
  });

  test("keeps the + out of the way of any sheet, its own and one it knows nothing about", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `כפתור ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    const [day] = inOneMonth([2]);
    await call(`/businesses/${shop.business.id}/resources/${shop.resource.id}/blocks`, {
      method: "POST",
      token: shop.owner.token,
      body: { blocks: [{ startAt: anInstantAt(day, "10:00"), endAt: anInstantAt(day, "11:00"), reason: "ספק" }] },
    });
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);

    const plus = page.getByRole("button", { name: "הוספה ליום" });
    await expect(plus).toBeVisible({ timeout: 15_000 });

    // Its own sheet: the + does not sit on the menu it opened.
    await plus.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(plus).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(plus).toBeVisible();

    // A sheet the + was never told about — a blockage opened from the day. The
    // filter's sheet is one more of these, when its button comes back.
    await openTheDayOf(page, day);
    await page.getByRole("button", { name: /\d\d:\d\d ספק/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(plus).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(plus).toBeVisible({ timeout: 15_000 });
  });

  test("takes a removed blockage off the open day without being reopened", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `רענון ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    const [first, last] = inOneMonth([2, 3]);
    await call(`/businesses/${shop.business.id}/resources/${shop.resource.id}/blocks`, {
      method: "POST",
      token: shop.owner.token,
      body: {
        blocks: [first, last].map((date) => ({
          startAt: `${date}T06:00:00.000Z`,
          endAt: `${date}T12:00:00.000Z`,
          reason: "השתלמות",
        })),
      },
    });

    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);

    // Read the day first: it is the day being looked at that used to go stale.
    await openTheDayOf(page, first);
    await expect(page.getByRole("button", { name: /השתלמות/ }).first()).toBeVisible({
      timeout: 15_000,
    });

    // The band in the month, which is where a change spanning days is undone.
    await page.getByRole("button", { name: "חלק מהיום", exact: true }).first().click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "מחיקה · 2 הימים חוזרים לשעות הרגילות" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // The day below the month is another read of the same thing, and it used
    // to keep drawing the blockage until the screen was opened again.
    await expect(page.getByRole("button", { name: /השתלמות/ })).toHaveCount(0, {
      timeout: 15_000,
    });
  });
});

/**
 * A blockage is the smaller of the two ways to take hours away, and it was the
 * silent one: it went in on top of whatever was booked, and nobody was told.
 */
test.describe("blocking time out", () => {
  const bookOn = async (
    shop: { business: { id: string }; service: { id: string }; resource: { id: string } },
    name: { givenName: string; familyName: string },
    startAt: string,
  ) => {
    const phone = uniquePhone();
    const { code } = await call<{ code: string }>("/auth/request-code", {
      method: "POST",
      body: { phone },
    });
    const { token } = await call<{ token: string }>("/auth/verify", {
      method: "POST",
      body: { phone, code, name },
    });
    const appointment = await call<{ id: string }>("/appointments", {
      method: "POST",
      token,
      body: {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: shop.resource.id,
        startAt,
        customerNote: null,
      },
    });
    return { token, appointment };
  };

  /** "שינוי ביומן" from the +, aimed at days, as a whole day off for the calendar on screen. */
  const aimAt = async (page: Page, days: readonly string[]) => {
    await page.getByRole("button", { name: "הוספה ליום" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /שינוי ביומן/ }).click();
    for (const day of days) {
      await showTheMonthOf(page, day);
      await page.getByRole("button", { name: day }).click();
    }
    await page.getByRole("button", { name: "המשך" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("radio", { name: /^לא עובדים כל היום/ }).click();
    return sheet;
  };

  test("names what it would sit on top of, and can call it off", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `חסימה ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    const day = aDayFromNow(2);
    const { token: theirs, appointment } = await bookOn(
      shop,
      { givenName: "מיכל", familyName: "אבן" },
      `${day}T07:00:00.000Z`,
    );

    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });

    const sheet = await aimAt(page, [day]);
    // The same warning the shop closing gives, because it costs the same thing.
    await expect(sheet.getByText("מיכל אבן")).toBeVisible({ timeout: 15_000 });
    await sheet.getByRole("button", { name: "שמירה וביטול תור אחד" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    const mine = await call<{ id: string; status: string }[]>("/me/appointments", {
      token: theirs,
    });
    expect(mine.find((one) => one.id === appointment.id)?.status).toBe("CANCELLED");
  });

  test("can block the day and leave the appointments standing", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `חסימה שומרת ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    const day = aDayFromNow(2);
    const { token: theirs, appointment } = await bookOn(
      shop,
      { givenName: "אורי", familyName: "גל" },
      `${day}T07:00:00.000Z`,
    );

    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });

    const sheet = await aimAt(page, [day]);
    await expect(sheet.getByText("אורי גל")).toBeVisible({ timeout: 15_000 });
    await sheet.getByRole("radio", { name: "להשאיר אותו, אדבר איתו בעצמי" }).click();
    await sheet.getByRole("button", { name: "שמירת השינוי" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    const mine = await call<{ id: string; status: string }[]>("/me/appointments", {
      token: theirs,
    });
    expect(mine.find((one) => one.id === appointment.id)?.status).toBe("CONFIRMED");
  });

  test("can be walked away from without writing anything", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `יציאה ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    const day = aDayFromNow(2);

    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });

    const sheet = await aimAt(page, [day]);
    await expect(sheet).toBeVisible();

    // A sheet whose only exits are "do it" and a tap on the backdrop is one
    // people learn to distrust.
    await sheet.getByRole("button", { name: "ביטול", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // Nothing was written, and the + is back rather than the grid still
    // waiting for days.
    const days = await call<{ slots: unknown[] }[]>(
      `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
        `&resourceId=${shop.resource.id}&from=${day}&to=${day}`,
    );
    expect((days[0]?.slots ?? []).length).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: "הוספה ליום" })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("says whose calendar a blockage belongs to", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `שם היומן ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    // A second chair, which is what makes "away" an insufficient answer.
    await call(`/businesses/${shop.business.id}/resources`, {
      method: "POST",
      token: shop.owner.token,
      body: { name: "יומן ב" },
    });

    // Three days, which is room enough for the band to say both whose it is
    // and why. A narrower one keeps the reason and leaves whose to its colour —
    // so the three sit in one week row, or a Sunday among them splits the band.
    const start = aRunInOneWeek(3, 2);
    const days = [aDayFromNow(start), aDayFromNow(start + 1), aDayFromNow(start + 2)] as const;
    await call(`/businesses/${shop.business.id}/resources/${shop.resource.id}/blocks`, {
      method: "POST",
      token: shop.owner.token,
      body: {
        blocks: days.map((date) => ({
          startAt: `${date}T06:00:00.000Z`,
          endAt: `${date}T12:00:00.000Z`,
          reason: "מילואים",
        })),
        upcoming: "KEEP",
      },
    });

    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);

    await showTheMonthOf(page, days[0]);
    // The band says what it is and whose it is — short enough to be taken in
    // at a glance, with the reason in the sheet behind it.
    const band = page.getByRole("button", { name: "חלק מהיום (יומן א)" });
    await expect(band.first()).toBeVisible({ timeout: 15_000 });

    await band.first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.locator(".change-scope").first()).toHaveText("יומן א");
    await expect(sheet.getByRole("heading", { name: "מילואים" })).toBeVisible();
  });
});

/**
 * The shop's own days, read and undone from the calendar rather than only from
 * the schedule screen — and removed as the one decision they were.
 */
test.describe("a day the shop keeps its own hours", () => {
  const openCalendar = async (page: Page, shop: { business: { id: string } }, token: string) => {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });
  };

  const shortenTheDay = async (
    shop: { business: { id: string }; owner: { token: string } },
    date: string,
    note: string | null,
  ) =>
    call(`/businesses/${shop.business.id}/closures`, {
      method: "POST",
      token: shop.owner.token,
      body: {
        fromDate: date,
        toDate: date,
        note,
        ranges: [{ start: "09:00", end: "12:00" }],
        upcoming: "KEEP",
      },
    });

  test("shows a shortened day on the calendar, and gives it back from there", async ({
    page,
  }) => {
    const shop = await aBusinessWithOpenHours({
      name: `יום קצר ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    const day = aDayFromNow(2);
    await shortenTheDay(shop, day, "ערב חג");
    const afternoon = async () => {
      const days = await call<{ slots: { startAt: string }[] }[]>(
        `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
          `&resourceId=${shop.resource.id}&from=${day}&to=${day}`,
      );
      return (days[0]?.slots ?? []).filter((slot) => localClockOf(slot.startAt) >= "12:00").length;
    };
    // Shortened to the morning: nothing from noon on.
    expect(await afternoon()).toBe(0);

    await openCalendar(page, shop, shop.owner.token);
    await showTheMonthOf(page, day);

    // It used to be a slightly paler square and nothing else: no band, nothing
    // to tap, and the only way to find it was the schedule screen.
    const band = page.getByRole("button", { name: "שעות אחרות", exact: true });
    await expect(band.first()).toBeVisible({ timeout: 15_000 });

    await band.first().click();
    const sheet = page.getByRole("dialog");
    // The hours are in the sheet, which is where there is room for them.
    await expect(sheet.locator(".change-sentence")).toContainText("09:00–12:00");
    await expect(sheet.getByRole("heading", { name: "ערב חג" })).toBeVisible();
    await sheet.getByRole("button", { name: "מחיקה · היום חוזר לשעות הרגילות" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // Back on its usual hours: the afternoon is bookable again.
    await expect.poll(afternoon, { timeout: 15_000 }).toBeGreaterThan(0);
  });

  test("draws a band on a single day, not only on a run of them", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `יום אחד ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    const day = aDayFromNow(2);
    await call(`/businesses/${shop.business.id}/closures`, {
      method: "POST",
      token: shop.owner.token,
      body: { fromDate: day, toDate: day, note: null, ranges: [], upcoming: "KEEP" },
    });

    await openCalendar(page, shop, shop.owner.token);
    await showTheMonthOf(page, day);
    await expect(page.getByRole("button", { name: "סגור", exact: true })).toHaveCount(1, {
      timeout: 15_000,
    });
  });

  test("removes the shop's day from the schedule screen as the shop's", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `ניהול ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    // A second chair is what made this wrong: deleting one calendar's copy left
    // the other shut, invisibly to the calendar.
    await call(`/businesses/${shop.business.id}/resources`, {
      method: "POST",
      token: shop.owner.token,
      body: { name: "יומן ב" },
    });
    const day = aDayFromNow(2);
    await shortenTheDay(shop, day, null);

    await openCalendar(page, shop, shop.owner.token);
    await page.getByRole("button", { name: "לוח זמנים" }).click();
    await page.getByRole("tab", { name: "שינויים" }).click();

    // A calendar's list does not carry the shop's day; the business's does.
    await expect(page.getByText("אין שינויים קרובים")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("group", { name: "של מי השינויים" }).getByRole("button", { name: "כל העסק" }).click();
    await page.getByRole("list", { name: "השינויים" }).getByRole("button").first().click();
    await page.getByRole("dialog").getByRole("button", { name: "מחיקה · היום חוזר לשעות הרגילות" }).click();

    // Gone for every calendar, in one go — and gone from this list with it.
    await expect(page.getByText("אין שינויים קרובים")).toBeVisible({ timeout: 15_000 });
    const resources = await call<{ id: string }[]>(
      `/businesses/${shop.business.id}/resources`,
      { token: shop.owner.token },
    );
    for (const resource of resources) {
      const left = await call<unknown[]>(
        `/businesses/${shop.business.id}/resources/${resource.id}/overrides?from=${day}&to=${day}`,
        { token: shop.owner.token },
      );
      expect(left).toHaveLength(0);
    }
  });

  test("names the calendar of each appointment a closure would call off", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `יומנים ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    // Two calendars, which is when "whose chair" is worth saying.
    await call(`/businesses/${shop.business.id}/resources`, {
      method: "POST",
      token: shop.owner.token,
      body: { name: "יומן ב" },
    });
    const day = aDayFromNow(2);
    const phone = uniquePhone();
    const { code } = await call<{ code: string }>("/auth/request-code", {
      method: "POST",
      body: { phone },
    });
    const { token } = await call<{ token: string }>("/auth/verify", {
      method: "POST",
      body: { phone, code, name: { givenName: "שירה", familyName: "כהן" } },
    });
    await call("/appointments", {
      method: "POST",
      token,
      body: {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: shop.resource.id,
        startAt: `${day}T07:00:00.000Z`,
        customerNote: null,
      },
    });

    await openCalendar(page, shop, shop.owner.token);
    await page.getByRole("button", { name: "הוספה ליום" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /שינוי ביומן/ }).click();
    await openTheDayOf(page, day);
    await page.getByRole("button", { name: "המשך" }).click();

    // Whose chair it is, because closing touches every calendar and a list of
    // names says nothing about which of them loses their afternoon.
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("group", { name: "למי" }).getByRole("button", { name: "כל העסק" }).click();
    await sheet.getByRole("radio", { name: /^לא עובדים כל היום/ }).click();
    await expect(sheet.getByText("שירה כהן")).toBeVisible({ timeout: 15_000 });
    await expect(sheet.getByText(new RegExp(`· ${shop.resource.name}`))).toBeVisible();
  });
});

/**
 * Four consecutive days inside one week of the grid, and one month of it.
 *
 * The month draws a week to a row, Sunday first, so a run beginning on a
 * Sunday is the only one guaranteed not to be split by the grid itself — and
 * one inside a single month is the only one on a single grid.
 */
const fourDaysFromTheNextSunday = (): string[] => {
  for (let ahead = 2; ahead < 45; ahead += 1) {
    const date = aDayFromNow(ahead);
    const run = [0, 1, 2, 3].map((on) => aDayFromNow(ahead + on));
    if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0 && run.every((day) => day.slice(0, 7) === date.slice(0, 7))) {
      return run;
    }
  }
  throw new Error("No Sunday within six weeks starting four days of one month, which cannot happen");
};

/**
 * A busy month still has to read as a month.
 *
 * Every decision used to take a bar of its own, laid over the squares — so a
 * week with several of them buried the days it was describing.
 */
test.describe("a month with a lot decided about it", () => {
  const blockOn = async (
    shop: { business: { id: string }; owner: { token: string } },
    resourceId: string,
    date: string,
    reason: string,
  ) =>
    call(`/businesses/${shop.business.id}/resources/${resourceId}/blocks`, {
      method: "POST",
      token: shop.owner.token,
      body: {
        blocks: [
          { startAt: `${date}T06:00:00.000Z`, endAt: `${date}T12:00:00.000Z`, reason },
        ],
        upcoming: "KEEP",
      },
    });

  const openMonth = async (page: Page, shop: { business: { id: string }; owner: { token: string } }) => {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });
  };

  test("shares one line between days that are nowhere near each other", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `עמוס ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });

    // Two days with a gap between them: separate runs, so two bars — and one
    // line, because a bar on Monday does not overlap one on Thursday.
    const days = inOneMonth([2, 5]);
    await blockOn(shop, shop.resource.id, days[0], "רופא");
    await blockOn(shop, shop.resource.id, days[1], "ספק");

    await openMonth(page, shop);
    await showTheMonthOf(page, days[0]);

    for (const date of days) {
      await expect(page.getByRole("button", { name: date })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "חלק מהיום", exact: true })).toHaveCount(2, {
      timeout: 15_000,
    });
    // One line holds both, so nothing had to fold.
    await expect(page.getByRole("button", { name: /עוד \d+ בשבוע/ })).toHaveCount(0);

    // And both are still openable, because nothing is buried.
    await page.getByRole("button", { name: "חלק מהיום", exact: true }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("joins a run of days one calendar is away into a single bar", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `רצף ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });

    // Four consecutive days, decided one at a time. To a reader that is one
    // fact — this chair is away — and four bars would say it four times.
    //
    // Starting on a Sunday, so the run sits inside one row of the grid. A band
    // that crosses a week boundary is drawn as one bar per row, correctly, and
    // taking whatever four days followed today meant this test passed or
    // failed depending on the day it was run — which it did, silently, until a
    // run straddled a Saturday.
    const days = fourDaysFromTheNextSunday();
    for (const [at, date] of days.entries()) {
      await blockOn(shop, shop.resource.id, date, `סיבה ${at}`);
    }

    await openMonth(page, shop);
    await showTheMonthOf(page, days[0]!);

    const bar = page.getByRole("button", { name: "חלק מהיום", exact: true });
    await expect(bar).toBeVisible({ timeout: 15_000 });
    // It stands in for four decisions, so it opens the list of them.
    await bar.click();
    await expect(page.getByRole("dialog").getByText("מה יש בשבוע הזה")).toBeVisible();
    await expect(page.getByRole("dialog").getByText(/^סיבה \d$/)).toHaveCount(4);
  });

  test("folds a week it cannot carry into a list that opens each one", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `גדוש ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    // Three chairs, each away on the same day. Three separate facts, which
    // cannot share a line and cannot be merged into one another.
    const chairs = [shop.resource.id];
    for (const name of ["יומן ב", "יומן ג"]) {
      const made = await call<{ id: string }>(`/businesses/${shop.business.id}/resources`, {
        method: "POST",
        token: shop.owner.token,
        body: { name },
      });
      chairs.push(made.id);
    }
    const date = aDayFromNow(2);
    for (const [at, resourceId] of chairs.entries()) {
      await blockOn(shop, resourceId, date, `חפיפה ${at}`);
    }

    await openMonth(page, shop);
    await showEveryCalendar(page);
    await showTheMonthOf(page, date);

    // Two lines are drawn and the rest counted, rather than a third bar
    // growing over the days.
    const more = page.getByRole("button", { name: /עוד \d+ בשבוע/ });
    await expect(more).toBeVisible({ timeout: 15_000 });

    await more.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("מה יש בשבוע הזה")).toBeVisible();
    // Everything that week, not only what was folded away: the list is the
    // answer to "what is going on here", which is why it was opened.
    await expect(sheet.getByText(/^חפיפה \d$/)).toHaveCount(3);

    // The list has room for the words the owner typed, which the bar did not.
    await sheet.getByText("חפיפה 0").click();
    await expect(page.getByRole("dialog").getByText("חפיפה 0")).toBeVisible();
  });
});

/**
 * A band has to land on the days it is about.
 *
 * Geometry nobody can check by looking: a bar drawn one column out reads as
 * perfectly plausible, and a bar mirrored end-for-end reads as plausible too
 * unless the span it covers is asymmetric within its week.
 */
test.describe("where a band is drawn", () => {
  test("covers exactly the days it is about, and never the dates themselves", async ({
    page,
  }) => {
    const shop = await aBusinessWithOpenHours({
      name: `גאומטריה ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });

    // The first two days of a week. A span in the middle of a row is symmetric
    // enough to hide a mirrored layout; this one is not.
    let from = "";
    let to = "";
    for (let ahead = 1; ahead < 45; ahead += 1) {
      const date = aDayFromNow(ahead);
      const next = aDayFromNow(ahead + 1);
      if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0 && next.slice(0, 7) === date.slice(0, 7)) {
        from = date;
        to = next;
        break;
      }
    }
    expect(from).not.toBe("");

    await call(`/businesses/${shop.business.id}/closures`, {
      method: "POST",
      token: shop.owner.token,
      body: { fromDate: from, toDate: to, note: "סוף שבוע", ranges: [], upcoming: "KEEP" },
    });

    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await showTheMonthOf(page, from);

    const band = await page.getByRole("button", { name: "סגור", exact: true }).first().boundingBox();
    const first = await page.getByRole("button", { name: from }).boundingBox();
    const second = await page.getByRole("button", { name: to }).boundingBox();
    expect(band).not.toBeNull();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    const left = Math.min(first!.x, second!.x);
    const right = Math.max(first!.x + first!.width, second!.x + second!.width);
    // Within the gap between two squares: the band is laid out in fractions of
    // the row while the squares have gaps between them.
    expect(Math.abs(band!.x - left)).toBeLessThan(6);
    expect(Math.abs(band!.x + band!.width - right)).toBeLessThan(6);

    // And it sits below the date, not over it: every square reserves the strip
    // the bands live in, which is also why a week never changes height.
    expect(band!.y).toBeGreaterThan(first!.y + first!.height / 2);
    expect(band!.y + band!.height).toBeLessThanOrEqual(first!.y + first!.height + 1);
  });

  test("keeps every week the same height, with or without anything on it", async ({
    page,
  }) => {
    const shop = await aBusinessWithOpenHours({
      name: `גובה ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    // A day in one week, and one a week later in the same month.
    const [busy, quietDay] = inOneMonth([2, 9]);
    await call(`/businesses/${shop.business.id}/resources/${shop.resource.id}/blocks`, {
      method: "POST",
      token: shop.owner.token,
      body: {
        blocks: [
          { startAt: `${busy}T06:00:00.000Z`, endAt: `${busy}T12:00:00.000Z`, reason: "חסום" },
        ],
        upcoming: "KEEP",
      },
    });

    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await showTheMonthOf(page, busy);

    // A day in the week that has a blockage, and one in a week that has none.
    const withBand = await page.getByRole("button", { name: busy }).boundingBox();
    const quiet = await page.getByRole("button", { name: quietDay }).boundingBox();
    expect(withBand!.height).toBe(quiet!.height);
  });
});

/**
 * What the month draws, and what it deliberately does not.
 *
 * Appointments are the dots on a square: how busy a day is, per calendar. They
 * are never bars — a month is for finding the day, and the day screen is for
 * reading it. Bars are for the decisions that span days, and one calendar gets
 * one bar per run of them however many were made.
 */
test.describe("what the month draws", () => {
  test("keeps one blockage per calendar, and draws one band for it", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `ערימה ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    const second = await call<{ id: string }>(`/businesses/${shop.business.id}/resources`, {
      method: "POST",
      token: shop.owner.token,
      body: { name: "שימי" },
    });

    // Five all-day blockages on one day across two chairs, made one at a time —
    // the shape that turned a single square into a wall of bars, and left five
    // rows where removing any one of them gave back nothing.
    const day = aDayFromNow(2);
    for (const resourceId of [
      shop.resource.id,
      second.id,
      shop.resource.id,
      second.id,
      shop.resource.id,
    ]) {
      await call(`/businesses/${shop.business.id}/resources/${resourceId}/blocks`, {
        method: "POST",
        token: shop.owner.token,
        body: {
          blocks: [
            { startAt: `${day}T00:00:00.000Z`, endAt: `${day}T20:59:00.000Z`, reason: "" },
          ],
          upcoming: "KEEP",
        },
      });
    }

    // Each chair keeps one blockage, not three and two lying on top of
    // each other: a later one absorbs what it covers.
    for (const [resourceId, name] of [
      [shop.resource.id, "יומן א"],
      [second.id, "שימי"],
    ] as const) {
      const day_ = await call<{ blocks: unknown[] }>(
        `/businesses/${shop.business.id}/resources/${resourceId}/calendar?date=${day}`,
        { token: shop.owner.token },
      );
      expect(day_.blocks, name).toHaveLength(1);
    }

    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });
    await showEveryCalendar(page);
    await showTheMonthOf(page, day);

    // Two bars, one per chair — not five, and nothing folded away.
    const bands = page.getByRole("button", { name: "חלק מהיום", exact: true });
    await expect(bands).toHaveCount(2, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: /עוד \d+ בשבוע/ })).toHaveCount(0);

    // And each one opens the change it stands for, because there is one.
    await bands.first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("button", { name: "מחיקה · היום חוזר לשעות הרגילות" })).toBeVisible();
  });

  test("draws appointments as dots on the day, never as a band", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `נקודות ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    const day = aDayFromNow(2);
    for (const at of ["07:00", "08:00", "09:00"]) {
      const phone = uniquePhone();
      const { code } = await call<{ code: string }>("/auth/request-code", {
        method: "POST",
        body: { phone },
      });
      const { token } = await call<{ token: string }>("/auth/verify", {
        method: "POST",
        body: { phone, code, name: { givenName: "לקוחה", familyName: "בדיקה" } },
      });
      await call("/appointments", {
        method: "POST",
        token,
        body: {
          businessId: shop.business.id,
          serviceId: shop.service.id,
          resourceId: shop.resource.id,
          startAt: `${day}T${at}:00.000Z`,
          customerNote: null,
        },
      });
    }

    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });

    // Three appointments, and the month says so with the square's own mark —
    // there is no bar for any of them, and the day is still a day.
    await showTheMonthOf(page, day);
    const square = page.getByRole("button", { name: day });
    await expect(square).toBeVisible({ timeout: 15_000 });
    await expect(square.locator("i")).toHaveCount(1);
    // The mark is that calendar's own colour, not a shade of "busy": a row of
    // them says who is busy, not only how busy the day is.
    const filled = await square.locator("i").evaluate(
      (node) => window.getComputedStyle(node).backgroundColor,
    );
    expect(filled).not.toBe("rgba(0, 0, 0, 0)");
    await expect(page.getByRole("button", { name: /^(סגור|חלק מהיום|שעות אחרות)( \(|$)/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "לקוחה בדיקה" })).toHaveCount(0);

    // The day itself is where they are read.
    await square.click();
    await expect(page.getByRole("button", { name: /לקוחה בדיקה/ }).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe("telling one thing from another on a day", () => {
  test("gives each of the business's services a colour of its own", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `צבעים ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "18:00" },
    });
    for (const name of ["צבע לשיער", "פן", "החלקה"]) {
      await call(`/businesses/${shop.business.id}/services`, {
        method: "POST",
        token: shop.owner.token,
        body: { name, durationMinutes: 45, priceMinor: 20000, bufferMinutes: null },
      });
    }
    const profile = await call<{ services: { id: string; name: string }[] }>(
      `/businesses/${shop.business.id}`,
    );

    // Real slots, since services of different lengths put the grid somewhere
    // no fixed list of times would land.
    const day = aDayFromNow(2);
    const taken: string[] = [];
    for (let at = 0; at < 4; at += 1) {
      const service = profile.services[at]!;
      const [offered] = await call<{ slots: { startAt: string }[] }[]>(
        `/businesses/${shop.business.id}/availability?serviceId=${service.id}` +
          `&resourceId=${shop.resource.id}&from=${day}&to=${day}`,
      );
      const slot = (offered?.slots ?? []).find((one) => !taken.includes(one.startAt));
      if (slot === undefined) continue;
      taken.push(slot.startAt);

      const phone = uniquePhone();
      const { code } = await call<{ code: string }>("/auth/request-code", {
        method: "POST",
        body: { phone },
      });
      const { token } = await call<{ token: string }>("/auth/verify", {
        method: "POST",
        body: { phone, code, name: { givenName: `דגם${at}`, familyName: "צבעוני" } },
      });
      await call("/appointments", {
        method: "POST",
        token,
        body: {
          businessId: shop.business.id,
          serviceId: service.id,
          resourceId: shop.resource.id,
          startAt: slot.startAt,
          customerNote: null,
        },
      });
    }

    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await openTheDayOf(page, day);

    const drawn = page.getByRole("button", { name: /דגם\d/ });
    await expect(drawn).toHaveCount(4, { timeout: 15_000 });

    const painted = await drawn.evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = window.getComputedStyle(node);
        return { ground: style.backgroundColor, rail: style.borderInlineStartColor };
      }),
    );

    // Four services, four colours — no two alike. A hash of the name was the
    // first answer and it put צבע לשיער and פן on the same blue, which is two
    // appointments a glance cannot tell apart.
    expect(new Set(painted.map((one) => one.ground)).size).toBe(4);
    expect(new Set(painted.map((one) => one.rail)).size).toBe(4);
  });

  test("keeps the search out of the calendar's way until it is wanted", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `מקום ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });

    // A button, not a field: the calendar is what the screen is for.
    await expect(page.getByLabel("חיפוש תור לפי שם או טלפון")).toHaveCount(0);
    const withoutIt = (await page.getByRole("grid").boundingBox())!;

    await page.getByRole("button", { name: "חיפוש" }).click();
    await expect(page.getByLabel("חיפוש תור לפי שם או טלפון")).toBeVisible();
    // It takes the row it needs while it is open, and no more than that.
    const withIt = (await page.getByRole("grid").boundingBox())!;
    expect(Math.abs(withIt.y - withoutIt.y)).toBeLessThan(8);

    await page.getByRole("button", { name: "סגירת החיפוש" }).click();
    await expect(page.getByLabel("חיפוש תור לפי שם או טלפון")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "חיפוש" })).toBeVisible();
  });
});

/**
 * The words on a decision, changed after the fact.
 *
 * The days and hours of a blockage can be undone by removing it and saying it
 * again. A typo in what it is called could only be lived with.
 */
test.describe("what a decision is called", () => {
  const openCalendar = async (page: Page, shop: { business: { id: string } }, token: string) => {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });
  };

  test("a blockage can be renamed, and all its days change together", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `שם ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    const days = inOneMonth([2, 3]);
    await call(`/businesses/${shop.business.id}/resources/${shop.resource.id}/blocks`, {
      method: "POST",
      token: shop.owner.token,
      body: {
        blocks: days.map((date) => ({
          startAt: `${date}T06:00:00.000Z`,
          endAt: `${date}T12:00:00.000Z`,
          reason: "רופה",
        })),
        upcoming: "KEEP",
      },
    });

    await openCalendar(page, shop, shop.owner.token);
    await showTheMonthOf(page, days[0]);
    await page.getByRole("button", { name: "חלק מהיום", exact: true }).first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "רופה" })).toBeVisible();

    // Its words are edited in the same sheet it was made in, and saved as one change.
    await sheet.getByRole("button", { name: "עריכה" }).click();
    await sheet.getByLabel("הערה (לא חובה)").fill("רופא שיניים");
    await sheet.getByRole("button", { name: "שמירת השינוי" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // Both days, because the words belong to the decision rather than to each
    // of its days.
    for (const date of days) {
      const read = await call<{ blocks: { reason: string }[] }>(
        `/businesses/${shop.business.id}/resources/${shop.resource.id}/calendar?date=${date}`,
        { token: shop.owner.token },
      );
      expect(read.blocks.map((one) => one.reason)).toEqual(["רופא שיניים"]);
    }
  });

  test("a closure can be renamed without giving the days back", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `סגירה ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    const [first, last] = inOneMonth([2, 3]);
    await call(`/businesses/${shop.business.id}/closures`, {
      method: "POST",
      token: shop.owner.token,
      body: { fromDate: first, toDate: last, note: "חופשה", ranges: [], upcoming: "KEEP" },
    });

    await openCalendar(page, shop, shop.owner.token);
    await showTheMonthOf(page, first);
    await page.getByRole("button", { name: "סגור", exact: true }).first().click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "עריכה" }).click();
    await sheet.getByLabel("הערה (לא חובה)").fill("שיפוץ");
    await sheet.getByRole("button", { name: "שמירת השינוי" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // The words changed; the days are still shut.
    await expect
      .poll(
        async () => {
          const read = await call<{ slots: unknown[] }[]>(
            `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
              `&resourceId=${shop.resource.id}&from=${first}&to=${first}`,
          );
          return (read[0]?.slots ?? []).length;
        },
        { timeout: 15_000 },
      )
      .toBe(0);
    await page.getByRole("button", { name: "סגור", exact: true }).first().click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "שיפוץ" })).toBeVisible({ timeout: 15_000 });
  });

  test("is not offered to a worker for the shop's own days", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `הרשאה ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    // Two calendars, so the shop's day is the shop's and not this worker's own calendar's.
    await call(`/businesses/${shop.business.id}/resources`, { method: "POST", token: shop.owner.token, body: { name: "כיסא שני" } });
    const day = aDayFromNow(2);
    await call(`/businesses/${shop.business.id}/closures`, {
      method: "POST",
      token: shop.owner.token,
      body: { fromDate: day, toDate: day, note: "חופשה", ranges: [], upcoming: "KEEP" },
    });
    const phone = uniquePhone();
    await call(`/businesses/${shop.business.id}/users`, {
      method: "POST",
      token: shop.owner.token,
      body: {
        phone,
        givenName: "עובדת",
        familyName: null,
        role: "WORKER",
        resourceIds: [shop.resource.id],
      },
    });

    await signInDirectly(page, phone, "עובדת");
    await page.goto("/manage");
    await ready(page);
    await showTheMonthOf(page, day);

    await page.getByRole("button", { name: "סגור", exact: true }).first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "חופשה" })).toBeVisible();
    // They can read what the shop decided; saying it differently is not theirs.
    await expect(sheet.getByText("שינוי של כל העסק. רק בעלים או מנהל יכולים לשנות אותו.")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "עריכה" })).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: /^מחיקה/ })).toHaveCount(0);
  });
});

test.describe("a day the shop is closed on", () => {
  test("says so, rather than drawing an ordinary empty day", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `סגור ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    const day = aDayFromNow(2);
    await call(`/businesses/${shop.business.id}/closures`, {
      method: "POST",
      token: shop.owner.token,
      body: { fromDate: day, toDate: day, note: "יום כיפור", ranges: [], upcoming: "KEEP" },
    });

    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await openTheDayOf(page, day);

    // It used to draw as a quiet day: hours of free time, every stretch of it
    // inviting a booking, and nothing saying the shop was shut.
    await expect(page.getByText("סגור כל היום").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("יום כיפור")).toBeVisible();
    await expect(aFreeStretch(page)).toHaveCount(0);

    // And the way back out is right there: the change behind it, and giving the day back.
    await page.getByRole("button", { name: "פרטי השינוי" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "מחיקה · היום חוזר לשעות הרגילות" }).click();
    await expect(aFreeStretch(page).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe("the note on something being made", () => {
  test("is empty again the next time, not still saying the last thing", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `הערה ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });

    const aim = async (day: string, note: string) => {
      await page.getByRole("button", { name: "הוספה ליום" }).click();
      await page.getByRole("dialog").getByRole("button", { name: /שינוי ביומן/ }).click();
      await openTheDayOf(page, day);
      await page.getByRole("button", { name: "המשך" }).click();
      const sheet = page.getByRole("dialog");
      await sheet.getByRole("radio", { name: /^לא עובדים כל היום/ }).click();
      await expect(sheet.getByLabel("הערה (לא חובה)")).toHaveValue("");
      if (note !== "") await sheet.getByLabel("הערה (לא חובה)").fill(note);
      return sheet;
    };

    const first = await aim(aDayFromNow(2), "רופא");
    await first.getByRole("button", { name: "שמירת השינוי" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // The words belonged to the thing that was made. Left behind, they turn up
    // on the next one — which is how a holiday gets labelled "רופא".
    await aim(aDayFromNow(4), "");
  });
});

/**
 * The rest of the calendar work, end to end.
 *
 * The pieces each have their own journey above; these are the ones that only
 * exist where several of them meet — the week's own shape against a decision
 * somebody made, a blockage absorbing another through the interface, and the
 * toolbar the whole screen now hangs off.
 */
test.describe("the calendar, altogether", () => {
  const openCalendar = async (page: Page, shop: { business: { id: string } }, token: string) => {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });
  };

  /** A shop that works Sunday to Thursday, so its weekends are its own. */
  /** The first day from `earliest` on that a weekday shop works, Sunday to Thursday. */
  const aWorkingDayAhead = (earliest: number): string => {
    for (let ahead = earliest; ; ahead += 1) {
      if (new Date(`${aDayFromNow(ahead)}T00:00:00Z`).getUTCDay() <= 4) return aDayFromNow(ahead);
    }
  };

  const aWeekdayBusiness = async (name: string) => {
    const shop = await aBusinessWithOpenHours({
      name,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "18:00" },
    });
    await call(`/businesses/${shop.business.id}/resources/${shop.resource.id}/working-hours`, {
      method: "PUT",
      token: shop.owner.token,
      body: {
        week: [0, 1, 2, 3, 4].map((dayOfWeek) => ({ dayOfWeek, start: "09:00", end: "18:00" })),
      },
    });
    return shop;
  };

  const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

  /**
   * A Saturday ahead, which this business never works, and a day of the same
   * month it does — two squares on one grid, telling two different stories.
   */
  const aRestDayAndAWorkingOne = (): { rest: string; working: string } => {
    for (let ahead = 1; ahead < 45; ahead += 1) {
      const rest = aDayFromNow(ahead);
      if (weekdayOf(rest) !== 6) continue;
      for (let other = 2; other < 45; other += 1) {
        const working = aDayFromNow(other);
        if (working.slice(0, 7) === rest.slice(0, 7) && weekdayOf(working) !== 6) return { rest, working };
      }
    }
    throw new Error("no Saturday ahead with a working day beside it");
  };

  test("tells a day nobody works from a day somebody closed", async ({ page }) => {
    const shop = await aWeekdayBusiness(`מנוחה ${Date.now()}`);
    // A day the shop does work, so the two squares are telling two different
    // stories. Taking whatever fell two days ahead meant that on a Thursday it
    // fell on the rest day itself and the test compared a square with itself —
    // and the ternary written to avoid exactly that had the same number in
    // both branches.
    const { rest, working: shut } = aRestDayAndAWorkingOne();
    await call(`/businesses/${shop.business.id}/closures`, {
      method: "POST",
      token: shop.owner.token,
      body: { fromDate: shut, toDate: shut, note: "יום כיפור", ranges: [], upcoming: "KEEP" },
    });

    await openCalendar(page, shop, shop.owner.token);
    await showTheMonthOf(page, rest);

    const restSquare = page.getByRole("button", { name: rest });
    const shutSquare = page.getByRole("button", { name: shut });
    await expect(restSquare).toBeVisible();
    await expect(shutSquare).toBeVisible();

    const painted = async (square: typeof restSquare) =>
      square.evaluate((node) => {
        const style = window.getComputedStyle(node);
        return { background: style.backgroundImage, colour: style.backgroundColor };
      });

    // Both are closed and only one is anybody's doing: the decision is solid,
    // the week's own shape is a quiet hatch.
    const resting = await painted(restSquare);
    const closed = await painted(shutSquare);
    expect(resting.background).toContain("gradient");
    expect(closed.background).not.toContain("gradient");
    expect(resting.colour).not.toBe(closed.colour);

    // And it says so. A pale square reads as disabled; the word is what makes
    // it read as the shop being shut that day.
    await expect(restSquare.getByText("סגור")).toBeVisible();

    // And only the decision carries a band, because only it was decided.
    await expect(page.getByRole("button", { name: "סגור", exact: true })).toHaveCount(1);
  });

  test("a closed day carries its comment, and it can be changed from there", async ({ page }) => {
    const shop = await aWeekdayBusiness(`הערה סגורה ${Date.now()}`);
    const day = aDayFromNow(2);
    await call(`/businesses/${shop.business.id}/closures`, {
      method: "POST",
      token: shop.owner.token,
      body: { fromDate: day, toDate: day, note: "יום כיפור", ranges: [], upcoming: "KEEP" },
    });

    await openCalendar(page, shop, shop.owner.token);
    await openTheDayOf(page, day);

    // Standing on the day itself, the words are right there rather than up in
    // the month's band — and so is putting them right.
    await expect(page.getByText("יום כיפור")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "פרטי השינוי" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "עריכה" }).click();
    await page.getByLabel("הערה (לא חובה)").fill("ערב חג");
    await page.getByRole("button", { name: "שמירת השינוי" }).click();

    await expect(page.getByText("ערב חג")).toBeVisible({ timeout: 15_000 });
    // Still shut: saying it differently is not giving the day back.
    await expect(page.getByText("סגור כל היום").first()).toBeVisible();
  });

  test("blocking over a blockage leaves one, covering both", async ({ page }) => {
    const shop = await aWeekdayBusiness(`בליעה ${Date.now()}`);
    // A day this shop works: hours off on a Friday are refused as hours
    // nobody works anyway, which is right, and not what this is about.
    const day = aWorkingDayAhead(2);
    await call(`/businesses/${shop.business.id}/resources/${shop.resource.id}/blocks`, {
      method: "POST",
      token: shop.owner.token,
      body: {
        blocks: [
          { startAt: `${day}T11:00:00.000Z`, endAt: `${day}T13:00:00.000Z`, reason: "ספק" },
        ],
        upcoming: "KEEP",
      },
    });

    await openCalendar(page, shop, shop.owner.token);
    await page.getByRole("button", { name: "הוספה ליום" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /שינוי ביומן/ }).click();
    await openTheDayOf(page, day);
    await page.getByRole("button", { name: "המשך" }).click();
    const sheet = page.getByRole("dialog");
    // Some hours, over the earlier two and past them on both sides.
    await sheet.getByRole("radio", { name: /^לא עובדים בחלק מהיום/ }).click();
    await sheet.getByLabel("מ־", { exact: true }).fill("09:00");
    await sheet.getByLabel("עד", { exact: true }).fill("18:00");
    await sheet.getByRole("button", { name: "שמירת השינוי" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // One blockage, not two lying on top of each other — and removing it gives
    // the whole day back rather than uncovering the one underneath.
    const read = await call<{ blocks: { id: string; startAt: string; endAt: string }[] }>(
      `/businesses/${shop.business.id}/resources/${shop.resource.id}/calendar?date=${day}`,
      { token: shop.owner.token },
    );
    expect(read.blocks).toHaveLength(1);
    // Covering both: the earlier two hours lie inside the one that is left.
    const [kept] = read.blocks;
    expect(Date.parse(kept?.startAt ?? "")).toBeLessThanOrEqual(Date.parse(`${day}T11:00:00.000Z`));
    expect(Date.parse(kept?.endAt ?? "")).toBeGreaterThanOrEqual(Date.parse(`${day}T13:00:00.000Z`));
  });

  test("the toolbar carries which calendar is being read, and switches it", async ({ page }) => {
    const shop = await aWeekdayBusiness(`יומנים ${Date.now()}`);
    await call(`/businesses/${shop.business.id}/resources`, {
      method: "POST",
      token: shop.owner.token,
      body: { name: "שימי" },
    });

    await openCalendar(page, shop, shop.owner.token);

    // One chip saying whose calendar this is, where a row of them used to be.
    const scope = page.getByRole("button", { name: /יומנים|יומן א/ }).first();
    await expect(page.getByRole("button", { name: "יומן א", exact: true })).toHaveCount(0);
    await scope.click();

    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("button", { name: /כל היומנים/ })).toBeVisible();
    await sheet.getByRole("button", { name: /שימי/ }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // The day below follows it: that calendar's lane, and no other.
    await expect(page.getByRole("button", { name: /שימי/ })).toBeVisible({ timeout: 15_000 });
  });

  test("keeps the month, the day and the schedule telling the same story", async ({ page }) => {
    const shop = await aWeekdayBusiness(`אחידות ${Date.now()}`);
    const day = aDayFromNow(2);
    await call(`/businesses/${shop.business.id}/closures`, {
      method: "POST",
      token: shop.owner.token,
      body: {
        fromDate: day,
        toDate: day,
        note: "ערב חג",
        ranges: [{ start: "09:00", end: "12:00" }],
        upcoming: "KEEP",
      },
    });

    await openCalendar(page, shop, shop.owner.token);
    await showTheMonthOf(page, day);

    // The month says the shop keeps other hours that day.
    await expect(page.getByRole("button", { name: "שעות אחרות", exact: true })).toBeVisible({ timeout: 15_000 });

    // The schedule's list of changes says the same, in the same words.
    await page.getByRole("button", { name: "לוח זמנים" }).click();
    await page.getByRole("tab", { name: "שינויים" }).click();
    const row = page.getByRole("list", { name: "השינויים" }).getByRole("button").first();
    await expect(row).toContainText("עובדים 09:00–12:00", { timeout: 15_000 });
    await expect(row).toContainText("ערב חג");

    // And removing it there removes the decision — so the month agrees again
    // straight away.
    await row.click();
    await page.getByRole("dialog").getByRole("button", { name: "מחיקה · היום חוזר לשעות הרגילות" }).click();
    await expect(page.getByText("אין שינויים קרובים")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "היומן" }).click();
    await expect(page.getByRole("button", { name: "שעות אחרות", exact: true })).toHaveCount(0, { timeout: 15_000 });
  });
});

/**
 * Stepping through the months.
 *
 * The grid draws the dates of whichever month it is on, while the answer for
 * that month is still in flight. Asking last month's answer about next month's
 * dates missed on every day — and a day nothing is known about used to draw as
 * a day nobody works, so a whole month came back closed.
 */
test.describe("moving between months", () => {
  test("comes back to a month that still reads as itself", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `חודשים ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "18:00" },
    });
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });

    const today = aDayFromNow(0);
    const hatched = async () =>
      page
        .getByRole("button", { name: today })
        .evaluate((node) => window.getComputedStyle(node).backgroundImage);
    const open = await hatched();
    expect(open).not.toContain("gradient");

    // Forward and back, as fast as the buttons allow — which is what made the
    // answers arrive out of order.
    for (const step of ["החודש הבא", "החודש הבא", "החודש הקודם", "החודש הקודם"]) {
      await page.getByRole("button", { name: step }).click();
    }

    await expect(page.getByRole("button", { name: today })).toBeVisible({ timeout: 15_000 });
    // The business works this day, and the month still says so.
    await expect.poll(hatched, { timeout: 15_000 }).not.toContain("gradient");
  });
});

test.describe("a calendar's own days off", () => {
  test("marks the days the calendar being read does not work", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `ימי מנוחה ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "18:00" },
    });
    const second = await call<{ id: string }>(`/businesses/${shop.business.id}/resources`, {
      method: "POST",
      token: shop.owner.token,
      body: { name: "שימי" },
    });
    // One chair takes Fridays off; the other works the whole week, so the shop
    // is open and only this calendar is not.
    await call(`/businesses/${shop.business.id}/resources/${shop.resource.id}/working-hours`, {
      method: "PUT",
      token: shop.owner.token,
      body: {
        week: [0, 1, 2, 3, 4].map((dayOfWeek) => ({ dayOfWeek, start: "09:00", end: "18:00" })),
      },
    });
    await call(`/businesses/${shop.business.id}/resources/${second.id}/working-hours`, {
      method: "PUT",
      token: shop.owner.token,
      body: {
        week: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          dayOfWeek,
          start: "09:00",
          end: "18:00",
        })),
      },
    });

    let friday = "";
    for (let ahead = 1; ahead < 20; ahead += 1) {
      const date = aDayFromNow(ahead);
      if (new Date(`${date}T00:00:00Z`).getUTCDay() === 5) {
        friday = date;
        break;
      }
    }
    expect(friday).not.toBe("");

    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });

    // Reading the chair that takes Fridays off: the Friday says so.
    await showTheMonthOf(page, friday);
    const square = page.getByRole("button", { name: friday });
    await expect(square.getByText("סגור")).toBeVisible({ timeout: 15_000 });

    // Reading the one that works it: the same Friday is an ordinary day. An
    // owner looking at one diary wants that diary's days off, not the shop's.
    await page.getByRole("button", { name: /^יומן:/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: /שימי/ }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });
    await expect(square.getByText("סגור")).toHaveCount(0, { timeout: 15_000 });
  });
});

/**
 * Four things that were wrong together, and are each their own kind of wrong.
 *
 * Two were the day drawn an hour longer than it is. One was a screen offering
 * controls that matched nothing and said nothing when they did nothing. One was
 * a search that answered the previous question.
 */
test.describe("the day as long as it really is", () => {
  const openCalendarAs = async (
    page: Page,
    shop: { business: { id: string }; owner: { token: string } },
  ) => {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });
  };

  test("a shortened day is drawn in its own hours, not an hour either side", async ({
    page,
  }) => {
    const shop = await aBusinessWithOpenHours({
      name: `שעות קצרות ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    const day = aDayFromNow(3);
    await call(`/businesses/${shop.business.id}/closures`, {
      method: "POST",
      token: shop.owner.token,
      body: {
        fromDate: day,
        toDate: day,
        note: "ערב חג",
        ranges: [{ start: "09:00", end: "12:00" }],
        upcoming: "KEEP",
      },
    });

    await openCalendarAs(page, shop);
    await openTheDayOf(page, day);

    // The empty day folds into one stretch, and the stretch is labelled with
    // the hours it covers — which is the window, said out loud. It used to read
    // 08:00–13:00: the same eight-to-five shape as any other day, so the one
    // thing making this day special was the one thing not on the screen.
    await expect(aFreeStretch(page).filter({ hasText: "09:00–12:00" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("08:00–13:00")).toHaveCount(0);
    // And the day says why, in a tag that opens the change.
    await expect(page.getByRole("button", { name: "שעות אחרות היום · 09:00–12:00 · ערב חג" })).toBeVisible();
  });

  test("a blockage reaching closing time does not push the day past it", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `חסימה עד הסוף ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    const day = aDayFromNow(3);
    await call(`/businesses/${shop.business.id}/resources/${shop.resource.id}/blocks`, {
      method: "POST",
      token: shop.owner.token,
      body: {
        blocks: [
          {
            startAt: anInstantAt(day, "14:00"),
            endAt: anInstantAt(day, "17:00"),
            reason: "",
          },
        ],
        upcoming: "KEEP",
      },
    });

    await openCalendarAs(page, shop);
    await openTheDayOf(page, day);

    // 09:00 to 14:00 is free and folds; the blockage holds the rest. Neither
    // edge of the day has an hour of nothing beyond it.
    await expect(page.getByText("09:00–14:00")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("18:00", { exact: true })).toHaveCount(0);
    await expect(page.getByText("08:00", { exact: true })).toHaveCount(0);
  });

  test("a blockage starting at opening does not push the day before it", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `חסימה מהבוקר ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    const day = aDayFromNow(3);
    await call(`/businesses/${shop.business.id}/resources/${shop.resource.id}/blocks`, {
      method: "POST",
      token: shop.owner.token,
      body: {
        blocks: [
          {
            startAt: anInstantAt(day, "09:00"),
            endAt: anInstantAt(day, "11:00"),
            reason: "",
          },
        ],
        upcoming: "KEEP",
      },
    });

    await openCalendarAs(page, shop);
    await openTheDayOf(page, day);

    await expect(page.getByText("11:00–17:00")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("08:00", { exact: true })).toHaveCount(0);
  });
});

test.describe("a day nobody works, and why nobody works it", () => {
  const aWeekdayAhead = (weekday: number): string => {
    for (let ahead = 1; ahead < 20; ahead += 1) {
      const date = aDayFromNow(ahead);
      if (new Date(`${date}T00:00:00Z`).getUTCDay() === weekday) return date;
    }
    return "";
  };

  test("a rest day says it is the usual week, and offers nothing it cannot do", async ({
    page,
  }) => {
    const shop = await aBusinessWithOpenHours({
      name: `יום מנוחה ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    // Saturday off, for the whole week ahead and every week after it.
    await call(`/businesses/${shop.business.id}/resources/${shop.resource.id}/working-hours`, {
      method: "PUT",
      token: shop.owner.token,
      body: {
        week: [0, 1, 2, 3, 4, 5].map((dayOfWeek) => ({
          dayOfWeek,
          start: "09:00",
          end: "17:00",
        })),
      },
    });
    const saturday = aWeekdayAhead(6);
    expect(saturday).not.toBe("");

    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await openTheDayOf(page, saturday);

    await expect(page.getByText("יום שבו לא עובדים")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/כך נראה השבוע הרגיל/)).toBeVisible();

    // The two controls that used to be here matched no closure — there is no
    // decision about this Saturday to name or to undo — so they did nothing at
    // all, twice, in silence.
    await expect(page.getByRole("button", { name: "פרטי השינוי" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "שמירה" })).toHaveCount(0);
    await expect(page.getByText("סגור כל היום")).toHaveCount(0);
  });

  test("a closed day offers both, and both of them work", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `סגירה ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    const day = aDayFromNow(4);
    await call(`/businesses/${shop.business.id}/closures`, {
      method: "POST",
      token: shop.owner.token,
      body: {
        fromDate: day,
        toDate: day,
        note: "חופשה",
        ranges: [],
        upcoming: "KEEP",
      },
    });

    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });
    await openTheDayOf(page, day);

    await expect(page.getByText("סגור כל היום")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("חופשה")).toBeVisible();

    // The words change, and stay changed.
    await page.getByRole("button", { name: "פרטי השינוי" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "עריכה" }).click();
    await page.getByRole("dialog").getByLabel("הערה (לא חובה)").fill("חופשה משפחתית");
    await page.getByRole("dialog").getByRole("button", { name: "שמירת השינוי" }).click();
    await expect(page.getByText("חופשה משפחתית")).toBeVisible({ timeout: 15_000 });

    // And the closure comes off, leaving an ordinary day behind it — one a
    // customer can book again.
    await page.getByRole("button", { name: "פרטי השינוי" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "מחיקה · היום חוזר לשעות הרגילות" }).click();
    await expect(page.getByText("סגור כל היום")).toHaveCount(0, { timeout: 15_000 });
    await expect
      .poll(
        async () =>
          (
            await call<{ slots: unknown[] }[]>(
              `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
                `&resourceId=${shop.resource.id}&from=${day}&to=${day}`,
            )
          )[0]?.slots.length ?? 0,
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
  });
});

test.describe("a search that answers the question it was asked", () => {
  const aCustomerWithAnAppointment = async (
    shop: {
      business: { id: string };
      service: { id: string };
      resource: { id: string };
    },
    name: { givenName: string; familyName: string },
    daysAhead: number,
  ) => {
    const phone = uniquePhone();
    const { code } = await call<{ code: string }>("/auth/request-code", {
      method: "POST",
      body: { phone },
    });
    const { token } = await call<{ token: string }>("/auth/verify", {
      method: "POST",
      body: { phone, code, name },
    });
    const day = aDayFromNow(daysAhead);
    const [available] = await call<{ slots: { startAt: string }[] }[]>(
      `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
        `&resourceId=${shop.resource.id}&from=${day}&to=${day}`,
    );
    const slot = available?.slots[0]?.startAt ?? "";
    expect(slot).not.toBe("");
    await call("/appointments", {
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
    return { phone, token };
  };

  test("never shows one query's matches under another", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({
      name: `חיפוש יציב ${Date.now()}`,
      ownerPhone,
      hours: { start: "09:00", end: "17:00" },
    });
    await aCustomerWithAnAppointment(shop, { givenName: "דנה", familyName: "כהן" }, 20);
    await aCustomerWithAnAppointment(shop, { givenName: "דניאל", familyName: "לוי" }, 21);

    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);

    await openTheSearch(page);
    const box = page.getByPlaceholder("חיפוש תור לפי שם או טלפון");

    // "דנ" reaches both.
    await box.fill("דנ");
    await expect(page.getByText("דניאל לוי").first()).toBeVisible({ timeout: 15_000 });

    // Now hold the next answer open. Without this the wrong answer is only on
    // screen for the debounce plus a local request — a few hundred milliseconds
    // that a retrying assertion sits straight through, which is exactly why the
    // bug survived a suite this size. Held, the question is unambiguous: with
    // "דנה" typed and its answer not back yet, what is on the screen?
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/appointments\?/, async (route) => {
      await held;
      await route.continue();
    });

    await box.fill("דנה");

    // Not דניאל. He answered the previous question, and the screen used to
    // keep showing him as though he answered this one.
    await expect(page.getByText("דניאל לוי")).toHaveCount(0, { timeout: 15_000 });

    release();
    await page.unroute(/\/appointments\?/);
    await expect(page.getByText("דנה כהן").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("דניאל לוי")).toHaveCount(0);
  });

  test("emptying the box gives the calendar back", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({
      name: `חיפוש ריק ${Date.now()}`,
      ownerPhone,
      hours: { start: "09:00", end: "17:00" },
    });
    await aCustomerWithAnAppointment(shop, { givenName: "רותם", familyName: "שגב" }, 22);

    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);

    await openTheSearch(page);
    const box = page.getByPlaceholder("חיפוש תור לפי שם או טלפון");
    await box.fill("רותם");
    await expect(page.getByText("רותם שגב").first()).toBeVisible({ timeout: 15_000 });

    await box.fill("");
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });
  });

  test("a single letter is not a search, and does not hide the calendar", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({
      name: `אות אחת ${Date.now()}`,
      ownerPhone,
      hours: { start: "09:00", end: "17:00" },
    });
    await aCustomerWithAnAppointment(shop, { givenName: "נועה", familyName: "ברק" }, 23);

    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);

    await openTheSearch(page);
    await page.getByPlaceholder("חיפוש תור לפי שם או טלפון").fill("נ");

    // One letter is everybody, so it is not a question — and the calendar
    // stays rather than being replaced by a list or by "no matches".
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("לא נמצא תור מתאים")).toHaveCount(0);
  });

  test("finds an English name whatever case it is typed in", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({
      name: `case ${Date.now()}`,
      ownerPhone,
      hours: { start: "09:00", end: "17:00" },
    });
    await aCustomerWithAnAppointment(shop, { givenName: "Yael", familyName: "Alon" }, 24);

    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);

    await openTheSearch(page);
    const box = page.getByPlaceholder("חיפוש תור לפי שם או טלפון");

    // The suggestion — "did you mean this customer" — is matched in the
    // browser, and that match was case-sensitive. Hebrew has no case, so it
    // worked for every Hebrew name and failed only in the half of the product
    // written in the other language. The results list below it comes from the
    // server and was always case-insensitive, which is what made this look
    // like the search working intermittently rather than not working.
    await box.fill("yael");
    await expect(
      page.getByRole("button", { name: /לקוח\s+Yael Alon/ }),
    ).toBeVisible({ timeout: 15_000 });

    await box.fill("ALON");
    await expect(
      page.getByRole("button", { name: /לקוח\s+Yael Alon/ }),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("acting on something the search found", () => {
  /** The time a result card shows for an instant, in the business's own zone. */
  const clockShownFor = (instant: string): string =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jerusalem",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(instant));

  const aCustomerWithTwo = async (shop: {
    business: { id: string };
    service: { id: string };
    resource: { id: string };
  }) => {
    const phone = uniquePhone();
    const { code } = await call<{ code: string }>("/auth/request-code", {
      method: "POST",
      body: { phone },
    });
    const { token } = await call<{ token: string }>("/auth/verify", {
      method: "POST",
      body: { phone, code, name: { givenName: "תמר", familyName: "בן דוד" } },
    });
    const starts: string[] = [];
    for (const ahead of [25, 26]) {
      const day = aDayFromNow(ahead);
      const [available] = await call<{ slots: { startAt: string }[] }[]>(
        `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
          `&resourceId=${shop.resource.id}&from=${day}&to=${day}`,
      );
      const slot = available?.slots[0]?.startAt ?? "";
      expect(slot).not.toBe("");
      await call("/appointments", {
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
      starts.push(slot);
    }
    return { phone, starts };
  };

  test("cancelling one leaves her other one on screen, not an empty result", async ({
    page,
  }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({
      name: `אחרי פעולה ${Date.now()}`,
      ownerPhone,
      hours: { start: "09:00", end: "17:00" },
    });
    await aCustomerWithTwo(shop);

    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);

    await openTheSearch(page);
    await page.getByPlaceholder("חיפוש תור לפי שם או טלפון").fill("תמר");
    // One card per appointment. Her name is also on the suggestion chip above
    // them, so the cards are counted by the service on them rather than by her.
    const results = page.getByRole("button").filter({ hasText: "תמר בן דוד" }).filter({
      hasText: "תספורת",
    });
    await expect(results).toHaveCount(2, { timeout: 15_000 });

    await results.first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "ביטול ופרסום השעה" }).click();

    // She still has one. The list has to be the answer to the question still
    // in the box, which means asking it again — the appointment that was just
    // cancelled is no longer one of its answers.
    await expect(results).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByText("לא נמצא תור מתאים")).toHaveCount(0);
  });

  test("moving one shows it at its new time, not its old one", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({
      name: `העברה מחיפוש ${Date.now()}`,
      ownerPhone,
      hours: { start: "09:00", end: "17:00" },
    });
    const { starts } = await aCustomerWithTwo(shop);
    const wasAt = clockShownFor(starts[0] ?? "");

    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);

    await openTheSearch(page);
    await page.getByPlaceholder("חיפוש תור לפי שם או טלפון").fill("תמר");
    const results = page
      .getByRole("button")
      .filter({ hasText: "תמר בן דוד" })
      .filter({ hasText: "תספורת" });
    await expect(results).toHaveCount(2, { timeout: 15_000 });
    await expect(page.getByText(wasAt).first()).toBeVisible();

    await results.first().click();
    await page.getByRole("button", { name: "העברת התור לשעה אחרת" }).click();
    // Any other time that day; the first offered one that is not where it is.
    const other = page.getByRole("button", { name: /^\d\d:\d\d$/ }).filter({
      hasNotText: wasAt,
    });
    await other.first().click();

    // Still two of hers, and the old time is not one of them.
    await expect(results).toHaveCount(2, { timeout: 15_000 });
    await expect(page.getByText(wasAt)).toHaveCount(0);
  });

  test("cancelling her only one says so, rather than leaving it on screen", async ({
    page,
  }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({
      name: `אחרון ${Date.now()}`,
      ownerPhone,
      hours: { start: "09:00", end: "17:00" },
    });
    const phone = uniquePhone();
    const { code } = await call<{ code: string }>("/auth/request-code", {
      method: "POST",
      body: { phone },
    });
    const { token } = await call<{ token: string }>("/auth/verify", {
      method: "POST",
      body: { phone, code, name: { givenName: "אביגיל", familyName: "נוי" } },
    });
    const day = aDayFromNow(27);
    const [available] = await call<{ slots: { startAt: string }[] }[]>(
      `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
        `&resourceId=${shop.resource.id}&from=${day}&to=${day}`,
    );
    await call("/appointments", {
      method: "POST",
      token,
      body: {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: shop.resource.id,
        startAt: available?.slots[0]?.startAt ?? "",
        customerNote: null,
      },
    });

    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);

    await openTheSearch(page);
    await page.getByPlaceholder("חיפוש תור לפי שם או טלפון").fill("אביגיל");
    const results = page
      .getByRole("button")
      .filter({ hasText: "אביגיל נוי" })
      .filter({ hasText: "תספורת" });
    await expect(results).toHaveCount(1, { timeout: 15_000 });

    await results.first().click();
    await page.getByRole("button", { name: "ביטול ופרסום השעה" }).click();

    // Empty is the right answer here, and it has to be arrived at rather than
    // left over: the cancelled appointment must not still be sitting there.
    await expect(results).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText("לא נמצא תור מתאים")).toBeVisible();
  });

  test("a named customer's list is re-asked too, not only the day", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({
      name: `צ׳יפ לקוח ${Date.now()}`,
      ownerPhone,
      hours: { start: "09:00", end: "17:00" },
    });
    await aCustomerWithTwo(shop);

    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);

    await openTheSearch(page);
    await page.getByPlaceholder("חיפוש תור לפי שם או טלפון").fill("תמר");
    // Naming her is a different question from searching for her: it is answered
    // by her own appointments, fetched by number, and that answer went stale in
    // exactly the same way.
    await page.getByRole("button", { name: /לקוח\s+תמר בן דוד/ }).click({ timeout: 15_000 });

    const hers = page
      .getByRole("button")
      .filter({ hasText: "תמר בן דוד" })
      .filter({ hasText: "תספורת" });
    await expect(hers).toHaveCount(2, { timeout: 15_000 });

    await hers.first().click();
    await page.getByRole("button", { name: "ביטול ופרסום השעה" }).click();
    await expect(hers).toHaveCount(1, { timeout: 15_000 });
  });

  // FILTER_BUTTON is off in day-filter-bar.tsx; back on, unskip.
  test.skip("the status filter finds the one that was just cancelled", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({
      name: `סטטוס ${Date.now()}`,
      ownerPhone,
      hours: { start: "09:00", end: "17:00" },
    });
    const { starts } = await aCustomerWithTwo(shop);
    const day = (starts[0] ?? "").slice(0, 10);

    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);

    // On the day itself, so the cancellation happens in the day's own list.
    await openTheDayOf(page, day);
    await page.getByText("תמר בן דוד").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "ביטול ופרסום השעה" }).click();

    // A cancelled appointment is not gone, it is cancelled — and the filter
    // that asks for cancelled ones has to be able to find it.
    await page.getByRole("button", { name: /סינון/ }).click();
    await page.getByRole("button", { name: "בוטל" }).click();
    await page.getByRole("button", { name: "הצגת התוצאות" }).click();
    await expect(page.getByText("תמר בן דוד").first()).toBeVisible({ timeout: 15_000 });
  });

  // FILTER_BUTTON is off in day-filter-bar.tsx; back on, unskip.
  test.skip("filters narrow together, and clearing gives the whole day back", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({
      name: `צירוף ${Date.now()}`,
      ownerPhone,
      hours: { start: "09:00", end: "17:00" },
    });
    const { starts } = await aCustomerWithTwo(shop);
    const day = (starts[0] ?? "").slice(0, 10);

    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await openTheDayOf(page, day);

    // A status nothing on this day has: the filter is an "and", so it leaves
    // nothing rather than falling back to everything.
    await page.getByRole("button", { name: /סינון/ }).click();
    await page.getByRole("button", { name: "בוטל" }).click();
    await page.getByRole("button", { name: "הצגת התוצאות" }).click();
    await expect(page.getByText("לא נמצא תור מתאים")).toBeVisible({ timeout: 15_000 });

    // And off again: the calendar comes back, not an empty filtered view.
    await page.getByRole("button", { name: "ניקוי" }).first().click();
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });
  });

  test("how far a named customer's list looks is hers to change", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({
      name: `טווח ${Date.now()}`,
      ownerPhone,
      hours: { start: "09:00", end: "17:00" },
    });
    await aCustomerWithTwo(shop);

    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);

    await openTheSearch(page);
    await page.getByPlaceholder("חיפוש תור לפי שם או טלפון").fill("תמר");
    await page.getByRole("button", { name: /לקוח\s+תמר בן דוד/ }).click({ timeout: 15_000 });

    const hers = page
      .getByRole("button")
      .filter({ hasText: "תמר בן דוד" })
      .filter({ hasText: "תספורת" });
    // Naming her opens at everything, because "when is she next in" is almost
    // never about today.
    await expect(hers).toHaveCount(2, { timeout: 15_000 });

    // Narrowed to today, she has nothing — both of hers are weeks out. That is
    // an answer, and the screen gives it in those words rather than the
    // generic "nothing found", which read as the filter being broken.
    await page.getByRole("button", { name: "היום", exact: true }).click();
    await expect(hers).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText("אין לו תור היום")).toBeVisible();

    // And back out again.
    await page.getByRole("button", { name: "הכול", exact: true }).click();
    await expect(hers).toHaveCount(2, { timeout: 15_000 });
  });
});

/**
 * The Business booking somebody in, which for a long time it could not do:
 * every route booked as whoever held the token.
 */
test.describe("booking a customer in", () => {
  const openCalendarAs = async (
    page: Page,
    shop: { business: { id: string }; owner: { token: string } },
  ) => {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });
  };

  /** What stands on the calendar that day, as "HH:MM name" — what was actually booked. */
  const bookedOn = async (
    shop: { business: { id: string }; resource: { id: string }; owner: { token: string } },
    day: string,
  ) =>
    (
      await call<{ appointments: { startAt: string; customerName: string; status: string }[] }>(
        `/businesses/${shop.business.id}/resources/${shop.resource.id}/calendar?date=${day}`,
        { token: shop.owner.token },
      )
    ).appointments
      .filter((appointment) => appointment.status === "CONFIRMED")
      .map((appointment) => `${localClockOf(appointment.startAt)} ${appointment.customerName}`);

  const aKnownCustomer = async (
    shop: { business: { id: string }; service: { id: string }; resource: { id: string } },
    name: { givenName: string; familyName: string },
    daysAhead: number,
  ) => {
    const phone = uniquePhone();
    const { code } = await call<{ code: string }>("/auth/request-code", {
      method: "POST",
      body: { phone },
    });
    const { token } = await call<{ token: string }>("/auth/verify", {
      method: "POST",
      body: { phone, code, name },
    });
    // Booking once is what makes her a customer of this business, which is
    // what puts her in the picker.
    const day = aDayFromNow(daysAhead);
    const [available] = await call<{ slots: { startAt: string }[] }[]>(
      `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
        `&resourceId=${shop.resource.id}&from=${day}&to=${day}`,
    );
    await call("/appointments", {
      method: "POST",
      token,
      body: {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: shop.resource.id,
        startAt: available?.slots[0]?.startAt ?? "",
        customerNote: null,
      },
    });
    return { phone };
  };

  test("from a free stretch: the hours are offered, and the tapped one leads", async ({
    page,
  }) => {
    const shop = await aBusinessWithOpenHours({
      name: `קביעה מהיומן ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    await aKnownCustomer(shop, { givenName: "תמר", familyName: "בן דוד" }, 30);
    const day = aDayFromNow(4);

    await openCalendarAs(page, shop);
    await openTheDayOf(page, day);

    // A whole empty day is folded, so the first tap opens the fold and the
    // second is the stretch itself.
    await aFreeStretch(page).first().click();
    await aFreeStretch(page).first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "תור ללקוח" }).click();

    // Who: the business's own customers, by name.
    await page.getByPlaceholder("חיפוש לפי שם או טלפון").fill("תמר");
    await page.getByRole("button").filter({ hasText: "תמר בן דוד" }).first().click();

    // Which hour: real availability, not a range to subdivide. 09:00 is the
    // first hour inside the stretch that was tapped, so it leads.
    await expect(page.getByRole("button", { name: "קביעה ל־09:00" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "קביעה ל־09:00" }).click();

    // And it is on the day, under her name, without a reload — and booked.
    await expect(page.getByText("תמר בן דוד").first()).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => bookedOn(shop, day), { timeout: 15_000 }).toEqual(["09:00 תמר בן דוד"]);
  });

  test("another hour in the day can be taken instead of the suggested one", async ({
    page,
  }) => {
    const shop = await aBusinessWithOpenHours({
      name: `שעה אחרת ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    await aKnownCustomer(shop, { givenName: "תמר", familyName: "בן דוד" }, 31);
    const day = aDayFromNow(5);

    await openCalendarAs(page, shop);
    await openTheDayOf(page, day);
    await aFreeStretch(page).first().click();
    await aFreeStretch(page).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "תור ללקוח" }).click();
    await page.getByPlaceholder("חיפוש לפי שם או טלפון").fill("תמר");
    await page.getByRole("button").filter({ hasText: "תמר בן דוד" }).first().click();

    // "Actually, make it half three." The stretch suggested 09:00; the rest of
    // the day has to be reachable without starting again.
    await expect(page.getByRole("button", { name: "15:30", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "15:30", exact: true }).click();
    await page.getByRole("button", { name: "קביעה ל־15:30" }).click();

    await expect(page.getByText("תמר בן דוד").first()).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => bookedOn(shop, day), { timeout: 15_000 }).toEqual(["15:30 תמר בן דוד"]);
  });

  test("from the +: one day is chosen, then the same sheet", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `קביעה מה+ ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    await aKnownCustomer(shop, { givenName: "תמר", familyName: "בן דוד" }, 32);
    const day = aDayFromNow(7);

    await openCalendarAs(page, shop);
    await page.getByRole("button", { name: "הוספה ליום" }).click();
    await page.getByRole("button", { name: /תור ללקוח/ }).click();

    // A blockage takes a run of days; an appointment takes one, and the banner
    // says so rather than letting somebody build a selection it cannot use.
    await expect(page.getByText("בחירת יום לתור")).toBeVisible({ timeout: 15_000 });
    await openTheDayOf(page, day);
    await page.getByRole("button", { name: "המשך" }).click();

    await page.getByPlaceholder("חיפוש לפי שם או טלפון").fill("תמר");
    await page.getByRole("button").filter({ hasText: "תמר בן דוד" }).first().click();

    // Nothing was tapped, so no hour leads — every one the day can take is
    // offered and one has to be chosen.
    await page.getByRole("button", { name: "11:00", exact: true }).click({ timeout: 15_000 });
    await page.getByRole("button", { name: "קביעה ל־11:00" }).click();
    await expect(page.getByText("תמר בן דוד").first()).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => bookedOn(shop, day), { timeout: 15_000 }).toEqual(["11:00 תמר בן דוד"]);
  });

  test("a second tap moves the day rather than building a range", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `יום יחיד ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    const [first, second] = inOneMonth([8, 9]);

    await openCalendarAs(page, shop);
    await page.getByRole("button", { name: "הוספה ליום" }).click();
    await page.getByRole("button", { name: /תור ללקוח/ }).click();

    await openTheDayOf(page, first);
    await page.getByRole("button", { name: second }).click();
    await page.getByRole("button", { name: "המשך" }).click();

    // The second day is the one it lands on — not a two-day range, which an
    // appointment cannot be. The sheet says which day it is booking, so there
    // is something to check that against.
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "תור ללקוח" })).toBeVisible({
      timeout: 15_000,
    });
    const asWords = new Intl.DateTimeFormat("he-IL", {
      timeZone: "Asia/Jerusalem",
      day: "numeric",
      month: "long",
    }).format(new Date(`${second}T09:00:00Z`));
    await expect(sheet.getByText(asWords, { exact: false })).toBeVisible();
  });

  test("from her record: she is carried into choosing a day, and pre-filled", async ({
    page,
  }) => {
    const shop = await aBusinessWithOpenHours({
      name: `מהלקוחה ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    await aKnownCustomer(shop, { givenName: "תמר", familyName: "בן דוד" }, 33);
    const later = aDayFromNow(10);

    await openCalendarAs(page, shop);

    // Reached the way an owner reaches her: by searching, because they know
    // the name and not the date.
    await openTheSearch(page);
    await page.getByPlaceholder("חיפוש תור לפי שם או טלפון").fill("תמר");
    await page
      .getByRole("button")
      .filter({ hasText: "תמר בן דוד" })
      .filter({ hasText: "תספורת" })
      .first()
      .click({ timeout: 15_000 });

    // "While I have you — can I book the next one?"
    await page.getByRole("button", { name: /קביעת תור לתמר/ }).click();

    // The same day-choosing the + uses, except it says who it is for.
    await expect(page.getByText(/בחירת יום לתור · תמר/)).toBeVisible({ timeout: 15_000 });
    await openTheDayOf(page, later);
    await page.getByRole("button", { name: "המשך" }).click();

    // And she is already in the sheet — no searching for somebody the screen
    // was looking at a moment ago.
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("תמר בן דוד")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByPlaceholder("חיפוש לפי שם או טלפון")).toHaveCount(0);

    await page.getByRole("button", { name: "10:00", exact: true }).click();
    await page.getByRole("button", { name: "קביעה ל־10:00" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });
    await expect.poll(() => bookedOn(shop, later), { timeout: 15_000 }).toEqual(["10:00 תמר בן דוד"]);
  });

  test("a tapped gap offers booking first, and asks the hours only for a change", async ({
    page,
  }) => {
    const shop = await aBusinessWithOpenHours({
      name: `מה עושים בפער ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    const day = aDayFromNow(13);

    await openCalendarAs(page, shop);
    await openTheDayOf(page, day);
    await aFreeStretch(page).first().click();
    await aFreeStretch(page).first().click();

    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    // Two plain choices, and none of the change's machinery until it is
    // asked for: no time fields, no length chips, no note.
    await expect(sheet.getByRole("button", { name: "תור ללקוח בשעה שנבחרה" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: /שינוי ביומן/ })).toBeVisible();
    await expect(sheet.getByLabel("מ־", { exact: true })).toHaveCount(0);
    await expect(sheet.getByLabel("עד", { exact: true })).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "שעה", exact: true })).toHaveCount(0);

    // Asking for a change opens the whole sheet, and the hours come with part of the day.
    await sheet.getByRole("button", { name: /שינוי ביומן/ }).click();
    await expect(sheet.getByRole("heading", { name: "שינוי ביומן" })).toBeVisible();
    await sheet.getByRole("radio", { name: /^לא עובדים בחלק מהיום/ }).click();
    await expect(sheet.getByRole("button", { name: "שעה", exact: true })).toBeVisible();
    await expect(sheet.getByLabel("מ־", { exact: true })).toBeVisible();

    // And walking away writes nothing.
    await sheet.getByRole("button", { name: "ביטול", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    const days = await call<{ slots: unknown[] }[]>(
      `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}&resourceId=${shop.resource.id}&from=${day}&to=${day}`,
    );
    expect((days[0]?.slots ?? []).length).toBe(16);
  });

  /**
   * How far a named customer's list looks.
   *
   * The chips say "today" and "this week", and somebody searches for a customer
   * precisely because her next appointment is not today — so these are empty in
   * the ordinary case, and the screen has to say which question came back empty
   * rather than "nothing found", which reads as the filter being broken.
   */
  test("her week holds what is in it, and her day says when it holds nothing", async ({
    page,
  }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({
      name: `טווח לקוחה ${Date.now()}`,
      ownerPhone,
      hours: { start: "09:00", end: "17:00" },
    });
    // One within the week, one a long way out — which is the shape of a real
    // customer's diary, and the reason "this week" is a useful question.
    await aKnownCustomer(shop, { givenName: "תמר", familyName: "בן דוד" }, 2);
    await aKnownCustomer(shop, { givenName: "תמר", familyName: "בן דוד" }, 40);

    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);

    await openTheSearch(page);
    await page.getByPlaceholder("חיפוש תור לפי שם או טלפון").fill("תמר");
    // Two customers of that name, so the first is the one being asked about.
    await page
      .getByRole("button", { name: /לקוח\s+תמר בן דוד/ })
      .first()
      .click({ timeout: 15_000 });

    const rows = page
      .getByRole("button")
      .filter({ hasText: "תמר בן דוד" })
      .filter({ hasText: "תספורת" });

    // Naming her opens at everything, because that is where her next one is.
    await expect(rows).toHaveCount(1, { timeout: 15_000 });

    // Her week holds the one two days out.
    await page.getByRole("button", { name: "השבוע", exact: true }).click();
    await expect(rows).toHaveCount(1, { timeout: 15_000 });

    // Her day holds nothing — and says so in those words, with the way out.
    await page.getByRole("button", { name: "היום", exact: true }).click();
    await expect(page.getByText("אין לו תור היום")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("לא נמצא תור מתאים")).toHaveCount(0);

    // The way out works, and is one tap.
    await page.getByRole("button", { name: "הצגת כל התורים" }).click();
    await expect(rows).toHaveCount(1, { timeout: 15_000 });
  });

  test("today means today, whatever day the calendar is showing", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({
      name: `היום זה היום ${Date.now()}`,
      ownerPhone,
      hours: { start: "09:00", end: "17:00" },
    });
    await aKnownCustomer(shop, { givenName: "תמר", familyName: "בן דוד" }, 3);
    const elsewhere = aDayFromNow(3);

    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);

    // Read a day that is not today — the day her appointment is on, in fact.
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });
    await openTheDayOf(page, elsewhere);

    await openTheSearch(page);
    await page.getByPlaceholder("חיפוש תור לפי שם או טלפון").fill("תמר");
    await page
      .getByRole("button", { name: /לקוח\s+תמר בן דוד/ })
      .first()
      .click({ timeout: 15_000 });

    // "היום" has to mean today. It used to mean whichever day was open, so
    // standing on the day of her appointment made "today" find it — which
    // looked like it working, and was the same bug as it finding nothing on
    // every other day.
    await page.getByRole("button", { name: "היום", exact: true }).click();
    await expect(page.getByText("אין לו תור היום")).toBeVisible({ timeout: 15_000 });
  });

  test("the sheet always says which calendar it is booking", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `שתי כורסאות ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    const second = await call<{ id: string; name: string }>(
      `/businesses/${shop.business.id}/resources`,
      { method: "POST", token: shop.owner.token, body: { name: "שימי" } },
    );
    await call(`/businesses/${shop.business.id}/resources/${second.id}/working-hours`, {
      method: "PUT",
      token: shop.owner.token,
      body: {
        week: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          dayOfWeek,
          start: "09:00",
          end: "17:00",
        })),
      },
    });
    const day = aDayFromNow(11);

    await openCalendarAs(page, shop);
    await openTheDayOf(page, day);
    await aFreeStretch(page).first().click();
    await aFreeStretch(page).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "תור ללקוח" }).click();

    // Tapping a lane already decided which calendar, which is exactly when the
    // screen used to stop saying so — and with two chairs, whose diary this
    // goes in is the thing most worth being sure of before pressing anything.
    // The name, not a label above it: when the lane already decided, a
    // labelled box of its own is a row of the sheet spent on a fact with no
    // decision in it, so the calendar is named beside the day instead.
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("יומן א", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("from the clients page: her record hands her to the calendar", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `מדף הלקוחות ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    await aKnownCustomer(shop, { givenName: "תמר", familyName: "בן דוד" }, 34);
    const later = aDayFromNow(12);

    await openCalendarAs(page, shop);

    // The long way round, which is the way an owner actually gets there.
    await page.getByRole("button", { name: "לקוחות" }).click();
    await page.getByText("תמר בן דוד").first().click();
    await expect(page.getByRole("heading", { name: "תמר בן דוד" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "תור ללקוח" }).click();

    // Back on the calendar, with her along and only a day left to choose.
    await expect(page.getByText(/בחירת יום לתור · תמר/)).toBeVisible({ timeout: 15_000 });
    await openTheDayOf(page, later);
    await page.getByRole("button", { name: "המשך" }).click();

    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("תמר בן דוד")).toBeVisible({ timeout: 15_000 });

    // And the address is clean again, so a reload is not a second booking.
    await expect(page).toHaveURL(/\/manage(\?|$)/);
    expect(page.url()).not.toContain("book=");
  });

  test("somebody who never booked here is written down and booked", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `לקוח חדש ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    const day = aDayFromNow(6);

    await openCalendarAs(page, shop);
    await openTheDayOf(page, day);
    await aFreeStretch(page).first().click();
    await aFreeStretch(page).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "תור ללקוח" }).click();

    // Nobody to find, because nobody has ever booked here. The way out is to
    // write them down — which is the ordinary case for a shop taking a call.
    await page.getByRole("button", { name: /לקוח חדש/ }).click();
    await page.getByLabel("שם הלקוח").fill("אביגיל");
    await page.getByLabel(/טלפון/).fill(uniquePhone().replace("+972", ""));
    await page.getByRole("button", { name: "שמירה" }).click();

    await expect(page.getByRole("button", { name: /^קביעה ל־/ })).toBeVisible({
      timeout: 15_000,
    });
    const hour = (await page.getByRole("button", { name: /^קביעה ל־/ }).textContent())?.match(/\d\d:\d\d/)?.[0];
    await page.getByRole("button", { name: /^קביעה ל־/ }).click();
    await expect(page.getByText("אביגיל").first()).toBeVisible({ timeout: 15_000 });
    // Written down as a customer of this shop, and booked at the hour offered.
    await expect.poll(() => bookedOn(shop, day), { timeout: 15_000 }).toEqual([`${hour} אביגיל`]);
  });
});

/**
 * Recovery time after an appointment.
 *
 * The domain has covered this since it was written; what had never been checked
 * end to end is that it survives the round trip — saved on the service, read
 * back, and honoured by the availability every screen books from. It is
 * deliberately invisible to the customer: they see a time offered or not
 * offered, never the reason.
 */
/**
 * The recovery time as an owner sets it (item 3): the business's number is on
 * the choice, the calendar it keeps is said, and the default says who follows it.
 */
test.describe("setting the recovery time", () => {
  const openServices = async (page: Page, shop: { business: { id: string }; owner: { token: string } }) => {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}&tab=business`);
    await ready(page);
  };
  const serviceOf = async (shop: { business: { id: string }; service: { id: string }; owner: { token: string } }) =>
    (
      await call<{ id: string; bufferMinutes: number | null }[]>(`/businesses/${shop.business.id}/services`, {
        token: shop.owner.token,
      })
    ).find((service) => service.id === shop.service.id);

  test("a service follows the business at its stated time, or keeps one of its own", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({ name: `התאוששות ${Date.now()}`, ownerPhone: uniquePhone(), durationMinutes: 30 });
    await call(`/businesses/${shop.business.id}`, { method: "PATCH", token: shop.owner.token, body: { defaultBufferMinutes: 10 } });
    await openServices(page, shop);

    const row = page.locator(".card", { hasText: shop.service.name }).first();
    await expect(row.getByText("התאוששות 10 דק׳ · של העסק")).toBeVisible({ timeout: 15_000 });
    await row.getByRole("button", { name: "עריכת שירות" }).click();

    const sheet = page.getByRole("dialog");
    const recovery = sheet.getByRole("group", { name: "זמן התאוששות אחרי התור" });
    // The business's number, on the choice itself.
    await expect(recovery.getByRole("button", { name: /כמו בעסק\s*10 דק׳/ })).toHaveAttribute("aria-pressed", "true");
    await expect(recovery.getByText("כל תור תופס ביומן 40 דק׳. הלקוח רואה רק את 30 הדקות של השירות.")).toBeVisible();

    // Its own: the minutes are asked for, and the sum follows them.
    await recovery.getByRole("button", { name: /זמן אחר/ }).click();
    await recovery.getByLabel(/זמן התאוששות אחרי התור/).fill("15");
    await expect(recovery.getByText("כל תור תופס ביומן 45 דק׳. הלקוח רואה רק את 30 הדקות של השירות.")).toBeVisible();
    await sheet.getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });
    await expect.poll(async () => (await serviceOf(shop))?.bufferMinutes, { timeout: 15_000 }).toBe(15);
    await expect(row.getByText("התאוששות 15 דק׳", { exact: true })).toBeVisible();

    // And back to the business's: saved as "follow", not as a copy of ten.
    await row.getByRole("button", { name: "עריכת שירות" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /כמו בעסק/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });
    await expect.poll(async () => (await serviceOf(shop))?.bufferMinutes, { timeout: 15_000 }).toBeNull();
    await expect(row.getByText("התאוששות 10 דק׳ · של העסק")).toBeVisible();
  });

  test("a time of its own of nought is no recovery at all", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({ name: `בלי התאוששות ${Date.now()}`, ownerPhone: uniquePhone(), durationMinutes: 30 });
    await call(`/businesses/${shop.business.id}`, { method: "PATCH", token: shop.owner.token, body: { defaultBufferMinutes: 10 } });
    await openServices(page, shop);
    await page.locator(".card", { hasText: shop.service.name }).first().getByRole("button", { name: "עריכת שירות" }).click({ timeout: 15_000 });

    const recovery = page.getByRole("dialog").getByRole("group", { name: "זמן התאוששות אחרי התור" });
    await recovery.getByRole("button", { name: /זמן אחר/ }).click();
    await recovery.getByLabel(/זמן התאוששות אחרי התור/).fill("0");
    await expect(recovery.getByText("בלי זמן התאוששות: כל תור תופס ביומן 30 דק׳.")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "שמירה" }).click();
    await expect.poll(async () => (await serviceOf(shop))?.bufferMinutes, { timeout: 15_000 }).toBe(0);
  });

  test("the default is one tap from the service, and says which services follow it", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({ name: `ברירת מחדל ${Date.now()}`, ownerPhone: uniquePhone(), durationMinutes: 30 });
    await call(`/businesses/${shop.business.id}`, { method: "PATCH", token: shop.owner.token, body: { defaultBufferMinutes: 10 } });
    await call(`/businesses/${shop.business.id}/services`, {
      method: "POST",
      token: shop.owner.token,
      body: { name: "צבע ופן", durationMinutes: 60, priceMinor: 25000, bufferMinutes: 15 },
    });
    await openServices(page, shop);

    await page.locator(".card", { hasText: shop.service.name }).first().getByRole("button", { name: "עריכת שירות" }).click({ timeout: 15_000 });
    await page.getByRole("button", { name: /ברירת המחדל של העסק נקבעת בהגדרות העסק/ }).click();

    // The settings, at the default, with each service and whose time it keeps.
    const followers = page.locator(".buffer-followers");
    await expect(followers).toBeVisible({ timeout: 15_000 });
    await expect(followers.locator("div", { hasText: shop.service.name })).toContainText("לפי ברירת המחדל · 10 דק׳");
    await expect(followers.locator("div", { hasText: "צבע ופן" })).toContainText("זמן משלו · 15 דק׳");

    // Typing a new default moves the services that follow it, and only them.
    await page.getByLabel(/זמן התאוששות אחרי תור — ברירת המחדל/).fill("20");
    await expect(followers.locator("div", { hasText: shop.service.name })).toContainText("לפי ברירת המחדל · 20 דק׳");
    await expect(followers.locator("div", { hasText: "צבע ופן" })).toContainText("זמן משלו · 15 דק׳");
  });
});

test.describe("the recovery time after an appointment", () => {
  const clockIn = (instant: string) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jerusalem",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(instant));

  const slotsFor = async (
    businessId: string,
    serviceId: string,
    resourceId: string,
    day: string,
  ) => {
    const [found] = await call<{ slots: { startAt: string }[] }[]>(
      `/businesses/${businessId}/availability?serviceId=${serviceId}` +
        `&resourceId=${resourceId}&from=${day}&to=${day}`,
    );
    return (found?.slots ?? []).map((slot) => clockIn(slot.startAt));
  };

  test("is taken out of the day, on top of the appointment itself", async () => {
    const shop = await aBusinessWithOpenHours({
      name: `התאוששות ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
      durationMinutes: 30,
    });
    await call(`/businesses/${shop.business.id}/services/${shop.service.id}`, {
      method: "PATCH",
      token: shop.owner.token,
      body: { bufferMinutes: 15 },
    });

    const day = aDayFromNow(3);
    const offered = await slotsFor(shop.business.id, shop.service.id, shop.resource.id, day);

    // Thirty minutes of haircut and fifteen of recovery is a forty-five minute
    // hole in the day, so that is how far apart the starts are.
    expect(offered.slice(0, 3)).toEqual(["09:00", "09:45", "10:30"]);
  });

  test("keeps another service out of it, which has no recovery of its own", async () => {
    const shop = await aBusinessWithOpenHours({
      name: `התאוששות בין שירותים ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
      durationMinutes: 30,
    });
    await call(`/businesses/${shop.business.id}/services/${shop.service.id}`, {
      method: "PATCH",
      token: shop.owner.token,
      body: { bufferMinutes: 15 },
    });
    const plain = await call<{ id: string }>(`/businesses/${shop.business.id}/services`, {
      method: "POST",
      token: shop.owner.token,
      body: { name: "פן", durationMinutes: 30, priceMinor: 6000, bufferMinutes: 0 },
    });

    const day = aDayFromNow(4);
    const phone = uniquePhone();
    const { code } = await call<{ code: string }>("/auth/request-code", {
      method: "POST",
      body: { phone },
    });
    const { token } = await call<{ token: string }>("/auth/verify", {
      method: "POST",
      body: { phone, code, name: { givenName: "דנה", familyName: "כהן" } },
    });
    const first = await slotsFor(shop.business.id, shop.service.id, shop.resource.id, day);
    expect(first[0]).toBe("09:00");
    await call("/appointments", {
      method: "POST",
      token,
      body: {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: shop.resource.id,
        startAt: `${day}T06:00:00.000Z`,
        customerNote: null,
      },
    });

    // The other service steps by thirty minutes of its own, so its grid would
    // land on 09:30 — which is inside the first appointment's recovery. The
    // recovery belongs to the calendar, not to the service that caused it.
    const after = await slotsFor(shop.business.id, plain.id, shop.resource.id, day);
    expect(after).not.toContain("09:30");
    expect(after[0]).toBe("09:45");
  });

  test("falls back to the business's own, for a service that sets none", async () => {
    const shop = await aBusinessWithOpenHours({
      name: `ברירת מחדל ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
      durationMinutes: 30,
    });
    await call(`/businesses/${shop.business.id}/services/${shop.service.id}`, {
      method: "PATCH",
      token: shop.owner.token,
      body: { bufferMinutes: null },
    });
    await call(`/businesses/${shop.business.id}`, {
      method: "PATCH",
      token: shop.owner.token,
      body: { defaultBufferMinutes: 20 },
    });

    const day = aDayFromNow(5);
    const offered = await slotsFor(shop.business.id, shop.service.id, shop.resource.id, day);
    expect(offered.slice(0, 3)).toEqual(["09:00", "09:50", "10:40"]);
  });
});

/**
 * Crossing between the customer app and a business.
 *
 * One identity, two contexts, one control — in the same corner both ways. The
 * account drawer stays what it was: the list of everywhere you can be, with the
 * roles on it. The switch is the shortcut, not a replacement for it.
 */
test.describe("the switch between customer and management", () => {
  const signedInAt = async (page: Page, shop: { owner: { token: string } }) => {
    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );
  };

  test("one tap in, one tap back, and the same control both ways", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `מעבר ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });
    await signedInAt(page, shop);
    await page.goto("/");
    await ready(page);

    const switcher = page.getByRole("group", { name: "מעבר בין לקוח לניהול" });
    await expect(switcher).toBeVisible({ timeout: 15_000 });
    // The mark keeps its place beside it — the switch is an addition to the
    // header, not a replacement for what was there.
    await expect(page.getByRole("banner").getByText("תור")).toBeVisible();

    await switcher.getByRole("button", { name: "ניהול" }).click();
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });

    // Back through the same control, in the same corner.
    await page
      .getByRole("group", { name: "מעבר בין לקוח לניהול" })
      .getByRole("button", { name: "לקוח" })
      .click();
    await expect(page.getByPlaceholder("מספרה, קליניקה, מאמן אישי…")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("is not drawn for somebody who staffs nothing", async ({ page }) => {
    const phone = uniquePhone();
    await signInDirectly(page, phone, "לקוחה בלבד");
    await page.goto("/");
    await ready(page);

    // Most people are only customers, and a switch with one side is furniture.
    await expect(page.getByRole("group", { name: "מעבר בין לקוח לניהול" })).toHaveCount(0);
  });

  test("opens the business it was last in, without asking", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const first = await aBusinessWithOpenHours({ name: `ראשון ${Date.now()}`, ownerPhone });
    const second = await aBusinessWithOpenHours({ name: `שני ${Date.now()}`, ownerPhone });

    await signedInAt(page, first);
    await page.goto(`/manage?business=${second.business.id}`);
    await ready(page);
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });

    // With several, the switch carries the shop rather than the word — a
    // button whose destination you cannot see is one you must press to learn.
    const switcher = page.getByRole("group", { name: "מעבר בין לקוח לניהול" });
    await expect(switcher.getByText(second.business.name)).toBeVisible();

    await switcher.getByRole("button", { name: "לקוח" }).click();
    await expect(page.getByPlaceholder("מספרה, קליניקה, מאמן אישי…")).toBeVisible({
      timeout: 15_000,
    });

    // And back in: the second one, because that is where they were. Not a
    // question, and not the one that happens to sort first.
    await page
      .getByRole("group", { name: "מעבר בין לקוח לניהול" })
      .getByRole("button", { name: "ניהול" })
      .click();
    await expect(
      page.getByRole("group", { name: "מעבר בין לקוח לניהול" }).getByText(second.business.name),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("changing shop is a question for the inside, and keeps the roles on it", async ({
    page,
  }) => {
    const ownerPhone = uniquePhone();
    const first = await aBusinessWithOpenHours({ name: `אלף ${Date.now()}`, ownerPhone });
    const second = await aBusinessWithOpenHours({ name: `בית ${Date.now()}`, ownerPhone });

    await signedInAt(page, first);
    await page.goto(`/manage?business=${first.business.id}`);
    await ready(page);
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });

    const switcher = page.getByRole("group", { name: "מעבר בין לקוח לניהול" });
    await switcher.getByText(first.business.name).click();

    // The drawer's own rows, so the role is on them exactly as it is there.
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "איזה עסק" })).toBeVisible();
    await expect(sheet.getByText("בעלים").first()).toBeVisible();
    await sheet.getByText(second.business.name).click();

    await expect(
      page.getByRole("group", { name: "מעבר בין לקוח לניהול" }).getByText(second.business.name),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("an inactive business says so on the page, and the switch still leads out", async ({
    page,
  }) => {
    const ownerPhone = uniquePhone();
    const live = await aBusinessWithOpenHours({ name: `פעיל ${Date.now()}`, ownerPhone });
    const off = await aBusinessWithOpenHours({ name: `מושבת ${Date.now()}`, ownerPhone });
    await call(`/admin/businesses/${off.business.id}/active`, {
      method: "PATCH",
      body: { active: false },
      token: await anAdministrator(),
    });

    await signedInAt(page, live);
    await page.goto(`/manage?business=${off.business.id}`);
    await ready(page);

    // Said in the page, not a dialog over it: the switch must stay reachable.
    await expect(page.getByText("העסק אינו פעיל")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const switcher = page.getByRole("group", { name: "מעבר בין לקוח לניהול" });
    await switcher.getByText(off.business.name).click();
    await page.getByRole("dialog").getByText(live.business.name).click();

    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });
    await expect(switcher.getByText(live.business.name)).toBeVisible();
  });

  test("staff opening the app land in the business they were last in, and the customer side stays reachable", async ({
    page,
  }) => {
    const ownerPhone = uniquePhone();
    const first = await aBusinessWithOpenHours({ name: `פתיחה ${Date.now()}`, ownerPhone });
    const second = await aBusinessWithOpenHours({ name: `אחרון ${Date.now()}`, ownerPhone });
    await signedInAt(page, first);
    await page.goto(`/manage?business=${second.business.id}`);
    await ready(page);
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });

    await page.goto("/");
    await expect(page).toHaveURL(/\/manage/, { timeout: 15_000 });
    const switcher = page.getByRole("group", { name: "מעבר בין לקוח לניהול" });
    await expect(switcher.getByText(second.business.name)).toBeVisible({ timeout: 15_000 });

    // "לקוח" leads to `/` too, and must not bounce back.
    await switcher.getByRole("button", { name: "לקוח" }).click();
    await expect(page.getByPlaceholder("מספרה, קליניקה, מאמן אישי…")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).not.toHaveURL(/\/manage/);
  });

  test("the account drawer shows only where you are", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `מגירה ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });
    await signedInAt(page, shop);
    await page.goto("/?screen=search");
    await ready(page);

    // Crossing over is the switch's job alone; the drawer names the context
    // you are in and nothing else.
    await page.getByRole("button", { name: "החשבון שלי" }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByText("כלקוח")).toBeVisible({ timeout: 15_000 });
    await expect(drawer.getByText(shop.business.name)).toHaveCount(0);
  });
});

test.describe("crossing over without reloading", () => {
  test("keeps the page it is on, rather than fetching a new document", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `בלי רענון ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });
    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto("/");
    await ready(page);

    // A mark that only a fresh document can destroy. If the switch reloads,
    // this is gone on the other side — which is the difference between a
    // route change and a refresh, and the only one a person actually feels.
    await page.evaluate(() => {
      (window as unknown as { crossingMark?: number }).crossingMark = 1;
    });

    const switcher = page.getByRole("group", { name: "מעבר בין לקוח לניהול" });
    await switcher.getByRole("button", { name: "ניהול" }).click();
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });
    expect(
      await page.evaluate(
        () => (window as unknown as { crossingMark?: number }).crossingMark ?? 0,
      ),
    ).toBe(1);

    // And back again.
    await page
      .getByRole("group", { name: "מעבר בין לקוח לניהול" })
      .getByRole("button", { name: "לקוח" })
      .click();
    await expect(page.getByPlaceholder("מספרה, קליניקה, מאמן אישי…")).toBeVisible({
      timeout: 15_000,
    });
    expect(
      await page.evaluate(
        () => (window as unknown as { crossingMark?: number }).crossingMark ?? 0,
      ),
    ).toBe(1);
  });

  test("never leaves the screen without a header", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `כותרת ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });
    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto("/");
    await ready(page);

    // Watch the banner for the whole crossing. It used to be replaced by a
    // bare spinner — the header and the bar went, the screen went white, and
    // the switch you had just pressed went with them.
    await page.evaluate(() => {
      const w = window as unknown as { headerGone?: boolean };
      w.headerGone = false;
      const check = () => {
        if (document.querySelector("header") === null) w.headerGone = true;
      };
      new MutationObserver(check).observe(document.body, { childList: true, subtree: true });
      check();
    });

    await page
      .getByRole("group", { name: "מעבר בין לקוח לניהול" })
      .getByRole("button", { name: "ניהול" })
      .click();
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });

    expect(
      await page.evaluate(
        () => (window as unknown as { headerGone?: boolean }).headerGone ?? true,
      ),
    ).toBe(false);
  });
});

test.describe("adding somebody to a business you are not the only owner of", () => {
  const openTeam = async (page: Page, businessId: string, token: string) => {
    await page.addInitScript(
      ([k, v]) => window.localStorage.setItem(k as string, v as string),
      ["tor-now.session", token],
    );
    await page.goto(`/manage?business=${businessId}`);
    await ready(page);
    await page.getByRole("button", { name: "העסק" }).click();
    await page.getByRole("button", { name: "צוות", exact: true }).click();
  };

  test("a worker added to the second business stays in the second business", async ({
    page,
  }) => {
    const ownerPhone = uniquePhone();
    const first = await aBusinessWithOpenHours({ name: `אלף ${Date.now()}`, ownerPhone });
    const second = await aBusinessWithOpenHours({ name: `בית ${Date.now()}`, ownerPhone });

    // Reached the way somebody with two actually reaches it: land on one, and
    // cross to the other with the switch.
    await openTeam(page, first.business.id, first.owner.token);
    await page
      .getByRole("group", { name: "מעבר בין לקוח לניהול" })
      .getByText(first.business.name)
      .click();
    await page.getByRole("dialog").getByText(second.business.name).click();
    await expect(page.getByRole("button", { name: "צוות", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "צוות", exact: true }).click();

    await page.getByRole("button", { name: "הוספה" }).first().click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel(/טלפון/).fill(uniquePhone().replace("+972", ""));
    await sheet.getByLabel(/שם פרטי/).fill("שימי");
    await sheet.getByText("עובד ביומן").click();
    await sheet.getByRole("button", { name: /^יומן/ }).first().click();
    await sheet.getByRole("button", { name: "הוספה" }).click();

    // The invitation always went through; what came back was the *other*
    // business's team, because reloading the list read the address — which
    // still named the business the switch had been left behind on.
    await expect(page.getByText("שימי")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(new RegExp(second.business.id));
    await expect(
      page.getByRole("group", { name: "מעבר בין לקוח לניהול" }).getByText(second.business.name),
    ).toBeVisible();

    // And on the server too: on the second business's team, not the first's.
    const teamOf = async (shop: typeof first) =>
      (await call<{ name: string }[]>(`/businesses/${shop.business.id}/users`, { token: shop.owner.token })).map(
        (member) => member.name,
      );
    expect(await teamOf(second)).toContain("שימי");
    expect(await teamOf(first)).not.toContain("שימי");
  });

  test("asks for the number first, and scolds nobody on the way in", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `טופס ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });
    await openTeam(page, shop.business.id, shop.owner.token);
    await page.getByRole("button", { name: "הוספה" }).first().click();

    const sheet = page.getByRole("dialog");
    // The number is the identity and decides whether the name is asked for at
    // all, so it is where the sheet opens.
    await expect(sheet.getByLabel(/טלפון/)).toBeFocused();

    // And nothing is wrong yet. Every field said "שדה חובה" the moment the
    // sheet opened, which reads as a form that has already failed.
    await expect(sheet.getByText("שדה חובה")).toHaveCount(0);

    // Leaving one empty is a different matter.
    await sheet.getByLabel(/שם פרטי/).click();
    await sheet.getByLabel(/שם משפחה/).click();
    await expect(sheet.getByText("שדה חובה").first()).toBeVisible();
  });
});

test.describe("typing a number into a number", () => {
  test("replaces the nought rather than growing beside it", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `מספרים ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });
    await page.addInitScript(
      ([k, v]) => window.localStorage.setItem(k as string, v as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await page.getByRole("button", { name: "העסק" }).click();
    await page.getByRole("button", { name: "הוספת שירות" }).click();

    const sheet = page.getByRole("dialog");
    const price = sheet.getByLabel(/מחיר/);
    // A price that starts at nought: tapping it and typing eighty used to give
    // eighty *after* the nought, and the only way out was to select the box by
    // hand first.
    await price.click();
    await price.pressSequentially("80");
    await expect(price).toHaveValue("80");

    const duration = sheet.getByLabel(/משך/);
    await duration.click();
    await duration.pressSequentially("45");
    await expect(duration).toHaveValue("45");

    // And a box can be emptied without a nought jumping back into it.
    await price.click();
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await expect(price).toHaveValue("");
  });

  test("a new service's price starts empty, and typing never leaves a leading zero", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({ name: `מחיר ${Date.now()}`, ownerPhone: uniquePhone() });
    await page.addInitScript(([k, v]) => window.localStorage.setItem(k as string, v as string), [
      "tor-now.session",
      shop.owner.token,
    ]);
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await page.getByRole("button", { name: "העסק" }).click();
    await page.getByRole("button", { name: "הוספת שירות" }).click();
    const sheet = page.getByRole("dialog");
    const price = sheet.getByLabel(/מחיר/);

    // Optional, as its hint says: an empty box with an example in it, not a
    // nought to be deleted first.
    await expect(price).toHaveValue("");
    await expect(price).toHaveAttribute("placeholder", "80");

    // The caret after a nought, which is where a finger leaves it on a phone
    // when the selection does not survive the tap: still eighty, not "080".
    await price.fill("0");
    await price.press("End");
    await price.pressSequentially("80");
    await expect(price).toHaveValue("80");

    // Left empty, the service is saved without a price.
    await price.fill("");
    await sheet.getByLabel(/שם השירות/).fill("ייעוץ");
    await price.blur();
    await expect(price).toHaveValue("");
    await sheet.getByRole("button", { name: "שמירה" }).click();
    await expect(sheet).toBeHidden({ timeout: 15_000 });
    const services = await call<{ name: string; priceMinor: number }[]>(`/businesses/${shop.business.id}/services`, {
      token: shop.owner.token,
    });
    expect(services.find((service) => service.name === "ייעוץ")?.priceMinor).toBe(0);
  });

  test("a number box takes a typed number cleanly, wherever the caret was", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({ name: `מספרים ${Date.now()}`, ownerPhone: uniquePhone() });
    await page.addInitScript(([k, v]) => window.localStorage.setItem(k as string, v as string), [
      "tor-now.session",
      shop.owner.token,
    ]);
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await page.getByRole("button", { name: "העסק" }).click();
    await page.getByRole("button", { name: "הוספת שירות" }).click();
    const sheet = page.getByRole("dialog");

    const duration = sheet.getByLabel(/משך/);
    await duration.fill("0");
    await duration.press("End");
    await duration.pressSequentially("45");
    await expect(duration).toHaveValue("45");

    // Letters and signs never reach the box.
    await duration.fill("");
    await duration.pressSequentially("4-5e");
    await expect(duration).toHaveValue("45");

    // A price may have agorot.
    const price = sheet.getByLabel(/מחיר/);
    await price.pressSequentially("79.90");
    await expect(price).toHaveValue("79.90");

    // On a phone the keyboard that opens is the numbers one.
    await expect(duration).toHaveAttribute("inputmode", "numeric");
    await expect(price).toHaveAttribute("inputmode", "decimal");
  });
});

test.describe("the billing tab", () => {
  test("shows the owner their Trial, when it ends, and what happens then", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({ name: `ניסיון ${Date.now()}`, ownerPhone, plan: "SOLO" });

    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);

    await page.getByRole("button", { name: "העסק", exact: true }).click();
    await page.getByRole("button", { name: "מנוי ותשלומים" }).click();

    await expect(page.getByText("יחיד", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("ניסיון", { exact: true })).toBeVisible();
    await expect(page.getByText("ניסיון עד", { exact: true })).toBeVisible();
    await expect(page.getByText(/תקופת הניסיון מסתיימת/)).toBeVisible();
    await expect(page.getByText("עדיין אין תשלומים.")).toBeVisible();
  });
});

test.describe("what Solo locks", () => {
  const aSoloShop = async (ownerPhone: string) =>
    aBusinessWithOpenHours({ name: `יחיד ${Date.now()}`, ownerPhone, plan: "SOLO" });

  const openPanel = async (page: Page, businessId: string, panel: string) => {
    await page.goto(`/manage?business=${businessId}`);
    await ready(page);
    await page.getByRole("button", { name: "העסק", exact: true }).click();
    await page.getByRole("button", { name: panel, exact: true }).click();
  };

  test("a second calendar is a lock that leads to the plans", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aSoloShop(ownerPhone);
    await signInDirectly(page, ownerPhone, "בעלים");
    await openPanel(page, shop.business.id, "יומנים");

    // Said only now that there is no room left.
    await expect(page.getByText("המסלול כולל יומן אחד, והוא בשימוש")).toBeVisible({ timeout: 15_000 });
    const lock = page.getByRole("group", { name: "יומן נוסף זמין במסלול צוות" });
    await expect(lock).toBeVisible();
    await expect(page.getByRole("button", { name: "הוספה", exact: true })).toHaveCount(0);

    await lock.getByRole("button", { name: "למסלולים" }).click();
    await expect(page.getByText("המסלולים")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("radio", { name: /צוות/ })).toBeVisible();
  });

  test("adding to the team is a lock, and whoever is there stays", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aSoloShop(ownerPhone);
    await signInDirectly(page, ownerPhone, "בעלים");
    await openPanel(page, shop.business.id, "צוות");

    await expect(page.getByRole("group", { name: "הוספת מנהלים ועובדים זמינה במסלול צוות" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "הוספה", exact: true })).toHaveCount(0);
  });

  test("a customer's record still books them in, with their history locked", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aSoloShop(ownerPhone);
    const customerPhone = uniquePhone();
    const { code } = await call<{ code: string }>("/auth/request-code", { method: "POST", body: { phone: customerPhone } });
    const { token } = await call<{ token: string }>("/auth/verify", {
      method: "POST",
      body: { phone: customerPhone, code, name: { givenName: "דנה", familyName: "כהן" } },
    });
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

    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await page.getByRole("button", { name: "לקוחות", exact: true }).click();
    await page.getByText("דנה כהן").first().click();
    await expect(page).toHaveURL(/\/manage\/customers\//, { timeout: 15_000 });

    await expect(page.getByRole("button", { name: "תור ללקוח" })).toBeVisible();
    await expect(page.getByRole("group", { name: "היסטוריית לקוח זמינה במסלול צוות" })).toBeVisible();
    await expect(page.getByRole("button", { name: "חסימת הלקוח" })).toHaveCount(0);
    // What is coming is not history: it stays.
    await expect(page.getByText("התורים הקרובים")).toBeVisible();
  });
});

test.describe("choosing a plan", () => {
  test("opening the wizard with no plan sends the owner to choose one first", async ({ page }) => {
    await signInDirectly(page, uniquePhone(), "בעלים");
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/pricing/, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "מתחילים ביחיד" })).toBeVisible();
    // The Trial the server gives, not a number written on the page.
    await expect(page.getByText("30 יום ניסיון, בלי כרטיס אשראי")).toBeVisible();
  });

  test("a second calendar on Solo is one tap from Team, without leaving the wizard", async ({ page }) => {
    const phone = uniquePhone();
    await stubAddressSearch(page);
    await signInDirectly(page, phone, "בעלים");
    await page.goto("/onboarding?plan=SOLO");
    await ready(page);
    await page.getByLabel("שם העסק").fill(`שני יומנים ${Date.now()}`);
    await page.getByLabel("טלפון").fill(asTyped(phone));
    await pickAnAddress(page, "הרצל 1");
    await pickACategory(page);
    await page.getByRole("button", { name: "המשך" }).click();
    await page.getByRole("button", { name: "המשך" }).click();

    await page.getByLabel("שם היומן").fill("ראשי");
    const lock = page.getByRole("group", { name: "יומן נוסף זמין במסלול צוות" });
    await expect(lock).toBeVisible();
    await lock.getByRole("button", { name: "לעבור לצוות" }).click();

    await expect(page.getByText(/מסלול: צוות/)).toBeVisible();
    await expect(page.getByRole("button", { name: "הוספה", exact: true })).toBeVisible();
    await expect(page.getByLabel("שם היומן")).toHaveValue("ראשי");
  });

  const openBilling = async (page: Page, businessId: string) => {
    await page.goto(`/manage?business=${businessId}&tab=business&panel=billing`);
    await ready(page);
    await expect(page.getByText("המסלולים")).toBeVisible({ timeout: 15_000 });
  };

  test("an owner upgrades from the billing tab, and is told when it applies first", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({ name: `שדרוג בעלים ${Date.now()}`, ownerPhone, plan: "SOLO" });
    await signInDirectly(page, ownerPhone, "בעלים");
    await openBilling(page, shop.business.id);

    await page.getByRole("radio", { name: /צוות/ }).check();
    await expect(page.getByText(/השדרוג חל מיד/)).toBeVisible();
    await page.getByRole("button", { name: "עוברים לצוות עכשיו" }).click();

    await expect(page.locator(".plan-choice.on").getByText("המסלול שלכם")).toBeVisible({ timeout: 15_000 });
    const billing = await call<{ subscription: { plan: string; resourceAllowance: number } }>(
      `/businesses/${shop.business.id}/subscription`,
      { token: shop.owner.token },
    );
    expect(billing.subscription).toMatchObject({ plan: "TEAM", resourceAllowance: 5 });
  });

  test("an owner moving to Solo chooses which calendar stays, and the other pauses", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({ name: `הורדה ${Date.now()}`, ownerPhone });
    await call(`/businesses/${shop.business.id}/resources`, {
      method: "POST",
      token: shop.owner.token,
      body: { name: "כיסא שני" },
    });
    await signInDirectly(page, ownerPhone, "בעלים");
    await openBilling(page, shop.business.id);

    await page.getByRole("radio", { name: /יחיד/ }).check();
    await expect(page.getByText(/איזה יומן נשאר/)).toBeVisible();
    // Among the calendars, not the plans: "יומן אחד" on the Solo card reads alike.
    await page.locator(".keep-row", { hasText: "יומן א" }).getByRole("radio").check();
    await page.getByRole("button", { name: "עוברים ליחיד עכשיו" }).click();

    await expect(page.locator(".plan-choice.on").getByText("המסלול שלכם")).toBeVisible({ timeout: 15_000 });
    const calendars = await call<{ name: string; paused: boolean }[]>(
      `/businesses/${shop.business.id}/resources`,
      { token: shop.owner.token },
    );
    expect(calendars.find((calendar) => calendar.name === "כיסא שני")?.paused).toBe(true);
  });
});

/**
 * A gap between two things on the day is free time, but only a gap at least as
 * long as the shortest service can hold an appointment — so only such a gap is
 * offered for booking. The "+" on a ten-minute seam offered something nobody
 * could do.
 */
test.describe("a gap too short for any appointment", () => {
  test("is drawn, and offers no booking; a gap that fits does", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `פערים ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
      durationMinutes: 30,
    });
    const day = aDayFromNow(3);
    // Free: 09:00–10:00, 11:00–11:10, 13:00–13:20 and 15:00–15:30.
    await call(`/businesses/${shop.business.id}/resources/${shop.resource.id}/blocks`, {
      method: "POST",
      token: shop.owner.token,
      body: {
        blocks: [
          ["10:00", "11:00"],
          ["11:10", "13:00"],
          ["13:20", "15:00"],
          ["15:30", "17:00"],
        ].map(([from, until]) => ({ startAt: anInstantAt(day, from!), endAt: anInstantAt(day, until!), reason: "" })),
        upcoming: "KEEP",
      },
    });
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await openTheDayOf(page, day);
    await expect(aFreeStretch(page).first()).toBeVisible({ timeout: 15_000 });

    // Ten minutes: a seam, and nothing to tap.
    await expect(page.getByRole("button", { name: /פנוי · 10 דק׳/ })).toHaveCount(0);

    // Twenty minutes: room to draw, not to book — it can still become a change.
    await page.getByRole("button", { name: /פנוי · 20 דק׳/ }).click();
    let sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "13:00–13:20" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "תור ללקוח בשעה שנבחרה" })).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: /שינוי ביומן/ })).toBeVisible();
    await expect(sheet.getByText("הפער קצר מ־30 דקות — השירות הקצר ביותר")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    // Exactly the shortest service: bookable.
    await page.getByRole("button", { name: /פנוי · 30 דק׳/ }).click();
    sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("button", { name: "תור ללקוח בשעה שנבחרה" })).toBeVisible();
    await expect(sheet.getByText(/הפער קצר/)).toHaveCount(0);
  });
});

test.describe("the switch between customer and business, in English", () => {
  /** Each half's words, and whether they fit inside it. */
  const halves = (page: Page) =>
    page
      .getByRole("group", { name: "Switch between customer and management" })
      .getByRole("button")
      .evaluateAll((buttons) =>
        buttons.map((button) => {
          const shown = Array.from(button.querySelectorAll("span")).find(
            (span) => getComputedStyle(span).display !== "none" && span.textContent !== "",
          );
          return {
            text: shown?.textContent ?? button.textContent ?? "",
            fits: shown === undefined ? button.scrollWidth <= button.clientWidth : shown.scrollWidth <= shown.clientWidth,
          };
        }),
      );

  test("says the whole of both halves on a phone, the short way", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await useEnglish(page);
    const shop = await aBusinessWithOpenHours({ name: `Switch ${Date.now()}`, ownerPhone: uniquePhone() });
    await page.addInitScript(([key, value]) => window.localStorage.setItem(key as string, value as string), [
      "tor-now.session",
      shop.owner.token,
    ]);
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);

    await expect.poll(() => halves(page)).toEqual([
      { text: "Customer", fits: true },
      { text: "Business", fits: true },
    ]);
    // Still named in full for anybody listening rather than looking.
    await expect(page.getByRole("button", { name: "Manage business" })).toBeVisible();
  });

  test("says it in full where there is room", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await useEnglish(page);
    const shop = await aBusinessWithOpenHours({ name: `Switch ${Date.now()}`, ownerPhone: uniquePhone() });
    await page.addInitScript(([key, value]) => window.localStorage.setItem(key as string, value as string), [
      "tor-now.session",
      shop.owner.token,
    ]);
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);

    await expect.poll(() => halves(page)).toEqual([
      { text: "Customer", fits: true },
      { text: "Manage business", fits: true },
    ]);
  });
});
