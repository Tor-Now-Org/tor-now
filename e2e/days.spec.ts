import { expect, test, type Page } from "@playwright/test";
import { aChange, aBookingAt, aTwoCalendarShop, offered } from "./change-support.ts";
import {
  aBusinessWithOpenHours,
  aDayFromNow,
  call,
  DAY_STRIP,
  ready,
  uniquePhone,
  useEnglish,
} from "./support.ts";

/**
 * ADR 0026: the customer's days say what they hold before they are opened,
 * follow the business's booking window, open on the first day with room, and
 * reach the whole window through the month.
 *
 * Every journey runs against the real clock, so a case that depends on the
 * hour it runs at says so and steps aside near the edges of the day.
 */

const ZONE = "Asia/Jerusalem";

/** The shop's clock right now, as minutes since its midnight. */
const minutesNow = (): number => {
  const [hour, minute] = new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date())
    .split(":")
    .map(Number) as [number, number];
  return (hour % 24) * 60 + minute;
};

/** "13.10", the way a day is written under its weekday. */
const shortDate = (date: string): string => `${Number(date.slice(8))}.${Number(date.slice(5, 7))}`;

const HEBREW_WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const weekdayOf = (date: string): string => HEBREW_WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;

/** The date the window's horizon reaches from now, in the shop's zone. */
const lastBookableDay = (horizonDays: number): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(new Date(Date.now() + horizonDays * 86_400_000));

/** Pages the open month sheet forward until it draws this date. */
const showInTheSheet = async (page: Page, date: string) => {
  const sheet = page.getByRole("dialog");
  for (let step = 0; step < 3 && (await sheet.locator(`[data-date="${date}"]`).count()) === 0; step += 1) {
    await sheet.getByRole("button", { name: "החודש הבא" }).click();
  }
  return sheet.locator(`[data-date="${date}"]`);
};

const strip = (page: Page) => page.getByRole("radiogroup", { name: DAY_STRIP });
const dayChip = (page: Page, daysAhead: number) => strip(page).getByRole("radio").nth(daysAhead);
const times = (page: Page) => page.locator("[role=radio]", { hasText: /^\d\d:\d\d$/ });

const openTheBusiness = async (page: Page, businessId: string) => {
  await page.goto(`/business/${businessId}`);
  await ready(page);
  await expect(strip(page)).toBeVisible({ timeout: 15_000 });
};

const settings = (shop: { business: { id: string }; owner: { token: string } }, body: Record<string, unknown>) =>
  call(`/businesses/${shop.business.id}`, { method: "PATCH", token: shop.owner.token, body });

const closed = (shop: { business: { id: string }; owner: { token: string } }, from: number, to = from) =>
  aChange(shop, { scope: { kind: "BUSINESS" }, outcome: "OFF_ALL_DAY", fromDate: aDayFromNow(from), toDate: aDayFromNow(to) });

const aShop = (name: string, hours?: { start: string; end: string }) =>
  aBusinessWithOpenHours({ name: `${name} ${Date.now()}`, ownerPhone: uniquePhone(), ...(hours === undefined ? {} : { hours }) });

