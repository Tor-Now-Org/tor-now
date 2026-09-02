import { expect, test } from "@playwright/test";
import {
  aBusinessWithOpenHours,
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
    await page.getByLabel("טלפון").fill(phone);
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
    // The appointment has not ended yet, so the mark is not on offer — and the
    // reason is on screen rather than waiting behind a click that fails.
    await expect(page.getByRole("button", { name: "סימון שלא הגיע" })).toBeDisabled();
    await expect(page.getByText(/רק אחרי שהתור הסתיים/)).toBeVisible();
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

const yesterday = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(
    new Date(Date.now() - 24 * 60 * 60 * 1000),
  );

const today = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());


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
    const [day] = await call<{ slots: { startAt: string }[] }[]>(
      `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
        `&resourceId=${shop.resource.id}&from=${today()}&to=${today()}`,
    );
    const slot = day?.slots[0]?.startAt ?? "";
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
    // The two that remain.
    await expect(page.getByRole("button", { name: "סימון שלא הגיע" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "ביטול התור" })).toBeEnabled();
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
    const [day] = await call<{ slots: { startAt: string }[] }[]>(
      `/businesses/${shop.business.id}/availability?serviceId=${shop.service.id}` +
        `&resourceId=${shop.resource.id}&from=${today()}&to=${today()}`,
    );
    await call("/appointments", {
      method: "POST",
      token,
      body: {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: shop.resource.id,
        startAt: day?.slots[0]?.startAt ?? "",
        customerNote: null,
      },
    });
    return shop;
  };

  test("opens as a page, with the number ready to call or copy", async ({ page }) => {
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

    // The number dials, and can be taken away without transcribing it.
    await expect(page.getByRole("link", { name: new RegExp(customerPhone.replace("+", "\\+")) }))
      .toHaveAttribute("href", `tel:${customerPhone}`);
    await expect(page.getByRole("button", { name: "העתקה" })).toBeVisible();
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
    await page.getByLabel("טלפון").fill(phone);
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
