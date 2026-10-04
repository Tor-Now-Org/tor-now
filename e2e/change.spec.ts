import { expect, test, type Page } from "@playwright/test";
import {
  aBookingAt,
  aChange,
  aMember,
  aTwoCalendarShop,
  changeFromThePlus,
  changesOf,
  daysInOneMonth,
  forWhom,
  offered,
  openTheCalendar,
  outcome,
  save,
  theSentence,
  theSheet,
  typeHours,
  type Shop,
} from "./change-support.ts";
import { aBusinessWithOpenHours, aDayFromNow, call, openTheDayOf, ready, showTheMonthOf, uniquePhone, useEnglish } from "./support.ts";

/**
 * "שינוי ביומן": one way to change a day, from every door, for every outcome and
 * scope, checked by what a customer is then offered and by what is stored —
 * not only by what the screen draws.
 */

const WHOLE_DAY = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30"];

test.describe("each outcome for each scope, from the +", () => {
  let shop: Shop;
  let day: string;

  test.beforeEach(async ({ page }) => {
    shop = await aTwoCalendarShop("שינוי");
    [day] = daysInOneMonth(1, 2) as [string];
    await openTheCalendar(page, shop.owner.token, shop.business.id);
  });

  test("one calendar not working all day", async ({ page }) => {
    const sheet = await changeFromThePlus(page, day);
    // The calendar on screen is chosen already; what happens is not.
    await expect(forWhom(sheet).getByRole("button", { name: "יומן א" })).toHaveAttribute("aria-pressed", "true");
    await expect(sheet.getByRole("button", { name: "בחרו מה קורה" })).toBeDisabled();
    await outcome(sheet, "לא עובדים כל היום").click();
    await expect(theSentence(sheet)).toContainText("אין תורים ביומן א. שאר היומנים עובדים כרגיל.");
    await sheet.getByLabel("הערה (לא חובה)").fill("חופשה");
    await save(page, sheet);

    expect(await offered(shop, shop.resource.id, day)).toEqual([]);
    expect(await offered(shop, shop.second.id, day)).toEqual(WHOLE_DAY);
    expect(await changesOf(shop, day, day)).toMatchObject([
      { scope: { kind: "CALENDAR", resourceId: shop.resource.id }, outcome: "OFF_ALL_DAY", note: "חופשה" },
    ]);
    // On the month, in the calendar's colour, named by what happens and whose.
    await expect(page.getByRole("button", { name: /^סגור \(יומן א\)|^סגור$/ }).first()).toBeVisible();
  });

  test("one calendar not working part of the day", async ({ page }) => {
    const sheet = await changeFromThePlus(page, day);
    await outcome(sheet, "לא עובדים בחלק מהיום").click();
    await typeHours(sheet, "12:00", "13:00");
    await expect(theSentence(sheet)).toContainText("אין תורים ביומן א בין 12:00–13:00. שאר היום כרגיל.");
    await save(page, sheet);

    const left = await offered(shop, shop.resource.id, day);
    expect(left).not.toContain("12:00");
    expect(left).not.toContain("12:30");
    expect(left).toContain("13:00");
    expect(await offered(shop, shop.second.id, day)).toEqual(WHOLE_DAY);
    await expect(page.getByRole("button", { name: /^חלק מהיום/ }).first()).toBeVisible();
  });

  test("one calendar working other hours, starting from its usual day", async ({ page }) => {
    const sheet = await changeFromThePlus(page, day);
    await outcome(sheet, "עובדים בשעות אחרות").click();
    // Other hours open on the usual day, so a short day is one change of the closing time.
    await expect(sheet.getByLabel("מ־", { exact: true }).first()).toHaveValue("09:00");
    await expect(sheet.getByLabel("עד", { exact: true }).first()).toHaveValue("17:00");
    await sheet.getByRole("button", { name: "עד 13:00" }).click();
    await expect(theSentence(sheet)).toContainText("עובדים ביומן א רק 09:00–13:00, במקום 09:00–17:00.");
    await save(page, sheet);

    expect(await offered(shop, shop.resource.id, day)).toEqual(WHOLE_DAY.filter((time) => time < "13:00"));
    expect(await offered(shop, shop.second.id, day)).toEqual(WHOLE_DAY);
    await expect(page.getByRole("button", { name: /^שעות אחרות/ }).first()).toBeVisible();
  });

  test("the whole business not working all day: closing it, said out loud", async ({ page }) => {
    const sheet = await changeFromThePlus(page, day);
    await forWhom(sheet).getByRole("button", { name: "כל העסק" }).click();
    await outcome(sheet, "לא עובדים כל היום").click();
    await expect(sheet.getByText("העסק סגור", { exact: true })).toBeVisible();
    await expect(theSentence(sheet)).toContainText("העסק סגור. אף יומן לא מקבל תורים.");
    await save(page, sheet, "סגירת העסק ליום הזה");

    expect(await offered(shop, shop.resource.id, day)).toEqual([]);
    expect(await offered(shop, shop.second.id, day)).toEqual([]);
    expect(await changesOf(shop, day, day)).toMatchObject([{ scope: { kind: "BUSINESS" }, outcome: "OFF_ALL_DAY" }]);
    await expect(page.getByRole("button", { name: /^סגור$/ }).first()).toBeVisible();
  });

  test("the whole business not working part of the day", async ({ page }) => {
    const sheet = await changeFromThePlus(page, day);
    await forWhom(sheet).getByRole("button", { name: "כל העסק" }).click();
    await outcome(sheet, "לא עובדים בחלק מהיום").click();
    await typeHours(sheet, "13:00", "14:00");
    await expect(theSentence(sheet)).toContainText("אין תורים בכל העסק בין 13:00–14:00.");
    await sheet.getByLabel("הערה (לא חובה)").fill("ישיבת צוות");
    await save(page, sheet);

    for (const resourceId of [shop.resource.id, shop.second.id]) {
      const left = await offered(shop, resourceId, day);
      expect(left).not.toContain("13:00");
      expect(left).not.toContain("13:30");
      expect(left).toContain("14:00");
    }
    // One change, not one per calendar.
    expect(await changesOf(shop, day, day)).toMatchObject([{ scope: { kind: "BUSINESS" }, outcome: "OFF_PART", note: "ישיבת צוות" }]);
  });

  test("the whole business working other hours", async ({ page }) => {
    const sheet = await changeFromThePlus(page, day);
    await forWhom(sheet).getByRole("button", { name: "כל העסק" }).click();
    await outcome(sheet, "עובדים בשעות אחרות").click();
    await typeHours(sheet, "10:00", "12:00");
    await expect(theSentence(sheet)).toContainText("העסק פתוח רק 10:00–12:00, במקום 09:00–17:00.");
    await save(page, sheet);

    for (const resourceId of [shop.resource.id, shop.second.id]) {
      expect(await offered(shop, resourceId, day)).toEqual(["10:00", "10:30", "11:00", "11:30"]);
    }
    expect(await changesOf(shop, day, day)).toMatchObject([{ scope: { kind: "BUSINESS" }, outcome: "OTHER_HOURS" }]);
  });

  test("several days at once, and several stretches of each", async ({ page }) => {
    const [first, , last] = daysInOneMonth(3, 2) as [string, string, string];
    const sheet = await changeFromThePlus(page, first, last);
    await outcome(sheet, "לא עובדים בחלק מהיום").click();
    await typeHours(sheet, "10:00", "11:00");
    await sheet.getByRole("button", { name: "+ עוד טווח" }).click();
    await typeHours(sheet, "14:00", "15:00", 1);
    await expect(theSentence(sheet)).toContainText("10:00–11:00, 14:00–15:00");
    await save(page, sheet);

    for (const date of daysInOneMonth(3, 2)) {
      const left = await offered(shop, shop.resource.id, date);
      expect(left).not.toContain("10:00");
      expect(left).not.toContain("14:30");
      expect(left).toContain("12:00");
    }
    expect(await changesOf(shop, first, last)).toHaveLength(1);
  });
});

