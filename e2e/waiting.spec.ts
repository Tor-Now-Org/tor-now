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

  test("a full day offers to tell the customer, and remembers the ask", async ({ page }) => {
    const { shop, day } = await aShopWithNoRoom(`מלא ${Date.now()}`);
    await signInDirectly(page, uniquePhone(), "דנה");

    await page.goto(`/business/${shop.business.id}`);
    await ready(page);
    await page.getByRole("button", { name: /תספורת/ }).click();
    await showDay(page, 3);

    await expect(page.getByText("אין תורים פנויים ביום הזה")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: /הודיעו לי אם מתפנה תור/ }).click();

    // The sheet arrives pre-answered: the service, the day and the calendar
    // all came from the screen behind.
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("הודיעו לי אם מתפנה")).toBeVisible();
    await sheet.getByRole("button", { name: "בוקר" }).click();
    await sheet.getByRole("button", { name: "הודיעו לי", exact: true }).click();

    await expect(page.getByText(/נוסיף אתכם לרשימה/)).toBeVisible({ timeout: 15_000 });

    // And it is waiting for them in their own list, above the appointments.
    await page.getByRole("button", { name: "התורים שלי" }).click();
    await expect(page.getByText("ממתינים לשעה")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(new RegExp(shop.business.name)).first()).toBeVisible();

    // Withdrawing is one tap, which is what keeps the list worth notifying.
    await page.getByRole("button", { name: /הסרה/ }).first().click();
    await expect(page.getByText("ממתינים לשעה")).toHaveCount(0);
    expect(day).toBe(aDayFromNow(3));
  });

  /**
   * The half-full day: the offer belongs inside the part that is empty, not
   * at the bottom of a day that still has hours in it.
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
    await signInDirectly(page, uniquePhone(), "עומר");

    await page.goto(`/business/${shop.business.id}`);
    await ready(page);
    await page.getByRole("button", { name: /תספורת/ }).click();
    await showDay(page, 3);

    // Hours exist, so this is not the empty-day path.
    await expect(page.locator("[role=radio]").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /הודיעו לי אם מתפנה בוקר/ })).toBeVisible();
    // And the part that has times offers no such thing.
    await expect(page.getByRole("button", { name: /הודיעו לי אם מתפנה צהריים/ })).toHaveCount(0);
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
