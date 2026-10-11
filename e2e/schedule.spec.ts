import { expect, test, type Locator, type Page } from "@playwright/test";
import { aBookingAt, aChange, aMember, aTwoCalendarShop, forWhom, outcome, save, theSheet, type Shop } from "./change-support.ts";
import {
  aWeekOf,
  changeRows,
  confirmDay,
  dayRow,
  daySheet,
  openDay,
  openTheSchedule,
  otherDays,
  saveButton,
  saveTheHours,
  showChangesOf,
  storedWeekOf,
  times,
  usualCard,
} from "./schedule-support.ts";
import { aBusinessWithOpenHours, aDayFromNow, call, uniquePhone, useEnglish } from "./support.ts";

/**
 * The schedule, every case the approved design lists: the usual hours as one
 * card with its timeline, the days that differ as rows opening one day at a
 * time, one pinned save that asks before unsaved hours are left behind, and
 * the changes as dated rows — a calendar's with the business's marked among
 * them. Each journey checks the store, or what a customer is offered, as well
 * as the screen.
 */

const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"] as const;

/** The names a group's buttons are read out by, without the coloured initial beside each. */
const namesOf = (buttons: Locator) =>
  buttons.evaluateAll((all) =>
    all.map((button) =>
      Array.from(button.childNodes)
        .filter((node) => !(node instanceof Element && node.getAttribute("aria-hidden") === "true"))
        .map((node) => node.textContent ?? "")
        .join("")
        .trim(),
    ),
  );

const calendarChips = (page: Page) => page.getByRole("group", { name: "איזה יומן" });
const explain = (page: Page) => page.locator(".week-explain").first();