test.describe("every door opens the complete sheet", () => {
  test("a free stretch brings its hours, and only they are taken", async ({ page }) => {
    const shop = await aTwoCalendarShop("מרווח");
    const [day] = daysInOneMonth(1, 2) as [string];
    await openTheCalendar(page, shop.owner.token, shop.business.id);
    await openTheDayOf(page, day);
    // A whole empty day is folded: the first tap opens the fold, the second is the stretch.
    await page.getByRole("button").filter({ hasText: /פנוי\s*·/ }).first().click();
    await page.getByRole("button").filter({ hasText: /פנוי\s*·/ }).first().click();

    const stretch = page.getByRole("dialog");
    await expect(stretch.getByRole("button", { name: "תור ללקוח בשעה שנבחרה" })).toBeVisible();
    await stretch.getByRole("button", { name: /שינוי ביומן/ }).click();

    const sheet = await theSheet(page);
    await expect(forWhom(sheet).getByRole("button", { name: "יומן א" })).toHaveAttribute("aria-pressed", "true");
    await outcome(sheet, "לא עובדים בחלק מהיום").click();
    // The stretch's own hours, the whole open day here.
    await expect(sheet.getByLabel("מ־", { exact: true }).first()).toHaveValue("09:00");
    await expect(sheet.getByLabel("עד", { exact: true }).first()).toHaveValue("17:00");
    // Narrowed to the hour that is actually being taken.
    await sheet.getByRole("button", { name: "שעה", exact: true }).click();
    await expect(sheet.getByLabel("עד", { exact: true }).first()).toHaveValue("10:00");
    await save(page, sheet);

    const left = await offered(shop, shop.resource.id, day);
    expect(left).not.toContain("09:00");
    expect(left).not.toContain("09:30");
    expect(left).toContain("10:00");
  });

  test("from a free stretch, switched to the whole business and three days, it closes the business for them", async ({ page }) => {
    const shop = await aTwoCalendarShop("כל הדלתות");
    const [first, middle, last] = daysInOneMonth(3, 2) as [string, string, string];
    await openTheCalendar(page, shop.owner.token, shop.business.id);
    await openTheDayOf(page, first);
    // A whole empty day is folded: the first tap opens the fold, the second is the stretch.
    await page.getByRole("button").filter({ hasText: /פנוי\s*·/ }).first().click();
    await page.getByRole("button").filter({ hasText: /פנוי\s*·/ }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: /שינוי ביומן/ }).click();

    const sheet = await theSheet(page);
    await sheet.getByRole("button", { name: "שינוי ימים" }).click();
    await sheet.getByLabel("עד תאריך").fill(last);
    await forWhom(sheet).getByRole("button", { name: "כל העסק" }).click();
    await outcome(sheet, "לא עובדים כל היום").click();
    await save(page, sheet, "סגירת העסק לימים האלה");

    for (const date of [first, middle, last]) {
      expect(await offered(shop, shop.resource.id, date)).toEqual([]);
      expect(await offered(shop, shop.second.id, date)).toEqual([]);
    }
    expect(await changesOf(shop, first, last)).toMatchObject([{ scope: { kind: "BUSINESS" }, fromDate: first, toDate: last }]);
  });

  test("the schedule, with dates typed, leaves its row under the business and not under a calendar", async ({ page }) => {
    const shop = await aTwoCalendarShop("לוח");
    const [first, last] = daysInOneMonth(2, 3) as [string, string];
    await openTheCalendar(page, shop.owner.token, shop.business.id);
    await page.getByRole("button", { name: "לוח זמנים" }).click();
    await page.getByRole("tab", { name: "שינויים" }).click();
    await page.getByRole("group", { name: "של מי השינויים" }).getByRole("button", { name: "כל העסק" }).click();
    await expect(page.getByText("אין שינויים קרובים")).toBeVisible();
    await page.getByRole("button", { name: "שינוי לכל העסק" }).click();

    const sheet = await theSheet(page);
    await expect(forWhom(sheet).getByRole("button", { name: "כל העסק" })).toHaveAttribute("aria-pressed", "true");
    await sheet.getByLabel("מתאריך").fill(first);
    await sheet.getByLabel("עד תאריך").fill(last);
    await outcome(sheet, "עובדים בשעות אחרות").click();
    await sheet.getByRole("button", { name: "עד 13:00" }).click();
    await sheet.getByLabel("הערה (לא חובה)").fill("ערב חג");
    await save(page, sheet);

    const rows = page.getByRole("list", { name: "השינויים" }).getByRole("listitem");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("עובדים 09:00–13:00");
    await expect(rows.first()).toContainText("ערב חג");
    // A calendar shows only its own changes.
    await page.getByRole("group", { name: "של מי השינויים" }).getByRole("button", { name: "יומן א" }).click();
    await expect(page.getByText("אין שינויים קרובים")).toBeVisible();
    expect(await offered(shop, shop.resource.id, first)).toEqual(WHOLE_DAY.filter((time) => time < "13:00"));
  });
});