test.describe("what each day says", () => {
  test("opens on the first day with room, past days with nothing to book", async ({ page }) => {
    const shop = await aShop("ימים");
    await closed(shop, 0, 1);
    const free = (await offered(shop, shop.resource.id, aDayFromNow(2))).length;

    await openTheBusiness(page, shop.business.id);

    await expect(dayChip(page, 0)).toContainText("סגור");
    await expect(dayChip(page, 1)).toContainText("סגור");
    await expect(dayChip(page, 2)).toHaveAttribute("aria-checked", "true", { timeout: 15_000 });
    await expect(dayChip(page, 2)).toContainText(`${free} פנויים`);
    await expect(times(page).first()).toBeVisible();
  });

  test("names every day for a screen reader, with what it holds", async ({ page }) => {
    const shop = await aShop("קורא מסך");
    await closed(shop, 0);
    const free = (await offered(shop, shop.resource.id, aDayFromNow(3))).length;

    await openTheBusiness(page, shop.business.id);

    await expect(dayChip(page, 0)).toHaveAccessibleName(`היום ${shortDate(aDayFromNow(0))}, העסק סגור`);
    await expect(dayChip(page, 3)).toHaveAccessibleName(
      `יום ${weekdayOf(aDayFromNow(3))} ${shortDate(aDayFromNow(3))}, ${free} תורים פנויים`,
    );
  });

  test("a closed day says so when opened, and offers no waiting", async ({ page }) => {
    const shop = await aShop("סגור");
    await closed(shop, 1);
    await openTheBusiness(page, shop.business.id);

    await dayChip(page, 1).click();
    await expect(page.getByText("העסק סגור ביום הזה")).toBeVisible();
    await expect(page.getByText("אפשר לבחור יום אחר.")).toBeVisible();
    await expect(page.getByRole("button", { name: /הודיעו לי/ })).toHaveCount(0);
  });

  test("a full day says full, and still leads to the waiting list", async ({ page }) => {
    const shop = await aShop("מלא");
    const day = aDayFromNow(2);
    await aChange(shop, {
      scope: { kind: "CALENDAR", resourceId: shop.resource.id },
      outcome: "OTHER_HOURS",
      fromDate: day,
      ranges: [{ start: "10:00", end: "11:00" }],
    });
    await aBookingAt(shop, shop.resource.id, day, "10:00");
    await aBookingAt(shop, shop.resource.id, day, "10:30");

    await openTheBusiness(page, shop.business.id);

    await expect(dayChip(page, 2)).toContainText("מלא", { timeout: 15_000 });
    await dayChip(page, 2).click();
    await expect(page.getByText("אין תורים פנויים ביום הזה")).toBeVisible();
    await expect(page.getByRole("button", { name: "הודיעו לי אם מתפנה תור" })).toBeVisible();
  });

  test("a day whose hours have ended says it is over, with nothing to wait for", async ({ page }) => {
    test.skip(minutesNow() < 60, "Today's short hours have to be over already.");
    const shop = await aShop("הסתיים");
    await aChange(shop, {
      scope: { kind: "CALENDAR", resourceId: shop.resource.id },
      outcome: "OTHER_HOURS",
      fromDate: aDayFromNow(0),
      ranges: [{ start: "00:00", end: "00:30" }],
    });

    await openTheBusiness(page, shop.business.id);

    await expect(dayChip(page, 0)).toContainText("הסתיים", { timeout: 15_000 });
    await dayChip(page, 0).click();
    await expect(page.getByText("היום כבר הסתיים")).toBeVisible();
    await expect(page.getByRole("button", { name: /הודיעו לי/ })).toHaveCount(0);
  });

  test("changing calendar asks the days again", async ({ page }) => {
    const shop = await aTwoCalendarShop("יומן אחר");
    await aChange(shop, {
      scope: { kind: "CALENDAR", resourceId: shop.second.id },
      outcome: "OFF_ALL_DAY",
      fromDate: aDayFromNow(2),
    });

    await openTheBusiness(page, shop.business.id);
    await expect(dayChip(page, 2)).toContainText(/פנויים|מלא/, { timeout: 15_000 });

    await page.getByRole("button", { name: "שימי", exact: true }).click();
    await expect(dayChip(page, 2)).toContainText("סגור", { timeout: 15_000 });

    await page.getByRole("button", { name: "יומן א", exact: true }).click();
    await expect(dayChip(page, 2)).not.toContainText("סגור", { timeout: 15_000 });
  });
});