test.describe("the usual hours: whose week", () => {
  test("one calendar: no calendars to choose between, and the line names it", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({ name: `יומן יחיד ${Date.now()}`, ownerPhone: uniquePhone(), hours: { start: "09:00", end: "17:00" } });
    await openTheSchedule(page, shop.owner.token, shop.business.id);

    await expect(page.getByRole("tab", { name: "שעות קבועות" })).toHaveAttribute("aria-selected", "true");
    await expect(calendarChips(page)).toHaveCount(0);
    await expect(explain(page)).toHaveText(
      "השעות הקבועות ביומן א בשבוע רגיל. לקוחות יכולים לקבוע תור רק בשעות האלה, ותורים שכבר נקבעו לא זזים.",
    );
    // The same hours every day: every day on the usual, none listed apart.
    for (const day of DAYS) await expect(usualCard(page).getByRole("button", { name: day, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(otherDays(page)).toHaveCount(0);
    await expect(times(usualCard(page)).first()).toHaveValue("09:00");
    await expect(times(usualCard(page)).nth(1)).toHaveValue("17:00");
  });

  test("several calendars, in their colours; a hidden one is not offered, and each names itself", async ({ page }) => {
    const shop = await aTwoCalendarShop("שלושה יומנים");
    const hidden = await call<{ id: string }>(`/businesses/${shop.business.id}/resources`, {
      method: "POST",
      token: shop.owner.token,
      body: { name: "מוסתר" },
    });
    await call(`/businesses/${shop.business.id}/resources/${hidden.id}`, { method: "PATCH", token: shop.owner.token, body: { active: false } });
    await openTheSchedule(page, shop.owner.token, shop.business.id);

    const chips = calendarChips(page).getByRole("button");
    expect(await namesOf(chips)).toEqual(["יומן א", "שימי"]);
    // Each wears the colour its lane wears on the day, as a coloured initial.
    await expect(chips.first().locator('span[aria-hidden="true"]')).toHaveText("י");
    await expect(chips.first()).toHaveAttribute("aria-pressed", "true");
    await expect(explain(page)).toContainText("ביומן א");

    await chips.nth(1).click();
    await expect(chips.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(explain(page)).toContainText("ביומן של שימי");
    await expect(usualCard(page)).toBeVisible({ timeout: 15_000 });
  });

  test("a worker has their own calendar only, and changes its hours", async ({ page }) => {
    const shop = await aTwoCalendarShop("עובדת שעות");
    const worker = await aMember(shop, "WORKER", [shop.second.id]);
    const usual = await openTheSchedule(page, worker.token, shop.business.id);

    await expect(calendarChips(page)).toHaveCount(0);
    await expect(explain(page)).toContainText("ביומן של שימי");
    await times(usual).nth(1).fill("15:00");
    await saveTheHours(page);
    expect((await storedWeekOf(shop, shop.second.id))(2)).toEqual(["09:00-15:00"]);
    expect((await storedWeekOf(shop, shop.resource.id))(2)).toEqual(["09:00-17:00"]);
  });
});

test.describe("the usual hours: setting them", () => {
  test("nothing set yet: says why, waits for a day, and saves the hours on the days chosen", async ({ page }) => {
    const shop = await aTwoCalendarShop("בלי שעות");
    await aWeekOf(shop, shop.resource.id, {});
    const usual = await openTheSchedule(page, shop.owner.token, shop.business.id);

    await expect(usual.getByRole("heading", { name: "עוד לא נקבעו שעות" })).toBeVisible();
    await expect(usual.getByText("בלי שעות, לקוחות לא יכולים לקבוע תור.")).toBeVisible();
    await expect(usual.getByText("בוחרים לפחות יום אחד כדי לשמור.")).toBeVisible();
    await expect(saveButton(page)).toBeDisabled();
    // Seven days off are not "days that differ": there is no usual to differ from.
    await expect(otherDays(page)).toHaveCount(0);
    for (const day of DAYS) await expect(usual.getByRole("button", { name: day, exact: true })).toHaveAttribute("aria-pressed", "false");

    // The hours first, then the days that keep them.
    await times(usual).first().fill("10:00");
    await times(usual).nth(1).fill("18:00");
    await usual.getByRole("button", { name: "שני", exact: true }).click();
    await usual.getByRole("button", { name: "רביעי", exact: true }).click();
    await expect(usual.getByRole("heading", { name: "השעות הרגילות" })).toBeVisible();
    await expect(saveButton(page)).toBeEnabled();
    // The rest are now days off, each a row.
    await expect(dayRow(page, "ראשון")).toContainText("לא עובדים");

    await saveTheHours(page);
    const stored = await storedWeekOf(shop, shop.resource.id);
    expect(stored(1)).toEqual(["10:00-18:00"]);
    expect(stored(3)).toEqual(["10:00-18:00"]);
    for (const day of [0, 2, 4, 5, 6]) expect(stored(day)).toEqual([]);
  });

  test("taking every day off the usual brings back the wait for a day, and holds the save", async ({ page }) => {
    const shop = await aTwoCalendarShop("כל הימים בחוץ");
    await aWeekOf(shop, shop.resource.id, { 1: [{ start: "09:00", end: "17:00" }] });
    const usual = await openTheSchedule(page, shop.owner.token, shop.business.id);
    await usual.getByRole("button", { name: "שני", exact: true }).click();
    await openDay(page, "שני");
    await daySheet(page).getByRole("button", { name: "לא עובדים" }).click();
    await confirmDay(page);
    await expect(usual.getByRole("heading", { name: "עוד לא נקבעו שעות" })).toBeVisible();
    await expect(saveButton(page)).toBeDisabled();
  });

  test("breaks, any number: each cuts an hour out of the day, and the timeline shows them", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({ name: `הפסקות ${Date.now()}`, ownerPhone: uniquePhone(), hours: { start: "08:00", end: "20:00" } });
    const usual = await openTheSchedule(page, shop.owner.token, shop.business.id);

    await usual.getByRole("button", { name: "+ הוספת הפסקה" }).click();
    await expect(times(usual)).toHaveCount(4);
    await expect(usual.getByText("הפסקה · 13:00–14:00")).toBeVisible();
    await usual.getByRole("button", { name: "+ הוספת הפסקה" }).click();
    await expect(times(usual)).toHaveCount(6);
    await expect(usual.getByText("הפסקה · 16:00–17:00")).toBeVisible();
    // The bar under them draws three stretches.
    await expect(usual.locator('[aria-hidden="true"] > div > span[style*="gradient"]')).toHaveCount(3);

    await saveTheHours(page);
    expect((await storedWeekOf(shop, shop.resource.id))(1)).toEqual(["08:00-13:00", "14:00-16:00", "17:00-20:00"]);

    // And one taken away again by its ×.
    await usual.getByRole("button", { name: "מחיקה 14:00-16:00" }).click();
    await expect(times(usual)).toHaveCount(4);
  });

  test("overlapping stretches say the one range they will be saved as", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({ name: `חפיפה ${Date.now()}`, ownerPhone: uniquePhone(), hours: { start: "09:00", end: "17:00" } });
    const usual = await openTheSchedule(page, shop.owner.token, shop.business.id);
    await usual.getByRole("button", { name: "+ הוספת הפסקה" }).click();
    for (const [position, value] of ["09:00", "12:00", "13:00", "17:00"].entries()) await expect(times(usual).nth(position)).toHaveValue(value);
    await times(usual).nth(2).fill("11:00");
    await expect(usual.getByText("חופף לטווח הקודם. יישמר כטווח אחד, 09:00–17:00.")).toBeVisible();
    await saveTheHours(page);
    expect((await storedWeekOf(shop, shop.resource.id))(0)).toEqual(["09:00-17:00"]);
  });

  test("a half-typed time is marked, said, and holds the save — in the usual and in a day's sheet", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({ name: `שעה חסרה ${Date.now()}`, ownerPhone: uniquePhone(), hours: { start: "09:00", end: "17:00" } });
    const usual = await openTheSchedule(page, shop.owner.token, shop.business.id);

    await times(usual).nth(1).fill("");
    await expect(page.getByText("יש שעה שלא הושלמה. השלימו אותה כדי לשמור.")).toBeVisible();
    await expect(saveButton(page)).toBeDisabled();
    await times(usual).nth(1).fill("17:00");
    await expect(saveButton(page)).toBeEnabled();

    await usual.getByRole("button", { name: "שישי", exact: true }).click();
    const friday = await openDay(page, "שישי");
    await times(friday).nth(1).fill("");
    await expect(friday.getByText("יש שעה שלא הושלמה. השלימו אותה כדי לשמור.")).toBeVisible();
    await expect(friday.getByRole("button", { name: "אישור" })).toBeDisabled();
    // Closed anyway, the row says so and the save still waits.
    await page.keyboard.press("Escape");
    await expect(dayRow(page, "שישי")).toContainText("לא הושלם");
    await expect(saveButton(page)).toBeDisabled();
  });

  test("an end before its start is as unsaveable as a half-typed time", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({ name: `הפוך ${Date.now()}`, ownerPhone: uniquePhone(), hours: { start: "09:00", end: "17:00" } });
    const usual = await openTheSchedule(page, shop.owner.token, shop.business.id);
    await times(usual).nth(1).fill("08:00");
    await expect(saveButton(page)).toBeDisabled();
  });
});