test.describe("the people already booked", () => {
  test("named, and called off and told by default — the button says so", async ({ page }) => {
    const shop = await aTwoCalendarShop("תורים");
    const [day] = daysInOneMonth(1, 2) as [string];
    const booked = await aBookingAt(shop, shop.resource.id, day, "10:00", "דנה כהן");
    await openTheCalendar(page, shop.owner.token, shop.business.id);

    const sheet = await changeFromThePlus(page, day);
    await outcome(sheet, "לא עובדים כל היום").click();
    await expect(sheet.getByText("תור אחד ביום הזה")).toBeVisible();
    await expect(sheet.getByText("דנה כהן")).toBeVisible();
    await expect(sheet.getByRole("radio", { name: "לבטל אותו ולשלוח ללקוח הודעה" })).toHaveAttribute("aria-checked", "true");
    // Keeping them makes it a plain save; cancelling says how many.
    await sheet.getByRole("radio", { name: "להשאיר אותו, אדבר איתו בעצמי" }).click();
    await expect(sheet.getByRole("button", { name: "שמירת השינוי" })).toBeVisible();
    await sheet.getByRole("radio", { name: "לבטל אותו ולשלוח ללקוח הודעה" }).click();
    await save(page, sheet, "שמירה וביטול תור אחד");

    const day0 = await call<{ calendars: { appointments: { id: string; status: string }[] }[] }>(
      `/businesses/${shop.business.id}/calendar/day?date=${day}`,
      { token: shop.owner.token },
    );
    expect(day0.calendars.flatMap((one) => one.appointments).find((one) => one.id === booked.id)?.status).toBe("CANCELLED");
  });

  test("kept, when the owner will talk to them, and only the ones in the hours", async ({ page }) => {
    const shop = await aTwoCalendarShop("שומרים");
    const [day] = daysInOneMonth(1, 2) as [string];
    const inside = await aBookingAt(shop, shop.resource.id, day, "13:00", "רון לוי");
    await aBookingAt(shop, shop.resource.id, day, "09:00", "מיכל אבן");
    await openTheCalendar(page, shop.owner.token, shop.business.id);

    const sheet = await changeFromThePlus(page, day);
    await outcome(sheet, "לא עובדים בחלק מהיום").click();
    await typeHours(sheet, "12:00", "14:00");
    await expect(sheet.getByText("תור אחד בשעות האלה")).toBeVisible();
    await expect(sheet.getByText("רון לוי")).toBeVisible();
    await expect(sheet.getByText("מיכל אבן")).toHaveCount(0);
    await sheet.getByRole("radio", { name: "להשאיר אותו, אדבר איתו בעצמי" }).click();
    await save(page, sheet);

    const after = await call<{ calendars: { appointments: { id: string; status: string }[] }[] }>(
      `/businesses/${shop.business.id}/calendar/day?date=${day}`,
      { token: shop.owner.token },
    );
    expect(after.calendars.flatMap((one) => one.appointments).find((one) => one.id === inside.id)?.status).toBe("CONFIRMED");
  });

  test("says when nobody is booked", async ({ page }) => {
    const shop = await aTwoCalendarShop("ריק");
    const [day] = daysInOneMonth(1, 2) as [string];
    await openTheCalendar(page, shop.owner.token, shop.business.id);
    const sheet = await changeFromThePlus(page, day);
    await outcome(sheet, "לא עובדים כל היום").click();
    await expect(sheet.getByText("אין תורים ביום הזה.")).toBeVisible();
  });
});

