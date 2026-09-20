import { expect, test } from "@playwright/test";
import {
  aBusinessWithOpenHours,
  aDayFromNow,
  call,
  openTheDayOf,
  ready,
  showDay,
  signInDirectly,
  uniquePhone,
} from "./support.ts";

/**
 * ADR 0018. Waiting for a time.
 *
 * The journeys worth having end to end are the ones that cross the seam: a
 * customer who finds nothing and asks to be told, an owner deciding what
 * becomes of an hour they are freeing, and the message actually being written
 * when the day changes. What counts as morning, and what counts as free, are
 * settled in unit tests where they can be asked precisely.
 */
test.describe("waiting for a time", () => {
  /**
   * A shop whose day is genuinely taken: four hours, a sixty-minute service,
   * four appointments. A day that merely looks full is the mistake this
   * feature must not make, so the fixture does not make it either.
   */
  const aShopWithNoRoom = async (name: string) => {
    const shop = await aBusinessWithOpenHours({
      name,
      ownerPhone: uniquePhone(),
      serviceName: "תספורת",
      durationMinutes: 60,
      hours: { start: "09:00", end: "13:00" },
    });
    const day = aDayFromNow(3);

    const [available] = await call<{ slots: { startAt: string }[] }[]>(
      `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
        `&resourceId=${shop.resource.id}&from=${day}&to=${day}`,
    );
    const taken = [];
    for (const [nth, slot] of (available?.slots ?? []).entries()) {
      const phone = uniquePhone();
      const { code } = await call<{ code: string }>("/auth/request-code", {
        method: "POST",
        body: { phone },
      });
      // Named distinctly, and not with a word the interface itself uses: a
      // customer called "לקוח" is findable only by a locator loose enough to
      // find the header's own לקוח / ניהול switch instead.
      const { token } = await call<{ token: string }>("/auth/verify", {
        method: "POST",
        body: {
          phone,
          code,
          name: { givenName: "איתי", familyName: `רוזן${nth}` },
        },
      });
      taken.push(
        await call<{ id: string }>("/appointments", {
          method: "POST",
          token,
          body: {
            businessId: shop.business.id,
            serviceId: shop.service.id,
            resourceId: shop.resource.id,
            startAt: slot.startAt,
            customerNote: null,
          },
        }),
      );
    }

    expect(taken.length, "the fixture did not manage to fill the day").toBeGreaterThan(0);
    return { shop, day, taken };
  };


  /** Opens the business, picks the service, and lands on a chosen day. */
  const openTheDay = async (
    page: import("@playwright/test").Page,
    businessId: string,
    daysAhead: number,
  ) => {
    await page.goto(`/business/${businessId}`);
    await ready(page);
    await page.getByRole("button", { name: /תספורת/ }).click();
    await showDay(page, daysAhead);
  };

  const offer = (page: import("@playwright/test").Page) =>
    page.getByRole("button", { name: /הודיעו לי אם מתפנה תור/ });
  /** However it is worded — the whole day, or the parts being waited for. */
  const onTheList = (page: import("@playwright/test").Page) =>
    page.getByRole("button", { name: /אתם ברשימת ההמתנה/ });

  test("a full day offers to tell the customer, and remembers the ask", async ({ page }) => {
    const { shop } = await aShopWithNoRoom(`מלא ${Date.now()}`);
    await signInDirectly(page, uniquePhone(), "דנה");

    await openTheDay(page, shop.business.id, 3);
    await expect(page.getByText("אין תורים פנויים ביום הזה")).toBeVisible({ timeout: 15_000 });
    await offer(page).click();

    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("הודיעו לי אם מתפנה")).toBeVisible();
    await sheet.getByRole("button", { name: "בוקר", exact: true }).click();
    await sheet.getByRole("button", { name: "הודיעו לי", exact: true }).click();

    // The button that was pressed is the confirmation: it says what is true
    // now, where the person is looking.
    await expect(onTheList(page)).toBeVisible({ timeout: 15_000 });

    // And it is waiting for them in their own list, above the appointments.
    await page.getByRole("button", { name: "התורים שלי" }).click();
    await expect(page.getByText("ברשימת המתנה")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(new RegExp(shop.business.name)).first()).toBeVisible();

    // Withdrawing is one tap, which is what keeps the list worth notifying.
    await page.getByRole("button", { name: /הסרה/ }).first().click();
    await expect(page.getByText("ברשימת המתנה")).toHaveCount(0);
  });

  /**
   * The button is the screen's memory. One that still says "tell me" after
   * being told is a screen that has forgotten what it was just asked, and the
   * second press is somebody checking whether the first one worked.
   */
  test("the offer becomes a statement once they are on the list", async ({ page }) => {
    const { shop } = await aShopWithNoRoom(`זיכרון ${Date.now()}`);
    await signInDirectly(page, uniquePhone(), "עומר");

    await openTheDay(page, shop.business.id, 3);
    await offer(page).click();
    await page.getByRole("dialog").getByRole("button", { name: "הודיעו לי", exact: true }).click();

    await expect(onTheList(page)).toBeVisible({ timeout: 15_000 });
    await expect(offer(page)).toHaveCount(0);

    // And it survives coming back to the screen, because it is read from the
    // server rather than remembered in the page.
    await openTheDay(page, shop.business.id, 3);
    await expect(onTheList(page)).toBeVisible({ timeout: 15_000 });
  });

  /**
   * The bug this suite exists for. With everything chosen the named chips were
   * drawn as unselected, so pressing one removed it from a set nobody could
   * see they were in: two chips they never touched lit up, and the one they
   * pressed went dark.
   */
  test("the hour chips do what they look like they do", async ({ page }) => {
    const { shop } = await aShopWithNoRoom(`צ׳יפים ${Date.now()}`);
    await signInDirectly(page, uniquePhone(), "נועם");

    await openTheDay(page, shop.business.id, 3);
    await offer(page).click();
    const sheet = page.getByRole("dialog");
    const chip = (name: string) => sheet.getByRole("button", { name, exact: true });

    // Opened on the whole day, so "any" is what is showing and no part is.
    await expect(chip("לא משנה").first()).toHaveAttribute("aria-pressed", "true");
    await expect(chip("בוקר")).toHaveAttribute("aria-pressed", "false");

    // Pressing a part narrows to that part — it does not remove it.
    await chip("בוקר").click();
    await expect(chip("בוקר")).toHaveAttribute("aria-pressed", "true");
    await expect(chip("צהריים")).toHaveAttribute("aria-pressed", "false");
    await expect(chip("ערב")).toHaveAttribute("aria-pressed", "false");
    await expect(chip("לא משנה").first()).toHaveAttribute("aria-pressed", "false");

    // A second one joins it.
    await chip("ערב").click();
    await expect(chip("בוקר")).toHaveAttribute("aria-pressed", "true");
    await expect(chip("ערב")).toHaveAttribute("aria-pressed", "true");

    // Taking one away leaves the other.
    await chip("ערב").click();
    await expect(chip("בוקר")).toHaveAttribute("aria-pressed", "true");
    await expect(chip("ערב")).toHaveAttribute("aria-pressed", "false");

    // And taking away the last returns to "any" rather than to nothing, so the
    // confirm button can never be pressed on an empty question.
    await chip("בוקר").click();
    await expect(chip("לא משנה").first()).toHaveAttribute("aria-pressed", "true");
    await expect(chip("בוקר")).toHaveAttribute("aria-pressed", "false");

    await sheet.getByRole("button", { name: "הודיעו לי", exact: true }).click();
    await expect(onTheList(page)).toBeVisible({ timeout: 15_000 });
  });

  test("the sheet re-opens on what was asked for, and can change it", async ({ page }) => {
    const { shop } = await aShopWithNoRoom(`שינוי ${Date.now()}`);
    await signInDirectly(page, uniquePhone(), "גיא");

    await openTheDay(page, shop.business.id, 3);
    await offer(page).click();
    let sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "בוקר", exact: true }).click();
    await sheet.getByRole("button", { name: "הודיעו לי", exact: true }).click();
    await expect(onTheList(page)).toBeVisible({ timeout: 15_000 });

    // Re-opened, it shows what is standing rather than starting afresh.
    await onTheList(page).click();
    sheet = page.getByRole("dialog");
    await expect(sheet.getByText("שינוי ההמתנה")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "בוקר", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Adding the evening, then dropping the morning — which is what "change
    // it to evenings" actually is, two ordinary toggles.
    await sheet.getByRole("button", { name: "ערב", exact: true }).click();
    await expect(sheet.getByRole("button", { name: "בוקר", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await sheet.getByRole("button", { name: "בוקר", exact: true }).click();
    await expect(sheet.getByRole("button", { name: "ערב", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await sheet.getByRole("button", { name: "שמירת השינוי" }).click();
    // The day has nothing at all, so there is one button for it — and it names
    // the part being waited for rather than claiming the whole day.
    await expect(
      page.getByRole("button", { name: /אתם ברשימת ההמתנה לערב/ }),
    ).toBeVisible({ timeout: 15_000 });

    // One entry, not two: asking twice is the same ask.
    await page.getByRole("button", { name: "התורים שלי" }).click();
    await expect(page.getByRole("button", { name: /הסרה/ })).toHaveCount(1);
    await expect(page.getByText(/ערב/).first()).toBeVisible();
  });

  test("leaving the list from the sheet puts the offer back", async ({ page }) => {
    const { shop } = await aShopWithNoRoom(`עזיבה ${Date.now()}`);
    await signInDirectly(page, uniquePhone(), "דור");

    await openTheDay(page, shop.business.id, 3);
    await offer(page).click();
    await page.getByRole("dialog").getByRole("button", { name: "הודיעו לי", exact: true }).click();
    await expect(onTheList(page)).toBeVisible({ timeout: 15_000 });

    await onTheList(page).click();
    await page.getByRole("dialog").getByRole("button", { name: "הסרה מהרשימה" }).click();
    await expect(offer(page)).toBeVisible({ timeout: 15_000 });
    await expect(onTheList(page)).toHaveCount(0);
  });

  /**
   * The half-full day: the offer belongs inside the part that is empty, not at
   * the bottom of a day that still has hours in it.
   */
  test("offers the empty part of a day that still has other hours", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `אחר הצהריים בלבד ${Date.now()}`,
      ownerPhone: uniquePhone(),
      serviceName: "תספורת",
      durationMinutes: 60,
      // Opens at noon: there is no morning to be had, and an evening there is.
      hours: { start: "12:00", end: "20:00" },
    });
    await signInDirectly(page, uniquePhone(), "שירה");

    await openTheDay(page, shop.business.id, 3);
    await expect(
      page.locator("[role=radio]", { hasText: /^\d\d:\d\d$/ }).first(),
    ).toBeVisible({ timeout: 15_000 });

    const morning = page.getByRole("button", { name: /הודיעו לי אם מתפנה בוקר/ });
    await expect(morning).toBeVisible();
    // The parts that have times offer no such thing.
    await expect(page.getByRole("button", { name: /הודיעו לי אם מתפנה צהריים/ })).toHaveCount(0);
    await expect(offer(page)).toHaveCount(0);

    // Pressing it opens the sheet already narrowed to that part.
    await morning.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("button", { name: "בוקר", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(sheet.getByRole("button", { name: "לא משנה" }).first()).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await sheet.getByRole("button", { name: "הודיעו לי", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /אתם ברשימת ההמתנה לבוקר/ }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("a shop with one calendar is not asked which calendar", async ({ page }) => {
    const { shop } = await aShopWithNoRoom(`יומן אחד ${Date.now()}`);
    await signInDirectly(page, uniquePhone(), "תמר");

    await openTheDay(page, shop.business.id, 3);
    await offer(page).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("אילו שעות מתאימות")).toBeVisible();
    await expect(sheet.getByText("אצל מי")).toHaveCount(0);
  });

  /**
   * Waiting needs somebody to message. A visitor who has not verified is taken
   * through the same verification booking uses rather than told no.
   */
  test("a visitor who has not verified is asked to, not refused", async ({ page }) => {
    const { shop } = await aShopWithNoRoom(`אורח ${Date.now()}`);

    await openTheDay(page, shop.business.id, 3);
    await offer(page).click();
    await page.getByRole("dialog").getByRole("button", { name: "הודיעו לי", exact: true }).click();

    await expect(page.getByText(/אימות|קוד/).first()).toBeVisible({ timeout: 15_000 });
  });

  /** Somebody who books the thing they were waiting for is no longer waiting. */
  test("booking the day closes the wait", async ({ page }) => {
    const { shop, day, taken } = await aShopWithNoRoom(`נסגר ${Date.now()}`);
    await signInDirectly(page, uniquePhone(), "מיכל");

    await openTheDay(page, shop.business.id, 3);
    await offer(page).click();
    await page.getByRole("dialog").getByRole("button", { name: "הודיעו לי", exact: true }).click();
    await expect(onTheList(page)).toBeVisible({ timeout: 15_000 });

    // An hour frees, and she takes it.
    await call(`/appointments/${taken[0]!.id}/cancel`, {
      method: "POST",
      token: shop.owner.token,
      body: { publishFreedTime: true },
    });
    await openTheDay(page, shop.business.id, 3);
    // The times, not the date strip: both are radios, and "the first radio on
    // the page" is a day rather than an hour.
    const times = page.locator("[role=radio]", { hasText: /^\d\d:\d\d$/ });
    await expect(times.first()).toBeVisible({ timeout: 15_000 });
    await times.first().click();
    await page.getByRole("button", { name: "אישור התור" }).click();
    await expect(page.getByText("התור נקבע")).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "התורים שלי" }).click();
    await expect(page.getByText("תספורת").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("ברשימת המתנה")).toHaveCount(0);
    expect(day).toBeTruthy();
  });

  test("an owner cancelling chooses what becomes of the hour", async ({ page }) => {
    const { shop, day, taken } = await aShopWithNoRoom(`בחירת בעלים ${Date.now()}`);
    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );

    await page.goto(`/manage?business=${shop.business.id}`);
    await ready(page);
    await openTheDayOf(page, day);
    await page.getByRole("button").filter({ hasText: "רוזן0" }).first().click();

    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("השעה שתתפנה")).toBeVisible({ timeout: 15_000 });

    // Publishing is the default, and the button says what it will do.
    await expect(sheet.getByRole("button", { name: "לפרסם" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(sheet.getByRole("button", { name: "ביטול ופרסום השעה" })).toBeVisible();

    // Choosing to keep it changes both the explanation and the commitment.
    await sheet.getByRole("button", { name: "לשמור לי" }).click();
    await expect(sheet.getByText(/לא יישלחו הודעות/)).toBeVisible();
    await sheet.getByRole("button", { name: "ביטול ושמירת השעה" }).click();

    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });
    expect(taken.length).toBeGreaterThan(0);
  });
});
