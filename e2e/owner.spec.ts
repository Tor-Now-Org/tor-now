import { expect, test, type Page } from "@playwright/test";
import {
  aBusinessWithOpenHours,
  asTyped,
  aDayFromNow,
  theNextStart,
  call,
  ready,
  movedIntoThePast,
  signInDirectly,
  uniquePhone,
} from "./support.ts";

/**
 * The owner artboards: onboarding, the day, the three schedule layers, the
 * business panel, and the customer record.
 */
/**
 * Bring the owner's screen to the day an appointment falls on.
 *
 * The month is the owner's calendar — there is no day strip to slide — so a day
 * is reached by its square, which is labelled with the date.
 */
const showOwnerDay = async (page: Page, startAt: string): Promise<void> => {
  const wanted = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(
    new Date(startAt),
  );
  await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: wanted }).click();
};

test.describe("opening a business", () => {
  test("the wizard takes five steps and puts the business in search", async ({ page }) => {
    const phone = uniquePhone();
    await signInDirectly(page, phone, "בעלים חדש");
    const name = `עסק חדש ${Date.now()}`;

    await page.goto("/onboarding");
    await ready(page);

    // 1 — details
    await expect(page.getByText("פרטי העסק")).toBeVisible();
    await page.getByLabel("שם העסק").fill(name);
    await page.getByLabel("טלפון").fill(asTyped(phone));
    await page.getByLabel("כתובת").fill("הרצל 1");
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
    await page.getByRole("button", { name: "המשך" }).click();

    // 5 — hours, then live
    await expect(page.getByText("מתי אתם פתוחים")).toBeVisible();
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

  test("marks a no show and takes the mark off again", async ({ page }) => {
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
});

test.describe("the schedule layers", () => {
  test("a range, a day off and a block each behave as ADR 0002 says", async ({ page }) => {
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

    // Overrides: replace the weekday entirely.
    await page.getByRole("button", { name: "ימים חריגים" }).click();
    await expect(page.getByText(/יום חריג מחליף/)).toBeVisible();
    await page.getByRole("button", { name: "הוספת יום חריג" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    // Tomorrow, not today: late in the evening today is already empty because
    // the minimum notice has run past closing, and the reason under test —
    // that the override closed the day — would be hidden behind TOO_SOON.
    const closedDay = aDayFromNow(1);
    await page.getByLabel("תאריך").fill(closedDay);
    await page.getByRole("button", { name: "סגור כל היום" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "שמירה" }).click();
    // The sheet closing is what says the save went through. "סגור כל היום" is
    // also the button inside it, so matching that text proved nothing and let
    // the availability below be read before the override had landed.
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText("סגור כל היום").first()).toBeVisible({ timeout: 15_000 });

    // A closed day offers a customer nothing at all.
    await expect
      .poll(
        async () => {
          const days = await call<{ slots: unknown[]; emptyReason: string | null }[]>(
            `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
              `&resourceId=${shop.resource.id}&from=${closedDay}&to=${closedDay}`,
          );
          return { slots: days[0]?.slots.length ?? -1, reason: days[0]?.emptyReason };
        },
        { timeout: 15_000 },
      )
      .toEqual({ slots: 0, reason: "CLOSED" });
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
 * The two layers above the week: a date that replaces it, and a blockage that
 * carves time out of it. Both used to take one date and one stretch, so a
 * holiday was a week of identical forms and a lunch break was a form a day.
 */
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

  /** A date in the month now shown, as the grid labels it. */
  const dayCell = (page: Page, date: string) => page.getByRole("button", { name: date });

  test("takes a range in two taps and blocks every day of it", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({
      name: `חודש ${Date.now()}`,
      ownerPhone,
      hours: { start: "09:00", end: "17:00" },
    });
    await openTheMonth(page, shop);

    const first = aDayFromNow(1);
    const last = aDayFromNow(3);

    // What, then when, then the details: the + names the action, the grid asks
    // which days, and only the last step asks anything that needs both.
    await page.getByRole("button", { name: "הוספה ליום" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^חסימה/ }).click();
    await expect(page.getByText("בחירת ימים לחסימה")).toBeVisible();

    await dayCell(page, first).click();
    await dayCell(page, last).click();
    await expect(page.getByText(/3 ימים/).first()).toBeVisible();
    await page.getByRole("button", { name: "המשך" }).click();

    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText(/3 ימים/)).toBeVisible();
    await sheet.getByRole("button", { name: "כל היום" }).click();
    await sheet.getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // Three days of the customer's month are gone, from one gesture.
    for (const date of [first, aDayFromNow(2), last]) {
      const days = await call<{ slots: unknown[] }[]>(
        `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
          `&resourceId=${shop.resource.id}&from=${date}&to=${date}`,
      );
      expect(days[0]?.slots ?? []).toHaveLength(0);
    }
    // And the day after is untouched, so the range ended where it was told.
    const after = await call<{ slots: unknown[] }[]>(
      `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
        `&resourceId=${shop.resource.id}&from=${aDayFromNow(4)}&to=${aDayFromNow(4)}`,
    );
    expect((after[0]?.slots ?? []).length).toBeGreaterThan(0);
  });

  test("shows that blockage as one band, and takes it back as one", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({
      name: `רצועה ${Date.now()}`,
      ownerPhone,
      hours: { start: "09:00", end: "17:00" },
    });
    await openTheMonth(page, shop);

    await page.getByRole("button", { name: "הוספה ליום" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^חסימה/ }).click();
    await dayCell(page, aDayFromNow(1)).click();
    await dayCell(page, aDayFromNow(2)).click();
    await page.getByRole("button", { name: "המשך" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "כל היום" }).click();
    await page.getByRole("dialog").getByLabel("הערה (לא חובה)").fill("ספק");
    await page.getByRole("dialog").getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // One band for the whole thing, not a mark per day.
    const band = page.getByRole("button", { name: "חסום", exact: true }).first();
    await expect(band).toBeVisible({ timeout: 15_000 });
    await band.click();

    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText(/2 ימים/)).toBeVisible();
    await sheet.getByRole("button", { name: /הסרה של כל/ }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // Both days come back, because the group went as one.
    await expect
      .poll(
        async () => {
          const days = await call<{ slots: unknown[] }[]>(
            `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
              `&resourceId=${shop.resource.id}&from=${aDayFromNow(1)}&to=${aDayFromNow(1)}`,
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

    await dayCell(page, aDayFromNow(1)).click();

    // The timeline below is the day that was tapped, on the same screen — and
    // the calendar offers nothing else, because nothing was asked for.
    await expect(page.getByRole("button", { name: /פנוי/ }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "המשך" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "ביטול הבחירה" })).toHaveCount(0);
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
    await page.getByRole("button", { name: date }).click();
    await expect(page.getByRole("button", { name: /פנוי/ }).first()).toBeVisible({
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
    await page.getByRole("button", { name: /פנוי/ }).first().click();
    await page.getByRole("button", { name: /פנוי/ }).first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(shop.resource.name)).toBeVisible();
    // The whole stretch is what the sheet arrives with, so one tap blocks it.
    await sheet.getByRole("button", { name: /^חסימה ·/ }).click();
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
    await openTheDay(page, shop, date);

    await page.getByRole("button", { name: /פנוי/ }).first().click();
    await page.getByRole("button", { name: /פנוי/ }).first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    // An empty day is eight hours long and almost nobody means all of it. The
    // ordinary lengths are one tap, and the button then says what it will do.
    await sheet.getByRole("button", { name: "שעה", exact: true }).click();
    await sheet.getByRole("button", { name: /^חסימה ·/ }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // The hour is gone and the rest of the day is not: blocking a stretch no
    // longer costs the owner the whole afternoon.
    await expect
      .poll(
        async () => {
          const days = await call<{ slots: { startAt: string }[] }[]>(
            `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
              `&resourceId=${shop.resource.id}&from=${date}&to=${date}`,
          );
          return (days[0]?.slots ?? []).length;
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
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

    // Eleven empty hours are one band rather than a scroll.
    const fold = page.getByRole("button", { name: /פנוי/ }).first();
    await expect(fold).toBeVisible();
    await fold.click();

    // Opened, the same stretch is there to be acted on rather than hidden.
    await expect(page.getByRole("dialog").or(page.getByRole("button", { name: /פנוי/ }).first()))
      .toBeVisible();
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

    const hers = await bookFor(shop, { givenName: "יעל", familyName: "כהן" }, first);
    await bookFor(shop, { givenName: "יעל", familyName: "אלון" }, second);

    await signInDirectly(page, uniquePhone(), "צופה");
    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await showOwnerDay(page, first);

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
    expect(hers).not.toBe("");

    // And the whole day is one tap back.
    await page.getByRole("button", { name: "ניקוי" }).first().click();
    await expect(page.getByRole("button", { name: /פנוי/ }).first()).toBeVisible({
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

    await page.getByLabel("חיפוש תור לפי שם או טלפון").fill("נועה");
    await page.getByRole("button", { name: /לקוח\s+נועה שדה/ }).click({ timeout: 15_000 });

    // A named person opens at everything: "when is she next in" is rarely
    // about today.
    await expect(page.getByText("2 תורים")).toBeVisible();
    await page.getByRole("button", { name: "היום" }).click();
    await expect(page.getByText("1 תורים")).toBeVisible();
    await page.getByRole("button", { name: "הכול" }).click();
    await expect(page.getByText("2 תורים")).toBeVisible();

    await page.getByRole("button", { name: "ניקוי" }).first().click();
    await expect(page.getByRole("button", { name: /פנוי/ }).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("the sheet chooses kinds, and the button says how many are set", async ({ page }) => {
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
    await expect(page.getByRole("button", { name: /פנוי/ }).first()).toBeVisible({
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
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: date }).click();
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
    await page.getByRole("dialog").getByRole("button", { name: /^חסימה/ }).click();
    await expect(page.getByText("בחירת ימים לחסימה")).toBeVisible();
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
    await page.getByRole("dialog").getByRole("button", { name: /^חסימה/ }).click();
    await expect(page.getByText(/אי אפשר לשנות ימים שכבר עברו/)).toBeVisible();

    // Yesterday's square refuses the tap; tomorrow's takes it.
    const yesterdayCell = page.getByRole("button", { name: aDayFromNow(-1) });
    if ((await yesterdayCell.count()) > 0) {
      await expect(yesterdayCell).toBeDisabled();
    }
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
    await page.getByRole("dialog").getByRole("button", { name: /^חסימה/ }).click();
    await page.getByRole("button", { name: date }).click();
    await page.getByRole("button", { name: "המשך" }).click();

    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "חלק מהיום" }).click();
    await sheet.locator('input[type="time"]').first().fill("10:00");
    await sheet.locator('input[type="time"]').nth(1).fill("12:00");
    await sheet.getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // Two hours gone from what a customer is offered, and the rest still there.
    const before = 8 * 2; // 09:00–17:00 at half-hour steps
    await expect.poll(async () => offeredOn(shop, date), { timeout: 15_000 })
      .toBeLessThan(before);
    expect(await offeredOn(shop, date)).toBeGreaterThan(0);
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
    await page.getByRole("dialog").getByRole("button", { name: /יום מיוחד/ }).click();
    await page.getByRole("button", { name: date }).click();
    await page.getByRole("button", { name: "המשך" }).click();

    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "סגור כל היום" }).click();
    await sheet.getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    await expect.poll(async () => offeredOn(shop, date), { timeout: 15_000 }).toBe(0);

    // And the same day given hours instead: the special day replaces itself.
    await page.getByRole("button", { name: "הוספה ליום" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /יום מיוחד/ }).click();
    await page.getByRole("button", { name: date }).click();
    await page.getByRole("button", { name: "המשך" }).click();
    const again = page.getByRole("dialog");
    await again.getByRole("button", { name: "שעות אחרות" }).click();
    await again.locator('input[type="time"]').first().fill("10:00");
    await again.locator('input[type="time"]').nth(1).fill("12:00");
    await again.getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    await expect.poll(async () => offeredOn(shop, date), { timeout: 15_000 }).toBeGreaterThan(0);
  });
});

test.describe("special days and blockages", () => {
  const anOwnerAt = async (name: string) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({
      name: `${name} ${Date.now()}`,
      ownerPhone,
      hours: { start: "08:00", end: "20:00" },
    });
    return shop;
  };

  const openTheLayer = async (
    page: Page,
    shop: { business: { id: string }; owner: { token: string } },
    layer: string,
  ) => {
    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await page.getByRole("button", { name: "לוח זמנים" }).click();
    await page.getByRole("button", { name: layer }).click();
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
    await openTheLayer(page, shop, "ימים חריגים");

    const day = aDayFromNow(1);
    await page.getByRole("button", { name: "הוספת יום חריג" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await sheet.getByLabel("תאריך").fill(day);
    await sheet.getByRole("button", { name: "שעות אחרות" }).click();

    // Morning, then a break, then the evening — one form, not two special days
    // (which the store could not have held anyway: one override per date).
    await sheet.locator('input[type="time"]').first().fill("09:00");
    await sheet.locator('input[type="time"]').nth(1).fill("11:00");
    await sheet.getByRole("button", { name: "הוספת טווח שעות" }).click();
    await sheet.locator('input[type="time"]').nth(2).fill("17:00");
    await sheet.locator('input[type="time"]').nth(3).fill("19:00");
    // No "break" between them here: on a special day the owner is saying which
    // hours are open, and the gap is simply the hours that are not. The word
    // belongs to the weekly hours, where it names a real thing.
    await expect(sheet.getByText(/הפסקה/)).toHaveCount(0);

    await sheet.getByRole("button", { name: "שמירה" }).click();
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
    await openTheLayer(page, shop, "חסימות");

    const first = aDayFromNow(1);
    const last = aDayFromNow(2);
    await page.getByRole("button", { name: "הוספת חסימה" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("מתאריך").fill(first);
    await sheet.getByLabel("עד תאריך").fill(last);
    await sheet.getByRole("button", { name: "כל היום" }).click();
    await sheet.getByLabel("סיבה").fill("חופשה");
    await sheet.getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // Both days are gone for a customer, from one form.
    await expect.poll(async () => (await offeredOn(shop, first)).length, { timeout: 15_000 })
      .toBe(0);
    expect(await offeredOn(shop, last)).toHaveLength(0);
    // And still bookable the day after, so the range ended where it was told to.
    expect((await offeredOn(shop, aDayFromNow(3))).length).toBeGreaterThan(0);
  });

  test("and can keep the same hours free on each of those days", async ({ page }) => {
    const shop = await anOwnerAt("שעה קבועה");
    await openTheLayer(page, shop, "חסימות");

    const first = aDayFromNow(1);
    const last = aDayFromNow(2);
    await page.getByRole("button", { name: "הוספת חסימה" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("מתאריך").fill(first);
    await sheet.getByLabel("עד תאריך").fill(last);
    await sheet.locator('input[type="time"]').first().fill("10:00");
    await sheet.locator('input[type="time"]').nth(1).fill("11:00");
    await sheet.getByRole("button", { name: "הוספת טווח שעות" }).click();
    await sheet.locator('input[type="time"]').nth(2).fill("14:00");
    await sheet.locator('input[type="time"]').nth(3).fill("15:00");
    await sheet.getByLabel("סיבה").fill("שיעור");
    await sheet.getByRole("button", { name: "שמירה" }).click();
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
    await page.goto("/");
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
    await expect(page.getByRole("button", { name: "ימים חריגים" })).toBeVisible();
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

    const profile = await call<{ services: { name: string; durationMinutes: number }[] }>(
      `/businesses/${shop.business.id}`,
    );
    expect(profile.services.map((service) => service.name)).toContain("צבע");
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

    await expect(page.getByText(/שינוי כאן משפיע/)).toBeVisible();
    await page.getByLabel(/עד כמה רחוק אפשר לתפוס תור/).fill("1");
    await page.getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByText("ההגדרות נשמרו.")).toBeVisible({ timeout: 15_000 });

    const profile = await call<{ business: { bookingHorizonDays: number } }>(
      `/businesses/${shop.business.id}`,
    );
    expect(profile.business.bookingHorizonDays).toBe(1);
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

    // Two on one day, so the square carries a number rather than a mark.
    const when = (hour: number) => {
      const now = new Date();
      return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2, hour, 0),
      ).toISOString();
    };
    for (const hour of [6, 8]) {
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

    // The squares are dated, and tapping one draws that day underneath — where
    // both bookings are, which is more than a count ever said.
    await page.getByRole("button", { name: aDayFromNow(2) }).click();
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
    await page.getByRole("button", { name: new RegExp(`^${yesterday()}`) }).click();

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
    await expect(sheet.getByText("אורית שגב")).toBeVisible();
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
    await signInDirectly(page, ownerPhone, "בעלים");
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);

    await page.getByPlaceholder("חיפוש תור לפי שם או טלפון").fill("0500000000");
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
    await page.getByRole("button", { name: "ביטול התור" }).click();

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

    await expect(page.getByText("בעלים").first()).toBeVisible({ timeout: 15_000 });
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
    await page.goto("/");
    await ready(page);
    await page.getByPlaceholder("מספרה, קליניקה, מאמן אישי…").fill(shop.business.name.slice(0, 8));
    await page.getByText(shop.business.name).first().click();
    await expect(page.getByText(shop.service.name).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("region", { name: "תמונות מהעסק" })).toHaveCount(0);
  });

  test("a cover chosen in the wizard is on the business page afterwards", async ({ page }) => {
    const phone = uniquePhone();
    await signInDirectly(page, phone, "בעלים עם תמונות");
    const name = `עסק מצולם ${Date.now()}`;

    await page.goto("/onboarding");
    await ready(page);

    await page.getByLabel("שם העסק").fill(name);
    await page.getByLabel("טלפון").fill(asTyped(phone));
    await page.getByLabel("כתובת").fill("הרצל 2");
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
    await page.goto("/");
    await ready(page);
    await page.getByPlaceholder("מספרה, קליניקה, מאמן אישי…").fill(name.slice(0, 8));
    await page.getByText(name).first().click();
    const gallery = page.getByRole("region", { name: "תמונות מהעסק" });
    await expect(gallery).toBeVisible({ timeout: 15_000 });
    await expect(gallery.getByRole("button")).toHaveCount(2);

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

    await expect(page.getByRole("button", { name: "יומן ב" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "יומן ג" })).toBeVisible();
    await expect(page.getByRole("button", { name: "יומן א" })).toHaveCount(0);

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

  /** The + names the action, then the grid asks which days, then the details. */
  const aimAtDays = async (page: Page, what: string, days: readonly string[]) => {
    await page.getByRole("button", { name: "הוספה ליום" }).click();
    await page.getByRole("button", { name: new RegExp(what) }).click();
    for (const day of days) await page.getByRole("button", { name: day }).click();
    await page.getByRole("button", { name: "המשך" }).click();
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
    const first = aDayFromNow(2);
    const last = aDayFromNow(4);
    const booked = await theNextStart(shop);
    const onFirst = `${first}T07:00:00.000Z`;
    const { token: theirs, appointment } = await aCustomerWithABooking(
      shop,
      { givenName: "נועה", familyName: "שדה" },
      onFirst,
    );
    expect(booked).toBeTruthy();

    await openTheCalendar(page, shop, shop.owner.token);
    await aimAtDays(page, "יום מיוחד לעסק", [first, last]);

    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    // The warning names the person, because "1 appointment" is not the
    // decision the owner is being asked to make.
    await expect(sheet.getByText("נועה שדה")).toBeVisible({ timeout: 15_000 });
    await expect(sheet.getByText(/יש כבר 1 תורים/)).toBeVisible();

    await sheet.getByRole("button", { name: /^סגירה וביטול/ }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // Every day of the range is shut for customers, not only the first.
    for (const date of [first, aDayFromNow(3), last]) {
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
    const day = aDayFromNow(2);
    const { token: theirs, appointment } = await aCustomerWithABooking(
      shop,
      { givenName: "רון", familyName: "לוי" },
      `${day}T07:00:00.000Z`,
    );

    await openTheCalendar(page, shop, shop.owner.token);
    await aimAtDays(page, "יום מיוחד לעסק", [day]);

    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "סגירה בלי לבטל תורים" }).click();
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
    const first = aDayFromNow(2);
    const last = aDayFromNow(4);

    await openTheCalendar(page, shop, shop.owner.token);
    await aimAtDays(page, "יום מיוחד לעסק", [first, last]);

    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("אין תורים בימים האלה.")).toBeVisible({ timeout: 15_000 });
    await sheet.getByLabel("הערה (לא חובה)").fill("חופשה");
    await sheet.getByRole("button", { name: "שמירה", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // One band across the three days rather than three squares each saying so.
    // It says what it is; the words the owner typed are in the sheet.
    const band = page.getByRole("button", { name: "סגור", exact: true });
    await expect(band.first()).toBeVisible({ timeout: 15_000 });

    await band.first().click();
    const closure = page.getByRole("dialog");
    await expect(closure.getByText("חופשה")).toBeVisible();
    await expect(closure.getByText(/· 3 ימים/).first()).toBeVisible();
    await closure.getByRole("button", { name: /^ביטול הסגירה/ }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // The days are bookable again — and the band is gone with them.
    await expect.poll(async () => slotsOn(shop, first), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: "סגור", exact: true })).toHaveCount(0);
  });

  test("is not offered to a worker, who may still block their own calendar", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `הרשאות ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
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
    const sheet = page.getByRole("dialog");
    // Their own time is theirs to keep; the shop's days are not theirs to say.
    await expect(sheet.getByText("חסימה")).toBeVisible();
    await expect(sheet.getByText("יום מיוחד לעסק")).toHaveCount(0);
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

    // A hidden button is a courtesy; this is the rule.
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
    await page.getByRole("button", { name: day }).click();

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
      expect(one.width).toBe("3px");
    });

    // The same service keeps one colour; a different one is told apart.
    expect(painted[0]?.background).toBe(painted[2]?.background);
    expect(painted[1]?.background).not.toBe(painted[0]?.background);
  });

  test("keeps the + out of the way of any sheet, including the filter", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `כפתור ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);

    const plus = page.getByRole("button", { name: "הוספה ליום" });
    await expect(plus).toBeVisible({ timeout: 15_000 });

    // The filter is a sheet like any other, and the + used to sit on top of it.
    await page.getByRole("button", { name: "סינון" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(plus).toBeHidden();

    await page.getByRole("button", { name: "הצגת התוצאות" }).click();
    await expect(plus).toBeVisible({ timeout: 15_000 });
  });

  test("takes a removed blockage off the open day without being reopened", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `רענון ${Date.now()}`,
      ownerPhone: uniquePhone(),
      hours: { start: "09:00", end: "17:00" },
    });
    const first = aDayFromNow(2);
    const last = aDayFromNow(3);
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
    await page.getByRole("button", { name: first }).click();
    await expect(page.getByRole("button", { name: /השתלמות/ }).first()).toBeVisible({
      timeout: 15_000,
    });

    // The band in the month, which is where a blockage spanning days is undone.
    await page.getByRole("button", { name: "חסום", exact: true }).first().click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: /^הסרה של כל/ }).click();
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

  const aimAt = async (page: Page, what: string, days: readonly string[]) => {
    await page.getByRole("button", { name: "הוספה ליום" }).click();
    await page.getByRole("button", { name: new RegExp(what) }).click();
    for (const day of days) await page.getByRole("button", { name: day }).click();
    await page.getByRole("button", { name: "המשך" }).click();
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

    await aimAt(page, "חסימה", [day]);
    const sheet = page.getByRole("dialog");
    // The same warning the shop closing gives, because it costs the same thing.
    await expect(sheet.getByText("מיכל אבן")).toBeVisible({ timeout: 15_000 });
    await sheet.getByRole("button", { name: /^חסימה וביטול/ }).click();
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

    await aimAt(page, "חסימה", [day]);
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "חסימה בלי לבטל תורים" }).click();
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

    await aimAt(page, "יום מיוחד לעסק", [day]);
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    // A sheet whose only exits are "do it" and a tap on the backdrop is one
    // people learn to distrust.
    await sheet.getByRole("button", { name: "ביטול הבחירה" }).click();
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
    // and why. A narrower one keeps the reason and leaves whose to its colour.
    const days = [aDayFromNow(2), aDayFromNow(3), aDayFromNow(4)];
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

    // The band says what it is and whose it is — short enough to be taken in
    // at a glance, with the reason in the sheet behind it.
    const band = page.getByRole("button", { name: "חסום (יומן א)" });
    await expect(band.first()).toBeVisible({ timeout: 15_000 });

    await band.first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("יומן א")).toBeVisible();
    await expect(sheet.getByText("מילואים")).toBeVisible();
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

    await openCalendar(page, shop, shop.owner.token);

    // It used to be a slightly paler square and nothing else: no band, nothing
    // to tap, and the only way to find it was the schedule screen.
    const band = page.getByRole("button", { name: "קצר" });
    await expect(band.first()).toBeVisible({ timeout: 15_000 });

    await band.first().click();
    const sheet = page.getByRole("dialog");
    // The hours are in the sheet, which is where there is room for them.
    await expect(sheet.getByText("09:00–12:00")).toBeVisible();
    await expect(sheet.getByText("ערב חג")).toBeVisible();
    await sheet.getByRole("button", { name: /^ביטול הסגירה/ }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // Back on its usual hours: the afternoon is bookable again.
    await expect
      .poll(
        async () => {
          const days = await call<{ slots: { startAt: string }[] }[]>(
            `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
              `&resourceId=${shop.resource.id}&from=${day}&to=${day}`,
          );
          return (days[0]?.slots ?? []).filter((slot) => slot.startAt >= `${day}T12:00`).length;
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
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
    await expect(page.getByRole("button", { name: "סגור" }).first()).toBeVisible({
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
    await page.getByRole("button", { name: "ימים חריגים" }).click();

    await expect(page.getByText("כל העסק")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "מחיקה" }).first().click();

    // Gone for every calendar, in one go — and gone from this list with it.
    await expect(page.getByText("כל העסק")).toHaveCount(0, { timeout: 15_000 });
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
    await page.getByRole("button", { name: /יום מיוחד לעסק/ }).click();
    await page.getByRole("button", { name: day }).click();
    await page.getByRole("button", { name: "המשך" }).click();

    // Whose chair it is, because closing touches every calendar and a list of
    // names says nothing about which of them loses their afternoon.
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("שירה כהן")).toBeVisible({ timeout: 15_000 });
    await expect(sheet.getByText(new RegExp(`· ${shop.resource.name}`))).toBeVisible();
  });
});

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
    const days = [aDayFromNow(2), aDayFromNow(5)];
    await blockOn(shop, shop.resource.id, days[0]!, "רופא");
    await blockOn(shop, shop.resource.id, days[1]!, "ספק");

    await openMonth(page, shop);

    for (const date of days) {
      await expect(page.getByRole("button", { name: date })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "חסום", exact: true })).toHaveCount(2, {
      timeout: 15_000,
    });
    // One line holds both, so nothing had to fold.
    await expect(page.getByRole("button", { name: /עוד \d+ בשבוע/ })).toHaveCount(0);

    // And both are still openable, because nothing is buried.
    await page.getByRole("button", { name: "חסום", exact: true }).first().click();
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
    const days = [2, 3, 4, 5].map((ahead) => aDayFromNow(ahead));
    for (const [at, date] of days.entries()) {
      await blockOn(shop, shop.resource.id, date, `סיבה ${at}`);
    }

    await openMonth(page, shop);

    const bar = page.getByRole("button", { name: "חסום", exact: true });
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
    await page.getByRole("button", { name: "כל היומנים" }).click();

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
    const thisMonth = aDayFromNow(0).slice(0, 7);
    let from = "";
    for (let ahead = 1; ahead < 25; ahead += 1) {
      const date = aDayFromNow(ahead);
      if (
        new Date(`${date}T00:00:00Z`).getUTCDay() === 0 &&
        date.startsWith(thisMonth) &&
        aDayFromNow(ahead + 1).startsWith(thisMonth)
      ) {
        from = date;
        break;
      }
    }
    expect(from).not.toBe("");
    const to = aDayFromNow(
      Math.round((Date.parse(`${from}T00:00:00Z`) - Date.parse(`${aDayFromNow(0)}T00:00:00Z`)) / 86_400_000) + 1,
    );

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
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });

    const band = await page.getByRole("button", { name: "סגור" }).first().boundingBox();
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
    const busy = aDayFromNow(2);
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
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });

    // A day in the week that has a blockage, and one in a week that has none.
    const withBand = await page.getByRole("button", { name: busy }).boundingBox();
    const quiet = await page.getByRole("button", { name: aDayFromNow(9) }).boundingBox();
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
  test("gives a calendar one band a day however many blockages it has", async ({ page }) => {
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

    // Five separate all-day blockages on one day across two chairs — the shape
    // that turned a single square into a wall of bars.
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

    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "כל היומנים" }).click();

    // Two bars, one per chair — not five, and not a fold either.
    const bands = page.getByRole("button", { name: "חסום", exact: true });
    await expect(bands).toHaveCount(2, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: /עוד \d+ בשבוע/ })).toHaveCount(0);

    // A bar standing in for several decisions opens the list of them — where
    // there is room to name each one. Nothing was said about these, so they
    // are named for what they are rather than described in a sentence.
    await bands.first().click();
    const list = page.getByRole("dialog");
    await expect(list.getByText("מה יש בשבוע הזה")).toBeVisible();
    await expect(list.getByText("חסימה", { exact: true })).toHaveCount(5);
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
    const square = page.getByRole("button", { name: day });
    await expect(square).toBeVisible({ timeout: 15_000 });
    await expect(square.locator("i")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "חסום", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "לקוחה בדיקה" })).toHaveCount(0);

    // The day itself is where they are read.
    await square.click();
    await expect(page.getByRole("button", { name: /לקוחה בדיקה/ }).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