test.describe("over, and instead of, an earlier change", () => {
  test("other hours say which change they replace, and replace it", async ({ page }) => {
    const shop = await aTwoCalendarShop("מחליף");
    const [day] = daysInOneMonth(1, 2) as [string];
    await aChange(shop, { scope: { kind: "BUSINESS" }, outcome: "OTHER_HOURS", fromDate: day, ranges: [{ start: "09:00", end: "14:00" }], note: "ערב חג" });
    await openTheCalendar(page, shop.owner.token, shop.business.id);

    const sheet = await changeFromThePlus(page, day);
    await forWhom(sheet).getByRole("button", { name: "כל העסק" }).click();
    await outcome(sheet, "עובדים בשעות אחרות").click();
    await expect(sheet.getByRole("note")).toContainText('ביום הזה כבר יש שינוי: "עובדים 09:00–14:00 · ערב חג". השינוי החדש יחליף אותו.');
    await typeHours(sheet, "09:00", "13:00");
    await save(page, sheet);

    expect(await changesOf(shop, day, day)).toMatchObject([{ outcome: "OTHER_HOURS", ranges: [{ start: "09:00", end: "13:00" }] }]);
  });

  test("an edit switches outcome and scope in one replacement", async ({ page }) => {
    const shop = await aTwoCalendarShop("עריכה");
    const [day] = daysInOneMonth(1, 2) as [string];
    await aChange(shop, { scope: { kind: "CALENDAR", resourceId: shop.resource.id }, outcome: "OFF_PART", fromDate: day, ranges: [{ start: "12:00", end: "13:00" }], note: "רופא" });
    await openTheCalendar(page, shop.owner.token, shop.business.id);
    await showTheMonthOf(page, day);
    await page.getByRole("button", { name: /^חלק מהיום/ }).first().click();

    const detail = page.getByRole("dialog");
    await expect(detail.getByRole("heading", { name: "רופא" })).toBeVisible();
    await expect(detail.locator(".change-sentence")).toContainText("אין תורים ביומן א בין 12:00–13:00");
    await detail.getByRole("button", { name: "עריכה" }).click();

    const sheet = await theSheet(page);
    // Everything it said is filled in.
    await expect(outcome(sheet, "לא עובדים בחלק מהיום")).toHaveAttribute("aria-checked", "true");
    await expect(sheet.getByLabel("הערה (לא חובה)")).toHaveValue("רופא");
    await forWhom(sheet).getByRole("button", { name: "כל העסק" }).click();
    await outcome(sheet, "עובדים בשעות אחרות").click();
    await typeHours(sheet, "09:00", "11:00");
    await save(page, sheet);

    expect(await changesOf(shop, day, day)).toMatchObject([{ scope: { kind: "BUSINESS" }, outcome: "OTHER_HOURS", note: "רופא" }]);
    expect(await changesOf(shop, day, day)).toHaveLength(1);
    expect(await offered(shop, shop.resource.id, day)).toEqual(["09:00", "09:30", "10:00", "10:30"]);
  });
});