test.describe("the business's booking window", () => {
  test("a notice of days sends the customer to the phone, and a day off stays closed", async ({ page }) => {
    const shop = await aShop("הודעה מראש");
    await settings(shop, { minimumNoticeMinutes: 3 * 24 * 60 });
    await closed(shop, 1);

    await openTheBusiness(page, shop.business.id);

    await expect(page.getByText("כאן קובעים לפחות 3 ימים מראש. לתור קרוב יותר")).toBeVisible();
    await expect(dayChip(page, 0)).toContainText("בטלפון", { timeout: 15_000 });
    await expect(dayChip(page, 1)).toContainText("סגור");
    await expect(dayChip(page, 2)).toContainText("בטלפון");
    for (const early of [0, 1, 2]) await expect(dayChip(page, early)).toHaveAttribute("aria-checked", "false");

    await dayChip(page, 0).click();
    await expect(page.getByText("קרוב מדי לקביעה באתר")).toBeVisible();
    await expect(page.getByText("העסק מקבל כאן תורים 3 ימים מראש.", { exact: false })).toBeVisible();
    // The header's own call button names the number too; these two are the window's.
    const calls = page.getByRole("link", { name: "התקשרו לעסק", exact: true });
    await expect(calls).toHaveCount(2);
    await expect(calls.first()).toHaveAttribute("href", /^tel:\+972/);
    await expect(page.getByRole("button", { name: /הודיעו לי/ })).toHaveCount(0);
  });

  test("hours inside the notice are not offered for waiting, though they hold no booking", async ({ page }) => {
    test.skip(minutesNow() < 12 * 60 + 30, "The morning is inside the notice only once it has passed today.");
    const shop = await aShop("המתנה בתוך ההודעה");
    await settings(shop, { minimumNoticeMinutes: 3 * 24 * 60 });

    await openTheBusiness(page, shop.business.id);
    await dayChip(page, 3).click();

    await expect(times(page).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "הודיעו לי אם מתפנה בוקר" })).toHaveCount(0);
  });

  test("the default hour's notice draws no line above the days", async ({ page }) => {
    const shop = await aShop("שעה מראש");
    await openTheBusiness(page, shop.business.id);
    await expect(times(page).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/כאן קובעים לפחות/)).toHaveCount(0);
  });

  test("a week's window ends on its partly open last day, then the day that opens tomorrow", async ({ page }) => {
    const shop = await aShop("שבוע");
    await settings(shop, { bookingHorizonDays: 7 });
    const last = lastBookableDay(7);

    await openTheBusiness(page, shop.business.id);

    await expect(strip(page).getByRole("radio")).toHaveCount(8);
    await expect(strip(page).getByRole("radio").last()).toHaveAttribute("data-date", last);
    const tile = strip(page).getByRole("note");
    await expect(tile).toContainText(shortDate(aDayFromNow(8)));
    await expect(tile).toContainText("נפתח מחר");
    await expect(page.getByRole("button", { name: "כל החודש" })).toHaveCount(0);

    // Cut at this minute, the last day holds open time on both sides of the cut
    // unless the cut falls within half an hour of either midnight.
    test.skip(minutesNow() < 60 || minutesNow() > 23 * 60, "The last day is only partly open away from midnight.");
    await dayChip(page, 7).click();
    await expect(times(page).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("עוד תורים ביום הזה ייפתחו בהמשך היום.")).toBeVisible();
  });

  test("a one-day window offers today and tomorrow", async ({ page }) => {
    const shop = await aShop("יום אחד");
    await settings(shop, { bookingHorizonDays: 1 });

    await openTheBusiness(page, shop.business.id);

    await expect(strip(page).getByRole("radio")).toHaveCount(2);
    await expect(strip(page).getByRole("note")).toContainText("נפתח מחר");
  });

  test("nothing free in a short window says how the window moves", async ({ page }) => {
    const shop = await aShop("חלון מלא");
    await settings(shop, { bookingHorizonDays: 3 });
    await closed(shop, 0, 3);

    await openTheBusiness(page, shop.business.id);

    await expect(page.getByText("אין תור פנוי בימים שהיומן פתוח")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/העסק פותח את היומן 3 ימים קדימה, וכל יום נפתח עוד יום\./)).toBeVisible();
    await expect(dayChip(page, 0)).toHaveAttribute("aria-checked", "true");
  });

  test("nothing free in the first two weeks points to the month", async ({ page }) => {
    const shop = await aShop("שבועיים סגורים");
    await closed(shop, 0, 13);

    await openTheBusiness(page, shop.business.id);

    await expect(page.getByText("אין תור פנוי בשבועיים הקרובים")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/אפשר לחפש בהמשך, בכל החודש\./)).toBeVisible();
    await expect(page.getByText(/אפשר לבחור יום מלא ולבקש שנודיע/)).toBeVisible();
  });
});