test.describe("the days that differ", () => {
  test("a day off is a row that says so", async ({ page }) => {
    const shop = await aTwoCalendarShop("יום חופש");
    const week = Object.fromEntries([0, 1, 2, 3, 4, 5].map((day) => [day, [{ start: "09:00", end: "17:00" }]]));
    await aWeekOf(shop, shop.resource.id, week);
    await openTheSchedule(page, shop.owner.token, shop.business.id);

    await expect(otherDays(page).getByRole("listitem")).toHaveCount(1);
    await expect(dayRow(page, "שבת")).toContainText("לא עובדים");
    const saturday = await openDay(page, "שבת");
    await expect(saturday.getByRole("button", { name: "לא עובדים" })).toHaveAttribute("aria-pressed", "true");
    await expect(times(saturday)).toHaveCount(0);
    await expect(saturday.getByText("השעות ביומן א בכל יום שבת.")).toBeVisible();
  });

  test("a row shows several stretches, in the order of the day", async ({ page }) => {
    const shop = await aTwoCalendarShop("שלישי מפוצל");
    const nine = [{ start: "09:00", end: "17:00" }];
    await aWeekOf(shop, shop.resource.id, { 0: nine, 1: nine, 2: [{ start: "16:00", end: "20:00" }, { start: "09:00", end: "13:00" }], 3: nine, 4: nine });
    await openTheSchedule(page, shop.owner.token, shop.business.id);
    await expect(dayRow(page, "שלישי")).toContainText("09:00–13:00, 16:00–20:00");
  });

  test("a day that differs, then matches again, stays a row until it is put back", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({ name: `חזרה ${Date.now()}`, ownerPhone: uniquePhone(), hours: { start: "09:00", end: "17:00" } });
    const usual = await openTheSchedule(page, shop.owner.token, shop.business.id);

    await usual.getByRole("button", { name: "רביעי", exact: true }).click();
    let wednesday = await openDay(page, "רביעי");
    await times(wednesday).nth(1).fill("14:00");
    await expect(dayRow(page, "רביעי")).toContainText("09:00–14:00");
    // Back to the usual's very hours, typed: the row does not jump away under the finger.
    await times(wednesday).nth(1).fill("17:00");
    await confirmDay(page);
    await expect(dayRow(page, "רביעי")).toContainText("09:00–17:00");
    await expect(usualCard(page).getByRole("button", { name: "רביעי", exact: true })).toHaveAttribute("aria-pressed", "false");

    wednesday = await openDay(page, "רביעי");
    await wednesday.getByRole("button", { name: "להחזיר לשעות הרגילות" }).click();
    await expect(daySheet(page)).toBeHidden();
    await expect(otherDays(page)).toHaveCount(0);
    await expect(usualCard(page).getByRole("button", { name: "רביעי", exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  test("a day on the usual opened day by day offers no way back to where it already is", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({ name: `בלי חזרה ${Date.now()}`, ownerPhone: uniquePhone(), hours: { start: "09:00", end: "17:00" } });
    const usual = await openTheSchedule(page, shop.owner.token, shop.business.id);
    for (const day of ["ראשון", "שני", "שלישי", "רביעי"]) await usual.getByRole("button", { name: day, exact: true }).click();
    await page.getByRole("button", { name: "לקבוע יום אחרי יום" }).click();
    const friday = await openDay(page, "שישי");
    await expect(friday.getByRole("button", { name: "להחזיר לשעות הרגילות" })).toHaveCount(0);
  });

  test("four or more worked days apart suggest day by day: seven rows, each opening its day", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({ name: `יום אחרי יום ${Date.now()}`, ownerPhone: uniquePhone(), hours: { start: "09:00", end: "17:00" } });
    const usual = await openTheSchedule(page, shop.owner.token, shop.business.id);

    for (const day of ["ראשון", "שני", "שלישי"]) await usual.getByRole("button", { name: day, exact: true }).click();
    await expect(page.getByText("כמעט כל יום שונה. אולי נוח יותר לקבוע יום אחרי יום.")).toHaveCount(0);
    await usual.getByRole("button", { name: "רביעי", exact: true }).click();
    await expect(page.getByText("כמעט כל יום שונה. אולי נוח יותר לקבוע יום אחרי יום.")).toBeVisible();

    await page.getByRole("button", { name: "לקבוע יום אחרי יום" }).click();
    const all = page.getByRole("list", { name: "יום אחרי יום" });
    await expect(all.getByRole("listitem")).toHaveCount(7);
    await expect(usualCard(page)).toHaveCount(0);

    const saturday = await openDay(page, "שבת");
    await saturday.getByRole("button", { name: "לא עובדים" }).click();
    await confirmDay(page);
    await expect(dayRow(page, "שבת")).toContainText("לא עובדים");
    await saveTheHours(page);
    const stored = await storedWeekOf(shop, shop.resource.id);
    expect(stored(6)).toEqual([]);
    expect(stored(0)).toEqual(["09:00-17:00"]);

    await page.getByRole("button", { name: "חזרה לשעות הרגילות ולימים השונים" }).click();
    await expect(usualCard(page)).toBeVisible();
  });

  test("a business open two days a week is not told every day differs", async ({ page }) => {
    const shop = await aTwoCalendarShop("יומיים בשבוע");
    await aWeekOf(shop, shop.resource.id, { 1: [{ start: "09:00", end: "17:00" }], 3: [{ start: "09:00", end: "17:00" }] });
    await openTheSchedule(page, shop.owner.token, shop.business.id);
    await expect(otherDays(page).getByRole("listitem")).toHaveCount(5);
    await expect(page.getByText("כמעט כל יום שונה. אולי נוח יותר לקבוע יום אחרי יום.")).toHaveCount(0);
  });
});

test.describe("saving the week", () => {
  test("says it saved, and a server error keeps every edit to try again", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({ name: `שגיאה ${Date.now()}`, ownerPhone: uniquePhone(), hours: { start: "09:00", end: "17:00" } });
    const usual = await openTheSchedule(page, shop.owner.token, shop.business.id);
    await times(usual).first().fill("10:00");

    await page.route(/\/working-hours/, (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "boom" } }) })
        : route.continue(),
    );
    await saveButton(page).click();
    await expect(page.getByText("משהו השתבש אצלנו. נסו שוב.")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("השעות נשמרו")).toHaveCount(0);
    await expect(times(usual).first()).toHaveValue("10:00");
    expect((await storedWeekOf(shop, shop.resource.id))(0)).toEqual(["09:00-17:00"]);

    await page.unroute(/\/working-hours/);
    await saveTheHours(page);
    expect((await storedWeekOf(shop, shop.resource.id))(0)).toEqual(["10:00-17:00"]);
    // The line goes once the week is edited again.
    await times(usual).first().fill("11:00");
    await expect(page.getByText("השעות נשמרו")).toHaveCount(0);
  });

  test("the save stays in view however long the week is", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({ name: `כפתור צמוד ${Date.now()}`, ownerPhone: uniquePhone(), hours: { start: "09:00", end: "17:00" } });
    const usual = await openTheSchedule(page, shop.owner.token, shop.business.id);
    for (const day of ["ראשון", "שני", "שלישי"]) await usual.getByRole("button", { name: day, exact: true }).click();
    await usual.getByRole("button", { name: "+ הוספת הפסקה" }).click();
    await expect(saveButton(page)).toBeInViewport();
    await page.locator("main.scroll").evaluate((main) => main.scrollTo(0, 0));
    await expect(saveButton(page)).toBeInViewport();
  });

  test("appointments already booked outside the new hours stay where they are", async ({ page }) => {
    const shop = await aTwoCalendarShop("תור מחוץ");
    const day = aDayFromNow(3);
    const booked = await aBookingAt(shop, shop.resource.id, day, "15:00", "גלית רז");
    const usual = await openTheSchedule(page, shop.owner.token, shop.business.id);
    await expect(explain(page)).toContainText("תורים שכבר נקבעו לא זזים");
    await times(usual).nth(1).fill("13:00");
    await saveTheHours(page);

    const after = await call<{ calendars: { appointments: { id: string; status: string; startAt: string }[] }[] }>(
      `/businesses/${shop.business.id}/calendar/day?date=${day}`,
      { token: shop.owner.token },
    );
    expect(after.calendars.flatMap((one) => one.appointments).find((one) => one.id === booked.id)?.status).toBe("CONFIRMED");
  });
});