test.describe("removing a change", () => {
  test("one of its days from the day itself, then the rest from the month", async ({ page }) => {
    const shop = await aTwoCalendarShop("מחיקה");
    const [first, middle, last] = daysInOneMonth(3, 2) as [string, string, string];
    await aChange(shop, { scope: { kind: "CALENDAR", resourceId: shop.resource.id }, outcome: "OFF_PART", fromDate: first, toDate: last, ranges: [{ start: "12:00", end: "13:00" }], note: "סדנה" });
    await openTheCalendar(page, shop.owner.token, shop.business.id);
    await openTheDayOf(page, middle);
    await page.getByRole("button", { name: /12:00 סדנה/ }).first().click();

    const detail = page.getByRole("dialog");
    await expect(detail.getByRole("button", { name: "מחיקה · 3 הימים חוזרים לשעות הרגילות" })).toBeVisible();
    await detail.getByRole("button", { name: /^מחיקה רק של/ }).click();
    await expect(detail).toBeHidden({ timeout: 15_000 });
    expect(await offered(shop, shop.resource.id, middle)).toEqual(WHOLE_DAY);
    expect((await changesOf(shop, first, last)).flatMap((one) => one.days.map((d) => d.date))).toEqual([first, last]);

    await showTheMonthOf(page, first);
    await page.getByRole("button", { name: /^חלק מהיום/ }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "מחיקה · 2 הימים חוזרים לשעות הרגילות" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });
    expect(await changesOf(shop, first, last)).toEqual([]);
    expect(await offered(shop, shop.resource.id, first)).toEqual(WHOLE_DAY);
  });

  test("a closed day opens the change behind it, and gives the day back", async ({ page }) => {
    const shop = await aTwoCalendarShop("יום סגור");
    const [day] = daysInOneMonth(1, 2) as [string];
    await aChange(shop, { scope: { kind: "BUSINESS" }, outcome: "OFF_ALL_DAY", fromDate: day, note: "יום כיפור" });
    await openTheCalendar(page, shop.owner.token, shop.business.id);
    await openTheDayOf(page, day);
    await expect(page.getByText("יום כיפור")).toBeVisible();
    await page.getByRole("button", { name: "פרטי השינוי" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "מחיקה · היום חוזר לשעות הרגילות" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });
    expect(await offered(shop, shop.resource.id, day)).toEqual(WHOLE_DAY);
  });
});

test.describe("who may do what", () => {
  test("a manager closes the business", async ({ page }) => {
    const shop = await aTwoCalendarShop("מנהלת");
    const [day] = daysInOneMonth(1, 2) as [string];
    const manager = await aMember(shop, "MANAGER", []);
    await openTheCalendar(page, manager.token, shop.business.id);
    const sheet = await changeFromThePlus(page, day);
    await forWhom(sheet).getByRole("button", { name: "כל העסק" }).click();
    await outcome(sheet, "לא עובדים כל היום").click();
    await save(page, sheet, "סגירת העסק ליום הזה");
    expect(await offered(shop, shop.second.id, day)).toEqual([]);
  });

  test("a worker on one calendar: their calendar said plainly, every outcome, no whole business", async ({ page }) => {
    const shop = await aTwoCalendarShop("עובדת");
    const [day] = daysInOneMonth(1, 2) as [string];
    const worker = await aMember(shop, "WORKER", [shop.second.id]);
    await openTheCalendar(page, worker.token, shop.business.id);
    const sheet = await changeFromThePlus(page, day);
    await expect(sheet.getByText("ביומן של שימי")).toBeVisible();
    await expect(forWhom(sheet)).toHaveCount(0);
    await expect(sheet.getByText("כל העסק")).toHaveCount(0);
    for (const name of ["לא עובדים כל היום", "לא עובדים בחלק מהיום", "עובדים בשעות אחרות"] as const) {
      await expect(outcome(sheet, name)).toBeVisible();
    }
    await outcome(sheet, "לא עובדים בחלק מהיום").click();
    await typeHours(sheet, "10:00", "12:00");
    await save(page, sheet);
    expect(await offered(shop, shop.second.id, day)).not.toContain("10:30");
    expect(await offered(shop, shop.resource.id, day)).toEqual(WHOLE_DAY);
  });

  test("a worker on two calendars chooses between those two, and still not the business", async ({ page }) => {
    const shop = await aTwoCalendarShop("שני יומנים");
    const [day] = daysInOneMonth(1, 2) as [string];
    const worker = await aMember(shop, "WORKER", [shop.resource.id, shop.second.id]);
    await openTheCalendar(page, worker.token, shop.business.id);
    const sheet = await changeFromThePlus(page, day);
    await expect(forWhom(sheet).getByRole("button")).toHaveText(["יומן א", "שימי"]);
  });

  test("a worker reads the business's change and is offered nothing to change in it", async ({ page }) => {
    const shop = await aTwoCalendarShop("קריאה");
    const [day] = daysInOneMonth(1, 2) as [string];
    await aChange(shop, { scope: { kind: "BUSINESS" }, outcome: "OTHER_HOURS", fromDate: day, ranges: [{ start: "09:00", end: "13:00" }], note: "ערב חג" });
    const worker = await aMember(shop, "WORKER", [shop.resource.id]);
    await openTheCalendar(page, worker.token, shop.business.id);
    await showTheMonthOf(page, day);
    await page.getByRole("button", { name: /^שעות אחרות/ }).first().click();
    const detail = page.getByRole("dialog");
    await expect(detail.getByText("שינוי של כל העסק. רק בעלים או מנהל יכולים לשנות אותו.")).toBeVisible();
    await expect(detail.getByRole("button", { name: "עריכה" })).toHaveCount(0);
    await expect(detail.getByRole("button", { name: /^מחיקה/ })).toHaveCount(0);
  });

  test("the API refuses a worker the whole business", async () => {
    const shop = await aTwoCalendarShop("שרת");
    const worker = await aMember(shop, "WORKER", [shop.resource.id]);
    await expect(
      aChange(shop, { scope: { kind: "BUSINESS" }, outcome: "OFF_ALL_DAY", fromDate: aDayFromNow(2) }, worker.token),
    ).rejects.toThrow(/403|FORBIDDEN/);
  });
});