test.describe("the whole month", () => {
  test("pages through the window's months, and no further", async ({ page }) => {
    const shop = await aShop("חודש");
    await openTheBusiness(page, shop.business.id);
    await page.getByRole("button", { name: "כל החודש" }).click();

    const sheet = page.getByRole("dialog");
    const monthOf = (date: string) =>
      new Intl.DateTimeFormat("he-IL", { timeZone: ZONE, month: "long", year: "numeric" }).format(new Date(`${date}T12:00:00Z`));
    await expect(sheet.getByRole("heading")).toHaveText(monthOf(aDayFromNow(0)));
    await expect(sheet.getByRole("button", { name: "החודש הקודם" })).toBeDisabled();

    const last = lastBookableDay(60);
    const months =
      (Number(last.slice(0, 4)) - Number(aDayFromNow(0).slice(0, 4))) * 12 +
      Number(last.slice(5, 7)) -
      Number(aDayFromNow(0).slice(5, 7));
    for (let step = 0; step < months; step += 1) {
      await sheet.getByRole("button", { name: "החודש הבא" }).click();
    }
    await expect(sheet.getByRole("heading")).toHaveText(monthOf(last));
    await expect(sheet.getByRole("button", { name: "החודש הבא" })).toBeDisabled();
  });

  test("a day past the window says when it opens", async ({ page }) => {
    const shop = await aShop("עוד לא נפתח");
    await settings(shop, { bookingHorizonDays: 20 });
    const last = lastBookableDay(20);
    // A day at least two past the window, in its last month, so it opens on a
    // date rather than tomorrow.
    const beyond = [2, 3, 4, 5, 6].map((extra) => {
      const date = new Date(`${last}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + extra);
      return date.toISOString().slice(0, 10);
    }).find((date) => date.slice(0, 7) === last.slice(0, 7));
    test.skip(beyond === undefined, "The window ends at its month's very end today.");
    const opens = new Date(`${beyond!}T00:00:00Z`);
    opens.setUTCDate(opens.getUTCDate() - 20);
    const opensOn = opens.toISOString().slice(0, 10);

    await openTheBusiness(page, shop.business.id);
    await page.getByRole("button", { name: "כל החודש" }).click();
    const sheet = page.getByRole("dialog");
    const cell = await showInTheSheet(page, beyond!);

    await expect(cell).toHaveAccessibleName(new RegExp(`ייפתח לקביעה ב-${shortDate(opensOn)}$`));
    await cell.click();
    await expect(sheet.getByText(`${shortDate(beyond!)} עוד לא נפתח לקביעה. התורים בו ייפתחו ב-${shortDate(opensOn)}.`)).toBeVisible();
    // Still open: a day not open yet is something to read, not to pick.
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("עוד לא נפתח", { exact: true })).toBeVisible();
  });

  test("the day right after the window opens tomorrow", async ({ page }) => {
    const shop = await aShop("מחר נפתח");
    await settings(shop, { bookingHorizonDays: 20 });
    const after = new Date(`${lastBookableDay(20)}T00:00:00Z`);
    after.setUTCDate(after.getUTCDate() + 1);
    const date = after.toISOString().slice(0, 10);

    await openTheBusiness(page, shop.business.id);
    await page.getByRole("button", { name: "כל החודש" }).click();
    const sheet = page.getByRole("dialog");
    test.skip((await showInTheSheet(page, date).then((cell) => cell.count())) === 0, "It falls in a month past the window's last.");
    await (await showInTheSheet(page, date)).click();
    await expect(sheet.getByText(`${shortDate(date)} עוד לא נפתח לקביעה. התורים בו ייפתחו מחר.`)).toBeVisible();
  });

  test("picking a day three weeks out brings it into the days, ready to book", async ({ page }) => {
    const shop = await aShop("שלושה שבועות");
    const far = aDayFromNow(21);
    const free = (await offered(shop, shop.resource.id, far)).length;
    await openTheBusiness(page, shop.business.id);
    await page.getByRole("button", { name: "כל החודש" }).click();
    const sheet = page.getByRole("dialog");
    const cell = await showInTheSheet(page, far);
    await expect(cell).toHaveAccessibleName(new RegExp(`, ${free} תורים פנויים$`), { timeout: 15_000 });
    await cell.click();

    await expect(sheet).toBeHidden();
    const chosen = strip(page).locator(`[data-date="${far}"]`);
    await expect(chosen).toHaveAttribute("aria-checked", "true");
    await expect(chosen).toContainText(`${free} פנויים`);
    await expect(strip(page).getByRole("radio")).toHaveCount(28);

    await times(page).first().click();
    await expect(page.getByRole("button", { name: "אישור התור" })).toBeVisible();
  });

  test("arrow keys move through the month the way it reads", async ({ page }) => {
    const shop = await aShop("מקלדת");
    await openTheBusiness(page, shop.business.id);
    await page.getByRole("button", { name: "כל החודש" }).click();
    const sheet = page.getByRole("dialog");

    const start = aDayFromNow(1);
    await expect(sheet).toBeVisible();
    await (await showInTheSheet(page, start)).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator(":focus")).toHaveAttribute("data-date", aDayFromNow(2));
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(":focus")).toHaveAttribute("data-date", aDayFromNow(9));
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(":focus")).toHaveAttribute("data-date", aDayFromNow(8));
    await page.keyboard.press("ArrowUp");
    await expect(page.locator(":focus")).toHaveAttribute("data-date", aDayFromNow(1));
  });

  test("a window of two weeks or less has no month to open", async ({ page }) => {
    const shop = await aShop("בלי חודש");
    await settings(shop, { bookingHorizonDays: 13 });
    await openTheBusiness(page, shop.business.id);
    await expect(strip(page).getByRole("radio")).toHaveCount(14);
    await expect(page.getByRole("button", { name: "כל החודש" })).toHaveCount(0);
  });
});

test.describe("when suits the customer", () => {
  const eveningsOf = async (shop: Awaited<ReturnType<typeof aShop>>, date: string) =>
    (await offered(shop, shop.resource.id, date)).filter((clock) => clock >= "17:00");

  test("a time of day counts every day by it, and shows only its times", async ({ page }) => {
    const shop = await aShop("ערב", { start: "09:00", end: "20:00" });
    const day = aDayFromNow(3);
    const evenings = await eveningsOf(shop, day);
    await aChange(shop, {
      scope: { kind: "CALENDAR", resourceId: shop.resource.id },
      outcome: "OTHER_HOURS",
      fromDate: aDayFromNow(2),
      ranges: [{ start: "09:00", end: "11:00" }],
    });

    await openTheBusiness(page, shop.business.id);
    const when = page.getByRole("radiogroup", { name: "מתי נוח לכם?" });
    await expect(when.getByRole("radio", { name: "בכל שעה" })).toHaveAttribute("aria-checked", "true");
    await when.getByRole("radio", { name: "ערב" }).click();

    await expect(dayChip(page, 3)).toContainText(`${evenings.length} בערב`, { timeout: 15_000 });
    await expect(dayChip(page, 2)).toContainText("אין בערב");

    await dayChip(page, 3).click();
    await expect(times(page).first()).toBeVisible();
    const shown = await times(page).allTextContents();
    expect(shown).toEqual(evenings);
  });

  test("a day with nothing at that time offers every hour of it", async ({ page }) => {
    const shop = await aShop("כל השעות", { start: "09:00", end: "20:00" });
    await aChange(shop, {
      scope: { kind: "CALENDAR", resourceId: shop.resource.id },
      outcome: "OTHER_HOURS",
      fromDate: aDayFromNow(2),
      ranges: [{ start: "09:00", end: "11:00" }],
    });
    await openTheBusiness(page, shop.business.id);
    const when = page.getByRole("radiogroup", { name: "מתי נוח לכם?" });
    await when.getByRole("radio", { name: "ערב" }).click();

    await dayChip(page, 2).click();
    await expect(page.getByText("אין תורים פנויים בערב ביום הזה")).toBeVisible();
    await page.getByRole("button", { name: "כל השעות ביום הזה" }).click();

    await expect(when.getByRole("radio", { name: "בכל שעה" })).toHaveAttribute("aria-checked", "true");
    await expect(times(page).filter({ hasText: "09:00" })).toBeVisible();
  });

  test("the choice is remembered on the next visit", async ({ page }) => {
    const shop = await aShop("זוכר");
    await openTheBusiness(page, shop.business.id);
    const when = page.getByRole("radiogroup", { name: "מתי נוח לכם?" });
    await when.getByRole("radio", { name: "צהריים" }).click();

    await page.reload();
    await ready(page);
    await expect(
      page.getByRole("radiogroup", { name: "מתי נוח לכם?" }).getByRole("radio", { name: "צהריים" }),
    ).toHaveAttribute("aria-checked", "true", { timeout: 15_000 });
  });

  test("the page opens on the first day with room at the chosen time", async ({ page }) => {
    const shop = await aShop("ערב ראשון", { start: "09:00", end: "20:00" });
    await aChange(shop, {
      scope: { kind: "CALENDAR", resourceId: shop.resource.id },
      outcome: "OTHER_HOURS",
      fromDate: aDayFromNow(0),
      toDate: aDayFromNow(2),
      ranges: [{ start: "09:00", end: "11:00" }],
    });
    await page.addInitScript(() => window.localStorage.setItem("tor-now.when", "evening"));

    await openTheBusiness(page, shop.business.id);

    await expect(dayChip(page, 3)).toHaveAttribute("aria-checked", "true", { timeout: 15_000 });
    await expect(dayChip(page, 3)).toContainText("בערב");
  });
});

test.describe("in English", () => {
  test("the days say the same things", async ({ page }) => {
    await useEnglish(page);
    const shop = await aShop("English");
    await closed(shop, 0);
    await page.goto(`/business/${shop.business.id}`);
    await ready(page);

    const days = page.getByRole("radiogroup", { name: "Choose a day" });
    await expect(days.getByRole("radio").first()).toContainText("Closed", { timeout: 15_000 });
    await expect(days.getByRole("radio").nth(1)).toContainText(/\d+ free/);
    await expect(page.getByRole("radiogroup", { name: "When suits you?" }).getByRole("radio", { name: "Any time" })).toBeVisible();
    await page.getByRole("button", { name: "Whole month" }).click();
    await expect(page.getByRole("button", { name: "Next month" })).toBeVisible();
  });
});

test.describe("the owner's booking window", () => {
  test("a notice longer than the horizon cannot be saved, and says why", async ({ page }) => {
    const shop = await aShop("הגדרות חלון");
    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto("/manage");
    await ready(page);
    await page.getByRole("button", { name: "העסק" }).click();
    await page.getByRole("button", { name: "הגדרות העסק" }).click();

    await page.getByLabel(/עד כמה קרוב אפשר לתפוס תור/).fill("10080");
    await page.getByLabel(/עד כמה רחוק אפשר לתפוס תור/).fill("5");
    const refusal = page.getByText(
      "עם ההגדרות האלה אף לקוח לא יוכל לקבוע: צריך לקבוע 7 ימים מראש, אבל היומן פתוח רק 5 ימים קדימה. קצרו את הראשון או הגדילו את השני.",
    );
    await expect(refusal).toBeVisible();
    await expect(page.getByRole("button", { name: "שמירה" })).toBeDisabled();

    await page.getByLabel(/עד כמה רחוק אפשר לתפוס תור/).fill("8");
    await expect(refusal).toBeHidden();
    await page.getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByText("ההגדרות נשמרו.")).toBeVisible({ timeout: 15_000 });

    const profile = await call<{ business: { minimumNoticeMinutes: number; bookingHorizonDays: number } }>(
      `/businesses/${shop.business.id}`,
    );
    expect(profile.business).toMatchObject({ minimumNoticeMinutes: 10080, bookingHorizonDays: 8 });
  });
});