test.describe("leaving unsaved hours", () => {
  const openWithAnEdit = async (page: Page, shop: Shop) => {
    const usual = await openTheSchedule(page, shop.owner.token, shop.business.id);
    await times(usual).first().fill("10:00");
    return usual;
  };

  test("another calendar asks first: stay, or move on and drop the edit", async ({ page }) => {
    const shop = await aTwoCalendarShop("עזיבה");
    const usual = await openWithAnEdit(page, shop);
    const chips = calendarChips(page);

    await chips.getByRole("button", { name: "שימי" }).click();
    const asking = page.getByRole("dialog");
    await expect(asking.getByRole("heading", { name: "לשמור את השעות ביומן א?" })).toBeVisible();
    await asking.getByRole("button", { name: "להישאר כאן" }).click();
    await expect(asking).toBeHidden();
    await expect(chips.getByRole("button", { name: "יומן א" })).toHaveAttribute("aria-pressed", "true");
    await expect(times(usual).first()).toHaveValue("10:00");

    await chips.getByRole("button", { name: "שימי" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "מעבר בלי לשמור" }).click();
    await expect(chips.getByRole("button", { name: "שימי" })).toHaveAttribute("aria-pressed", "true");
    await chips.getByRole("button", { name: "יומן א" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(times(usualCard(page)).first()).toHaveValue("09:00", { timeout: 15_000 });
    expect((await storedWeekOf(shop, shop.resource.id))(0)).toEqual(["09:00-17:00"]);
  });

  test("the changes tab asks too, and saving goes on to it with the hours kept", async ({ page }) => {
    const shop = await aTwoCalendarShop("שמירה ומעבר");
    await openWithAnEdit(page, shop);
    await page.getByRole("tab", { name: "שינויים" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "שמירה ומעבר" }).click();
    await expect(page.getByRole("tab", { name: "שינויים" })).toHaveAttribute("aria-selected", "true", { timeout: 15_000 });
    await expect.poll(async () => (await storedWeekOf(shop, shop.resource.id))(0)).toEqual(["10:00-17:00"]);

    await page.getByRole("tab", { name: "שעות קבועות" }).click();
    await expect(times(usualCard(page)).first()).toHaveValue("10:00", { timeout: 15_000 });
  });

  test("a save that fails on the way out stays, says so, and keeps the edit", async ({ page }) => {
    const shop = await aTwoCalendarShop("נכשל בדרך");
    const usual = await openWithAnEdit(page, shop);
    await page.route(/\/working-hours/, (route) =>
      route.request().method() === "PUT" ? route.fulfill({ status: 500, body: "{}" }) : route.continue(),
    );
    await page.getByRole("tab", { name: "שינויים" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "שמירה ומעבר" }).click();
    await expect(page.getByText("משהו השתבש אצלנו. נסו שוב.")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("tab", { name: "שעות קבועות" })).toHaveAttribute("aria-selected", "true");
    await expect(times(usual).first()).toHaveValue("10:00");
  });

  test("nothing edited, nothing asked", async ({ page }) => {
    const shop = await aTwoCalendarShop("בלי שאלה");
    await openTheSchedule(page, shop.owner.token, shop.business.id);
    await calendarChips(page).getByRole("button", { name: "שימי" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("tab", { name: "שינויים" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("the changes", () => {
  /** A business's holiday, a change of יומן א's and one of שימי's, on days a few apart. */
  const aShopWithChanges = async (name: string) => {
    const shop = await aTwoCalendarShop(name);
    const [own, holiday, holidayEnd, reserve] = [aDayFromNow(2), aDayFromNow(4), aDayFromNow(6), aDayFromNow(8)];
    await aChange(shop, { scope: { kind: "CALENDAR", resourceId: shop.resource.id }, outcome: "OTHER_HOURS", fromDate: own, ranges: [{ start: "12:00", end: "16:00" }] });
    await aChange(shop, { scope: { kind: "BUSINESS" }, outcome: "OFF_ALL_DAY", fromDate: holiday, toDate: holidayEnd, note: "חופשה" });
    await aChange(shop, { scope: { kind: "CALENDAR", resourceId: shop.second.id }, outcome: "OFF_ALL_DAY", fromDate: reserve, note: "מילואים" });
    return shop;
  };

  test("a calendar lists its own and the business's, marked; the whole business lists its own", async ({ page }) => {
    const shop = await aShopWithChanges("של מי");
    await openTheSchedule(page, shop.owner.token, shop.business.id);
    await showChangesOf(page);

    const whose = page.getByRole("group", { name: "של מי השינויים" });
    expect(await namesOf(whose.getByRole("button"))).toEqual(["כל העסק", "יומן א", "שימי"]);
    await expect(whose.getByRole("button", { name: "יומן א" })).toHaveAttribute("aria-pressed", "true");
    await expect(explain(page)).toHaveText("שינויים ביומן א, וגם השינויים של כל העסק שחלים עליו. השבוע הרגיל לא משתנה.");
    let rows = changeRows(page);
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("עובדים 12:00–16:00");
    await expect(rows.nth(0).locator(".list-tag")).toHaveCount(0);
    await expect(rows.nth(1)).toContainText("חופשה");
    await expect(rows.nth(1).locator(".list-tag")).toHaveText("כל העסק");
    await expect(page.getByRole("button", { name: "הוספת שינוי ליומן א" })).toBeVisible();

    await whose.getByRole("button", { name: "שימי" }).click();
    rows = changeRows(page);
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("חופשה");
    await expect(rows.nth(1)).toContainText("מילואים");
    await expect(page.getByRole("button", { name: "הוספת שינוי לשימי" })).toBeVisible();

    await whose.getByRole("button", { name: "כל העסק" }).click();
    await expect(explain(page)).toHaveText("שינויים שחלים על כל היומנים: חופשה, חג, יום שנסגרים בו מוקדם.");
    rows = changeRows(page);
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator(".list-tag")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "הוספת שינוי לכל העסק" })).toBeVisible();

    // Back to the usual week from the whole business: the first calendar's, not nobody's.
    await page.getByRole("tab", { name: "שעות קבועות" }).click();
    await expect(calendarChips(page).getByRole("button", { name: "יומן א" })).toHaveAttribute("aria-pressed", "true");
    await expect(usualCard(page)).toBeVisible({ timeout: 15_000 });
  });

  test("the business's change, opened from a calendar, is read there and edited under the whole business", async ({ page }) => {
    const shop = await aShopWithChanges("קריאה מיומן");
    await openTheSchedule(page, shop.owner.token, shop.business.id);
    await showChangesOf(page);
    await changeRows(page).nth(1).getByRole("button").click();

    const detail = page.getByRole("dialog");
    await expect(detail.getByText("שינוי של כל העסק, שחל על כל היומנים. עורכים או מוחקים אותו בשינויים של כל העסק.")).toBeVisible();
    await expect(detail.getByRole("button", { name: "עריכה" })).toHaveCount(0);
    await expect(detail.getByRole("button", { name: /^מחיקה/ })).toHaveCount(0);
    await detail.getByRole("button", { name: "לשינויים של כל העסק" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("group", { name: "של מי השינויים" }).getByRole("button", { name: "כל העסק" })).toHaveAttribute("aria-pressed", "true");

    await changeRows(page).first().getByRole("button").click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "עריכה" })).toBeVisible();
  });

  test("with one calendar, a change made for the whole business is the calendar's, edited where it is listed", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({ name: `יחיד עסק ${Date.now()}`, ownerPhone: uniquePhone(), hours: { start: "09:00", end: "17:00" } });
    await aChange(shop, { scope: { kind: "BUSINESS" }, outcome: "OFF_ALL_DAY", fromDate: aDayFromNow(3), note: "ערב חג" });
    await openTheSchedule(page, shop.owner.token, shop.business.id);
    await showChangesOf(page);
    await expect(page.getByRole("group", { name: "של מי השינויים" })).toHaveCount(0);
    await expect(explain(page)).toHaveText("חופשה, יום חג או שעות אחרות בתאריך מסוים. השבוע הרגיל לא משתנה.");
    await expect(changeRows(page)).toHaveCount(1);
    // One calendar is the whole business: nothing to mark, nowhere else to send it.
    await expect(changeRows(page).first().locator(".list-tag")).toHaveCount(0);
    await changeRows(page).first().getByRole("button").click();
    await page.getByRole("dialog").getByRole("button", { name: "מחיקה · היום חוזר לשעות הרגילות" }).click();
    await expect(page.getByText("אין שינויים בשנה הקרובה")).toBeVisible({ timeout: 15_000 });
  });

  test("a worker reads the business's changes, marked, and adds to their own calendar only", async ({ page }) => {
    const shop = await aShopWithChanges("עובד שינויים");
    const worker = await aMember(shop, "WORKER", [shop.second.id]);
    await openTheSchedule(page, worker.token, shop.business.id);
    await showChangesOf(page);

    await expect(page.getByRole("group", { name: "של מי השינויים" })).toHaveCount(0);
    const rows = changeRows(page);
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator(".list-tag")).toHaveText("כל העסק");
    await expect(page.getByText("את השינויים של כל העסק קובעים הבעלים והמנהלים.")).toBeVisible();

    await rows.nth(0).getByRole("button").click();
    await expect(page.getByRole("dialog").getByText("שינוי של כל העסק. רק בעלים או מנהל יכולים לשנות אותו.")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("button", { name: "עריכה" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await rows.nth(1).getByRole("button").click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "עריכה" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "הוספת שינוי לשימי" }).click();
    const sheet = await theSheet(page);
    await expect(forWhom(sheet)).toHaveCount(0);
    await expect(sheet.getByText("כל העסק")).toHaveCount(0);
  });

  test("a worker on two calendars can read the whole business's view, with nothing to add there", async ({ page }) => {
    const shop = await aShopWithChanges("עובד שני יומנים");
    const worker = await aMember(shop, "WORKER", [shop.resource.id, shop.second.id]);
    await openTheSchedule(page, worker.token, shop.business.id);
    await showChangesOf(page, "כל העסק");
    await expect(changeRows(page)).toHaveCount(1);
    await expect(page.getByRole("button", { name: /^הוספת שינוי/ })).toHaveCount(0);
    await expect(page.getByText("את השינויים של כל העסק קובעים הבעלים והמנהלים.")).toBeVisible();
    // Opened here it is read, as from the month.
    await changeRows(page).first().getByRole("button").click();
    await expect(page.getByRole("dialog").getByText("שינוי של כל העסק. רק בעלים או מנהל יכולים לשנות אותו.")).toBeVisible();
  });

  test("every kind is one row saying what happens and when, a note after it", async ({ page }) => {
    const shop = await aTwoCalendarShop("סוגים");
    const own = { kind: "CALENDAR" as const, resourceId: shop.resource.id };
    await aChange(shop, { scope: own, outcome: "OFF_ALL_DAY", fromDate: aDayFromNow(2) });
    await aChange(shop, { scope: own, outcome: "OFF_PART", fromDate: aDayFromNow(3), ranges: [{ start: "13:00", end: "15:00" }], note: "רופא שיניים" });
    await aChange(shop, { scope: own, outcome: "OTHER_HOURS", fromDate: aDayFromNow(4), ranges: [{ start: "10:00", end: "14:00" }] });
    await aChange(shop, { scope: own, outcome: "OFF_ALL_DAY", fromDate: aDayFromNow(6), toDate: aDayFromNow(8), note: "חופשה" });
    await openTheSchedule(page, shop.owner.token, shop.business.id);
    await showChangesOf(page);

    const rows = changeRows(page);
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0).locator(".list-title")).toHaveText("לא עובדים כל היום");
    await expect(rows.nth(1).locator(".list-title")).toHaveText("לא עובדים 13:00–15:00 · רופא שיניים");
    await expect(rows.nth(2).locator(".list-title")).toHaveText("עובדים 10:00–14:00");
    await expect(rows.nth(3).locator(".list-title")).toHaveText("לא עובדים כל היום · 3 ימים · חופשה");
    // The day large at the start of each row, the days a change runs under it.
    await expect(rows.nth(0).locator(".date-block b")).toHaveText(String(Number(aDayFromNow(2).slice(8))));
    await expect(rows.nth(3).locator(".list-line")).toContainText("–");
  });

  test("a change made from here over booked appointments asks about them first", async ({ page }) => {
    const shop = await aTwoCalendarShop("מכאן עם תורים");
    const day = aDayFromNow(3);
    const booked = await aBookingAt(shop, shop.resource.id, day, "10:00", "אביגיל פרץ");
    await openTheSchedule(page, shop.owner.token, shop.business.id);
    await showChangesOf(page);
    await page.getByRole("button", { name: "הוספת שינוי ליומן א" }).click();

    const sheet = await theSheet(page);
    await expect(forWhom(sheet).getByRole("button", { name: "יומן א" })).toHaveAttribute("aria-pressed", "true");
    await sheet.getByLabel("מתאריך").fill(day);
    await sheet.getByLabel("עד תאריך").fill(day);
    await outcome(sheet, "לא עובדים כל היום").click();
    await expect(sheet.getByText("אביגיל פרץ")).toBeVisible();
    await save(page, sheet, "שמירה וביטול תור אחד");
    await expect(changeRows(page)).toHaveCount(1, { timeout: 15_000 });

    const after = await call<{ calendars: { appointments: { id: string; status: string }[] }[] }>(
      `/businesses/${shop.business.id}/calendar/day?date=${day}`,
      { token: shop.owner.token },
    );
    expect(after.calendars.flatMap((one) => one.appointments).find((one) => one.id === booked.id)?.status).toBe("CANCELLED");
  });

  test("opening a change: edit it, then remove it", async ({ page }) => {
    const shop = await aTwoCalendarShop("פתיחה");
    await aChange(shop, { scope: { kind: "CALENDAR", resourceId: shop.resource.id }, outcome: "OFF_PART", fromDate: aDayFromNow(3), ranges: [{ start: "13:00", end: "15:00" }] });
    await openTheSchedule(page, shop.owner.token, shop.business.id);
    await showChangesOf(page);

    await changeRows(page).first().getByRole("button").click();
    await page.getByRole("dialog").getByRole("button", { name: "עריכה" }).click();
    const sheet = await theSheet(page);
    await sheet.getByLabel("עד", { exact: true }).fill("16:00");
    await save(page, sheet);
    await expect(changeRows(page).first()).toContainText("לא עובדים 13:00–16:00", { timeout: 15_000 });

    await changeRows(page).first().getByRole("button").click();
    await page.getByRole("dialog").getByRole("button", { name: "מחיקה · היום חוזר לשעות הרגילות" }).click();
    await expect(page.getByText("אין שינויים בשנה הקרובה")).toBeVisible({ timeout: 15_000 });
  });

  test("no changes: says so, and the button opens the sheet for that calendar", async ({ page }) => {
    const shop = await aTwoCalendarShop("אין שינויים");
    await openTheSchedule(page, shop.owner.token, shop.business.id);
    await showChangesOf(page, "שימי");
    await expect(page.getByText("אין שינויים בשנה הקרובה")).toBeVisible();
    await expect(page.getByText("השבוע הרגיל חל על כל הימים.")).toBeVisible();
    await page.getByRole("button", { name: "הוספת שינוי לשימי" }).click();
    const sheet = await theSheet(page);
    await expect(forWhom(sheet).getByRole("button", { name: "שימי" })).toHaveAttribute("aria-pressed", "true");
    await expect(sheet.getByLabel("מתאריך")).toBeVisible();
  });

  test("many changes: in date order, with a heading for each month past a dozen", async ({ page }) => {
    const shop = await aTwoCalendarShop("הרבה שינויים");
    const own = { kind: "CALENDAR" as const, resourceId: shop.resource.id };
    const days = Array.from({ length: 13 }, (_unused, index) => aDayFromNow(2 + index * 5));
    // Made out of order: the list puts them in order.
    for (const day of [...days].reverse()) await aChange(shop, { scope: own, outcome: "OFF_ALL_DAY", fromDate: day });
    await openTheSchedule(page, shop.owner.token, shop.business.id);
    await showChangesOf(page);

    const rows = changeRows(page).filter({ has: page.locator(".change-item") });
    await expect(rows).toHaveCount(13);
    const shown = await rows.locator(".date-block b").allTextContents();
    expect(shown).toEqual(days.map((day) => String(Number(day.slice(8)))));
    const months = new Set(days.map((day) => day.slice(0, 7))).size;
    await expect(page.getByRole("list", { name: "השינויים" }).locator(".list-divider")).toHaveCount(months);
  });

  test("twelve changes are still one list, without month headings", async ({ page }) => {
    const shop = await aTwoCalendarShop("תריסר");
    const own = { kind: "CALENDAR" as const, resourceId: shop.resource.id };
    for (let index = 0; index < 12; index += 1) await aChange(shop, { scope: own, outcome: "OFF_ALL_DAY", fromDate: aDayFromNow(2 + index * 5) });
    await openTheSchedule(page, shop.owner.token, shop.business.id);
    await showChangesOf(page);
    await expect(changeRows(page)).toHaveCount(12);
    await expect(page.locator(".list-divider")).toHaveCount(0);
  });
});

test.describe("everywhere", () => {
  test("in English, the same screen, with times left to right", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({ name: `English ${Date.now()}`, ownerPhone: uniquePhone(), hours: { start: "09:00", end: "17:00" } });
    await useEnglish(page);
    await page.addInitScript(([key, value]) => window.localStorage.setItem(key as string, value as string), ["tor-now.session", shop.owner.token]);
    await page.goto(`/manage?business=${shop.business.id}`);
    await page.getByRole("button", { name: "Schedule" }).click();
    const usual = usualCard(page);
    await expect(usual.getByRole("heading", { name: "Usual hours" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("tab", { name: "Usual hours" })).toHaveAttribute("aria-selected", "true");
    await expect(explain(page)).toHaveText(
      "The hours on יומן א in a usual week. Customers can book only within them, and appointments already booked stay where they are.",
    );
    await usual.getByRole("button", { name: "Friday", exact: true }).click();
    await page.getByRole("button", { name: "Friday's hours" }).click();
    const friday = page.getByRole("dialog");
    await expect(friday.getByText("The hours on יומן א every Friday.")).toBeVisible();
    await friday.getByRole("button", { name: "Not working" }).click();
    await friday.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("list", { name: "Days with other hours" })).toContainText("Not working");
    await page.getByRole("button", { name: "Save the hours" }).click();
    await expect(page.getByText("Hours saved")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("tab", { name: "Changes" }).click();
    await expect(page.getByText("No changes in the coming year")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add a change for יומן א" })).toBeVisible();
  });

  test("on a 320px phone nothing runs off the side, and the save stays in view", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const shop = await aTwoCalendarShop("צר");
    const usual = await openTheSchedule(page, shop.owner.token, shop.business.id);
    await usual.getByRole("button", { name: "+ הוספת הפסקה" }).click();
    await usual.getByRole("button", { name: "שישי", exact: true }).click();
    const overflow = await page.locator("main.scroll").evaluate((main) => main.scrollWidth - main.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(saveButton(page)).toBeInViewport();
    await showChangesOf(page);
    expect(await page.locator("main.scroll").evaluate((main) => main.scrollWidth - main.clientWidth)).toBeLessThanOrEqual(0);
  });
});