test.describe("a business with one calendar", () => {
  test("asks nothing about whom, and marks each outcome on the month and the day", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({ name: `יומן אחד ${Date.now()}`, ownerPhone: uniquePhone(), hours: { start: "09:00", end: "17:00" } });
    const [closed, part, other] = daysInOneMonth(3, 2) as [string, string, string];
    await aChange(shop, { scope: { kind: "CALENDAR", resourceId: shop.resource.id }, outcome: "OFF_ALL_DAY", fromDate: closed });
    await aChange(shop, { scope: { kind: "CALENDAR", resourceId: shop.resource.id }, outcome: "OFF_PART", fromDate: part, ranges: [{ start: "12:00", end: "13:00" }] });
    await aChange(shop, { scope: { kind: "CALENDAR", resourceId: shop.resource.id }, outcome: "OTHER_HOURS", fromDate: other, ranges: [{ start: "09:00", end: "13:00" }], note: "ערב חג" });
    await openTheCalendar(page, shop.owner.token, shop.business.id);
    await showTheMonthOf(page, closed);
    await expect(page.getByRole("button", { name: "סגור", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "חלק מהיום", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "שעות אחרות", exact: true }).first()).toBeVisible();

    await openTheDayOf(page, other);
    await expect(page.getByRole("button", { name: "שעות אחרות היום · 09:00–13:00 · ערב חג" })).toBeVisible();

    const sheet = await changeFromThePlus(page, part);
    await expect(forWhom(sheet)).toHaveCount(0);
    await expect(sheet.getByText("ביומן א", { exact: true })).toBeVisible();
  });
});

test.describe("mistakes, said before saving", () => {
  let shop: Shop;
  let day: string;

  test.beforeEach(async ({ page }) => {
    shop = await aTwoCalendarShop("טעויות");
    [day] = daysInOneMonth(1, 2) as [string];
    await openTheCalendar(page, shop.owner.token, shop.business.id);
  });

  const refused = async (page: Page, words: string) => {
    const sheet = await theSheet(page);
    await expect(sheet.getByRole("alert")).toHaveText(words);
    await expect(sheet.getByRole("button", { name: /שמירת השינוי|סגירת העסק/ })).toBeDisabled();
  };

  test("an end before its start", async ({ page }) => {
    const sheet = await changeFromThePlus(page, day);
    await outcome(sheet, "לא עובדים בחלק מהיום").click();
    await typeHours(sheet, "15:00", "13:00");
    await refused(page, "שעת הסיום צריכה להיות אחרי שעת ההתחלה");
  });

  test("a day that has passed", async ({ page }) => {
    const sheet = await changeFromThePlus(page, day);
    await sheet.getByRole("button", { name: "שינוי ימים" }).click();
    await sheet.getByLabel("מתאריך").fill(aDayFromNow(-1));
    await outcome(sheet, "לא עובדים כל היום").click();
    await refused(page, "אי אפשר לשנות יום שכבר עבר");
  });

  test("nothing chosen yet, and nobody chosen yet", async ({ page }) => {
    // With every calendar on screen, nobody is chosen for the owner.
    await page.getByRole("button", { name: /^יומן:/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: /כל היומנים/ }).click();
    const sheet = await changeFromThePlus(page, day);
    await expect(sheet.getByRole("button", { name: "בחרו למי" })).toBeDisabled();
    await forWhom(sheet).getByRole("button", { name: "שימי" }).click();
    await expect(sheet.getByRole("button", { name: "בחרו מה קורה" })).toBeDisabled();
  });

  test("walked away from, nothing is written", async ({ page }) => {
    const sheet = await changeFromThePlus(page, day);
    await outcome(sheet, "לא עובדים כל היום").click();
    await sheet.getByRole("button", { name: "ביטול", exact: true }).click();
    await expect(sheet).toBeHidden();
    expect(await changesOf(shop, day, day)).toEqual([]);
  });
});

