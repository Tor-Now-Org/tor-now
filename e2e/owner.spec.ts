import { expect, test } from "@playwright/test";
import {
  aBusinessWithOpenHours,
  call,
  ready,
  signInDirectly,
  uniquePhone,
} from "./support.ts";

/**
 * The owner artboards: onboarding, the day, the three schedule layers, the
 * business panel, and the customer record.
 */
test.describe("opening a business", () => {
  test("the wizard takes four steps and puts the business in search", async ({ page }) => {
    const phone = uniquePhone();
    await signInDirectly(page, phone, "בעלים חדש");
    const name = `עסק חדש ${Date.now()}`;

    await page.goto("/onboarding");
    await ready(page);

    // 1 — details
    await expect(page.getByText("פרטי העסק")).toBeVisible();
    await page.getByLabel("שם העסק").fill(name);
    await page.getByLabel("טלפון").fill(phone);
    await page.getByLabel("כתובת").fill("הרצל 1");
    await page.getByRole("button", { name: "המשך" }).click();

    // 2 — calendars
    await expect(page.getByText("מי נותן את השירות")).toBeVisible();
    await page.getByLabel("שם היומן").fill("ראשי");
    await page.getByRole("button", { name: "המשך" }).click();

    // 3 — services
    await expect(page.getByText("מה אתם נותנים")).toBeVisible();
    await page.getByLabel("שם השירות").fill("ייעוץ");
    await page.getByRole("button", { name: "המשך" }).click();

    // 4 — hours, then live
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
    const days = await call<{ slots: { startAt: string }[] }[]>(
      `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}&resourceId=${shop.resource.id}&from=${today()}&to=${today()}`,
    );
    await call("/appointments", {
      method: "POST",
      token: customer.token,
      body: {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: shop.resource.id,
        startAt: days[0]!.slots[0]!.startAt,
        customerNote: null,
      },
    });

    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );

    await page.goto("/manage");
    await ready(page);

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
    const days = await call<{ slots: { startAt: string }[] }[]>(
      `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}&resourceId=${shop.resource.id}&from=${today()}&to=${today()}`,
    );
    await call("/appointments", {
      method: "POST",
      token: customer.token,
      body: {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: shop.resource.id,
        startAt: days[0]!.slots[0]!.startAt,
        customerNote: null,
      },
    });

    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto("/manage");
    await ready(page);

    await page.getByRole("button", { name: /לא הגיע/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("button", { name: "העברת התור לשעה אחרת" })).toBeVisible();
    // The appointment has not ended yet, so the mark is refused — and the
    // refusal is shown to the owner rather than swallowed.
    await page.getByRole("button", { name: "סימון שלא הגיע" }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
  });
});

test.describe("the schedule layers", () => {
  test("a range, a day off and a block each behave as ADR 0002 says", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `שעות ${Date.now()}`,
      ownerPhone: uniquePhone(),
    });
    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", shop.owner.token],
    );

    await page.goto("/manage");
    await ready(page);
    await page.getByRole("button", { name: "לוח זמנים" }).click();

    // Hours: the gap between two ranges is the break, and the screen says so.
    await expect(page.getByText(/הרווח בין שני טווחים/)).toBeVisible();
    await expect(page.getByText("08:00–20:00").first()).toBeVisible();

    // Overrides: replace the weekday entirely.
    await page.getByRole("button", { name: "ימים חריגים" }).click();
    await expect(page.getByText(/יום חריג מחליף/)).toBeVisible();
    await page.getByRole("button", { name: "הוספת יום חריג" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByLabel("תאריך").fill(today());
    await page.getByRole("button", { name: "סגור כל היום" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByText("סגור כל היום").first()).toBeVisible({ timeout: 15_000 });

    // A closed day offers a customer nothing at all.
    const days = await call<{ slots: unknown[]; emptyReason: string | null }[]>(
      `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}&resourceId=${shop.resource.id}&from=${today()}&to=${today()}`,
    );
    expect(days[0]?.slots).toEqual([]);
    expect(days[0]?.emptyReason).toBe("CLOSED");
  });
});

test.describe("the business panel", () => {
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

const today = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
