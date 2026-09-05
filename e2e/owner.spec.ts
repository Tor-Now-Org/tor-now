import { expect, test, type Page } from "@playwright/test";
import {
  aBusinessWithOpenHours,
  asTyped,
  aDayFromNow,
  showTheDayOf,
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
    await showTheDayOf(page, startAt);

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
    await showTheDayOf(page, startAt);

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

    await page.getByRole("button", { name: "חודש", exact: true }).click();

    // The day with two bookings is labelled as such, and clicking it opens it.
    const busyDay = page.getByRole("button", { name: /2 תורים/ });
    await expect(busyDay).toBeVisible({ timeout: 15_000 });
    await busyDay.click();

    await expect(page.getByText("2 תורים")).toBeVisible();
    await expect(page.getByText("דנה כהן").first()).toBeVisible();
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
    // Yesterday, where the appointment now sits.
    await page.getByRole("button", { name: "חודש", exact: true }).click();
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

    await page.getByPlaceholder("חיפוש תור לפי שם או טלפון").fill("אורית");
    await expect(page.getByText("אורית שגב")).toBeVisible({ timeout: 15_000 });

    // And it opens straight into the same controls as the calendar.
    await page.getByText("אורית שגב").click();
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