test.describe("in English", () => {
  test("the same sheet, in the same words", async ({ page }) => {
    await useEnglish(page);
    const shop = await aTwoCalendarShop("English");
    const [day] = daysInOneMonth(1, 2) as [string];
    await openTheCalendar(page, shop.owner.token, shop.business.id);
    await page.getByRole("button", { name: "Add to the day" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Calendar change/ }).click();
    await showTheMonthOf(page, day);
    await page.getByRole("button", { name: day }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Calendar change" }) });
    await sheet.getByRole("group", { name: "For" }).getByRole("button", { name: "Whole business" }).click();
    await sheet.getByRole("radio", { name: /^Not working all day/ }).click();
    await expect(sheet.locator(".change-sentence")).toContainText("the business is closed. No calendar takes appointments.");
    await expect(sheet.getByRole("button", { name: "Close the business for this day" })).toBeEnabled();
    await ready(page);
  });
});

test.describe("other hours that are the usual ones", () => {
  const SAME_DAY = "אלה השעות הרגילות של היום הזה — אין כאן שינוי.";

  test("say so instead of a sentence, hold saving back, and let go once an hour differs", async ({ page }) => {
    const shop = await aTwoCalendarShop("רגיל");
    const [day] = daysInOneMonth(1, 2) as [string];
    await openTheCalendar(page, shop.owner.token, shop.business.id);
    const sheet = await changeFromThePlus(page, day);
    await outcome(sheet, "עובדים בשעות אחרות").click();

    // It opens on the usual day, which is no change at all.
    await expect(sheet.getByRole("status").filter({ hasText: SAME_DAY })).toBeVisible();
    await expect(theSentence(sheet)).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "שמירת השינוי" })).toBeDisabled();

    // One hour different, and it is a change again.
    await sheet.getByRole("button", { name: "עד 13:00" }).click();
    await expect(sheet.getByText(SAME_DAY)).toHaveCount(0);
    await expect(theSentence(sheet)).toContainText("רק 09:00–13:00, במקום 09:00–17:00");
    await expect(sheet.getByRole("button", { name: "שמירת השינוי" })).toBeEnabled();

    // And back to the usual hours, back to no change.
    await sheet.getByRole("button", { name: "כמו בדרך כלל" }).click();
    await expect(sheet.getByText(SAME_DAY)).toBeVisible();
    await expect(sheet.getByRole("button", { name: "שמירת השינוי" })).toBeDisabled();
  });

  test("are the usual ones however the stretches were typed", async ({ page }) => {
    const shop = await aTwoCalendarShop("רגיל מפוצל");
    const [day] = daysInOneMonth(1, 2) as [string];
    await openTheCalendar(page, shop.owner.token, shop.business.id);
    const sheet = await changeFromThePlus(page, day);
    await outcome(sheet, "עובדים בשעות אחרות").click();
    await typeHours(sheet, "09:00", "12:00");
    await sheet.getByRole("button", { name: "+ עוד טווח" }).click();
    await typeHours(sheet, "12:00", "17:00", 1);
    await expect(sheet.getByText(SAME_DAY)).toBeVisible();
  });

  test("for several days of the whole business, said of those days", async ({ page }) => {
    const shop = await aTwoCalendarShop("רגיל כולם");
    const [first, last] = daysInOneMonth(2, 2) as [string, string];
    await openTheCalendar(page, shop.owner.token, shop.business.id);
    const sheet = await changeFromThePlus(page, first, last);
    await forWhom(sheet).getByRole("button", { name: "כל העסק" }).click();
    await outcome(sheet, "עובדים בשעות אחרות").click();
    await expect(sheet.getByText("אלה השעות הרגילות של הימים האלה — אין כאן שינוי.")).toBeVisible();
  });

  test("are not the business's usual ones when a calendar keeps other hours", async ({ page }) => {
    const shop = await aTwoCalendarShop("רגיל שונה");
    await call(`/businesses/${shop.business.id}/resources/${shop.second.id}/working-hours`, {
      method: "PUT",
      token: shop.owner.token,
      body: { week: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, start: "12:00", end: "19:00" })) },
    });
    const [day] = daysInOneMonth(1, 2) as [string];
    await openTheCalendar(page, shop.owner.token, shop.business.id);
    const sheet = await changeFromThePlus(page, day);
    await forWhom(sheet).getByRole("button", { name: "כל העסק" }).click();
    await outcome(sheet, "עובדים בשעות אחרות").click();
    await typeHours(sheet, "09:00", "17:00");
    await expect(theSentence(sheet)).toContainText("העסק פתוח רק 09:00–17:00");
    await expect(sheet.getByText(/אין כאן שינוי/)).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "שמירת השינוי" })).toBeEnabled();
  });

  test("as an edit, point to removing the change instead", async ({ page }) => {
    const shop = await aTwoCalendarShop("חזרה לרגיל");
    const [day] = daysInOneMonth(1, 2) as [string];
    await aChange(shop, { scope: { kind: "CALENDAR", resourceId: shop.resource.id }, outcome: "OTHER_HOURS", fromDate: day, ranges: [{ start: "09:00", end: "13:00" }] });
    await openTheCalendar(page, shop.owner.token, shop.business.id);
    await showTheMonthOf(page, day);
    await page.getByRole("button", { name: /^שעות אחרות/ }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "עריכה" }).click();
    const sheet = await theSheet(page);
    await sheet.getByRole("button", { name: "כמו בדרך כלל" }).click();
    await expect(sheet.getByText(`${SAME_DAY} כדי להחזיר לשעות הרגילות, מוחקים את השינוי.`)).toBeVisible();
    await expect(sheet.getByRole("button", { name: "שמירת השינוי" })).toBeDisabled();
    expect(await changesOf(shop, day, day)).toMatchObject([{ ranges: [{ start: "09:00", end: "13:00" }] }]);
  });

  test("are refused by the API too", async () => {
    const shop = await aTwoCalendarShop("רגיל שרת");
    await expect(
      aChange(shop, { scope: { kind: "BUSINESS" }, outcome: "OTHER_HOURS", fromDate: aDayFromNow(2), ranges: [{ start: "09:00", end: "17:00" }] }),
    ).rejects.toThrow(/400/);
  });
});

test.describe("the schedule's layout", () => {
  test("the two views come first, and the calendars under them", async ({ page }) => {
    const shop = await aTwoCalendarShop("סדר");
    await openTheCalendar(page, shop.owner.token, shop.business.id);
    await page.getByRole("button", { name: "לוח זמנים" }).click();

    const tabs = page.getByRole("tablist");
    const calendars = page.getByRole("group", { name: "איזה יומן" });
    await expect(tabs.getByRole("tab", { name: "שעות קבועות" })).toHaveAttribute("aria-selected", "true");
    await expect(calendars).toBeVisible();
    expect((await tabs.boundingBox())!.y).toBeLessThan((await calendars.boundingBox())!.y);
    // The usual week is always a calendar's: there is no business choice here.
    await expect(calendars.getByRole("button")).toHaveText(["יומן א", "שימי"]);

    // Changes: the same place, and the whole business first among them.
    await tabs.getByRole("tab", { name: "שינויים" }).click();
    const whose = page.getByRole("group", { name: "של מי השינויים" });
    expect((await tabs.boundingBox())!.y).toBeLessThan((await whose.boundingBox())!.y);
    await expect(whose.getByRole("button")).toHaveText(["כל העסק", "יומן א", "שימי"]);
    await whose.getByRole("button", { name: "כל העסק" }).click();
    await expect(page.getByRole("button", { name: "שינוי לכל העסק" })).toBeVisible();

    // Back to the usual week from the whole business: the first calendar's, not nobody's.
    await tabs.getByRole("tab", { name: "שעות קבועות" }).click();
    await expect(calendars.getByRole("button", { name: "יומן א" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("רוב הימים")).toBeVisible({ timeout: 15_000 });
  });

  test("a business with one calendar has nothing to choose between", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({ name: `סדר יחיד ${Date.now()}`, ownerPhone: uniquePhone() });
    await openTheCalendar(page, shop.owner.token, shop.business.id);
    await page.getByRole("button", { name: "לוח זמנים" }).click();
    await expect(page.getByRole("tablist")).toBeVisible();
    await expect(page.getByRole("group", { name: "איזה יומן" })).toHaveCount(0);
    await page.getByRole("tab", { name: "שינויים" }).click();
    await expect(page.getByRole("group", { name: "של מי השינויים" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "שינוי ביומן א" })).toBeVisible();
  });
});
