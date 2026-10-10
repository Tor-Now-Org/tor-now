import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  aBusinessWithOpenHours,
  aDayFromNow,
  anInstantAt,
  asTyped,
  call,
  pickACategory,
  pickAnAddress,
  ready,
  signInDirectly,
  stubAddressSearch,
  uniquePhone,
} from "./support.ts";
import { aShareSheetOnTheDevice, noShareSheetOnTheDevice, readTheCard, sharedOnTheDevice } from "./share-support.ts";

/**
 * ADR 0028: the screen a business opens on, at the end of the wizard. It says
 * it worked, sums up what was made, and offers the one next thing — sharing the
 * link, or paying, for an owner whose Trial was spent on an earlier business.
 */

const A_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const ADDRESS = "הרצל 1, תל אביב יפו, ישראל";

type DraftService = { name: string; minutes?: string; price?: string };

type Wizard = {
  name: string;
  plan?: "SOLO" | "TEAM";
  calendars?: string[];
  services?: DraftService[];
  /** Friday open 09:00–13:00 beside the usual Sunday to Thursday. */
  shortFriday?: boolean;
  photos?: number;
};

/** An owner, signed in, on the pricing page's way into the wizard. */
const anOwner = async (page: Page, phone = uniquePhone()) => {
  await stubAddressSearch(page, ADDRESS);
  const session = await signInDirectly(page, phone, "בעלים חדש");
  return { phone, token: session.token };
};

/** Through the five steps, as an owner types them, and "סיום". */
const openABusiness = async (page: Page, phone: string, wizard: Wizard): Promise<void> => {
  await page.goto(`/onboarding?plan=${wizard.plan ?? "SOLO"}`);
  await ready(page);

  await page.getByLabel("שם העסק").fill(wizard.name);
  await page.getByLabel("טלפון").fill(asTyped(phone));
  await pickAnAddress(page, "הרצל 1");
  await pickACategory(page);
  await page.getByRole("button", { name: "המשך" }).click();

  await expect(page.getByText("תמונה ראשית")).toBeVisible();
  const files = page.locator('input[type="file"]');
  for (let slot = 0; slot < (wizard.photos ?? 0); slot += 1) {
    await files.nth(slot).setInputFiles({ name: `p${slot}.png`, mimeType: "image/png", buffer: A_PNG });
  }
  await page.getByRole("button", { name: "המשך" }).click();

  const calendars = wizard.calendars ?? ["ראשי"];
  for (const [position, calendar] of calendars.entries()) {
    if (position > 0) await page.getByRole("button", { name: "הוספה", exact: true }).click();
    await page.locator(`#resource-${position}`).fill(calendar);
  }
  await page.getByRole("button", { name: "המשך" }).click();

  const services = wizard.services ?? [{ name: "ייעוץ" }];
  for (const [position, service] of services.entries()) {
    if (position > 0) await page.getByRole("button", { name: "הוספת שירות" }).click();
    await page.locator(`#service-name-${position}`).fill(service.name);
    if (service.minutes !== undefined) await page.locator(`#service-minutes-${position}`).fill(service.minutes);
    if (service.price !== undefined) await page.locator(`#service-price-${position}`).fill(service.price);
  }
  await page.getByRole("button", { name: "המשך" }).click();

  await expect(page.getByText("מתי אתם פתוחים")).toBeVisible();
  if (wizard.shortFriday === true) {
    const usual = page.locator(".card", { hasText: "רוב הימים" }).first();
    // Friday joins the usual week, then goes its own way with a shorter day.
    await usual.getByRole("button", { name: "שישי" }).click();
    await usual.getByRole("button", { name: "שישי" }).click();
    const friday = page.locator(".card", { hasText: "שישי" }).filter({ hasNotText: "רוב הימים" }).first();
    await friday.locator('input[type="time"]').nth(1).fill("13:00");
  }
  await page.getByRole("checkbox", { name: /קראתי ואני מסכים/ }).check();
  await page.getByRole("button", { name: "סיום" }).click();
  await expect(screen(page)).toBeVisible({ timeout: 20_000 });
};

const screen = (page: Page) => page.locator(".booked.live");
const band = (page: Page) => screen(page).locator(".booked-hero");
const summary = (page: Page) => screen(page).locator(".live-summary");
const steps = (page: Page) => screen(page).locator("ol");

/** The lines of one row of the summary, by its label. */
const rowLines = (page: Page, label: string) =>
  summary(page).locator(".live-row", { has: page.locator(".label", { hasText: new RegExp(`^${label}$`) }) }).locator(".live-value > *");

/** The business that was opened, read off the link the screen offers to it. */
const openedId = async (page: Page): Promise<string> => {
  const href = await band(page).getByRole("link", { name: "צפייה כלקוח" }).getAttribute("href");
  const id = /\/business\/([^/?#]+)$/.exec(href ?? "")?.[1];
  expect(id, `a business link, not ${href}`).toBeDefined();
  return id ?? "";
};

const anyEditingControl = /עריכה|עריכת|שינוי|לשנות|הסרה|הסרת|מחיקה|מחיקת|למחוק|edit|remove|delete/i;

test.describe("the business is live", () => {
  test("a first business says it worked, sums up what was made, and offers sharing first", async ({ page }) => {
    const owner = await anOwner(page);
    const name = `מספרת דנה ${Date.now()}`;
    await openABusiness(page, owner.phone, { name, services: [{ name: "תספורת", minutes: "45", price: "80" }] });

    // It worked, before anything is read.
    await expect(band(page).getByText("העסק באוויר", { exact: true })).toBeVisible();
    await expect(band(page).getByRole("heading", { level: 1 })).toHaveText(name);
    // The main category, then the address exactly as it was picked.
    await expect(band(page).locator(".live-meta")).toHaveText(/^מספרה \/ ספר · הרצל 1\b/);

    // What was made, read back from the wizard.
    await expect(rowLines(page, "שירותים")).toHaveText([/^תספורת · 45 דק׳ · .*80.*₪/]);
    await expect(rowLines(page, "יומנים")).toHaveText(["ראשי"]);
    await expect(rowLines(page, "פתוח")).toHaveText(["א׳–ה׳ 09:00–17:00"]);

    // The plan, with the Trial's end as the server set it.
    const id = await openedId(page);
    const billing = await call<{ subscription: { trialEndsOn: string } }>(`/businesses/${id}/subscription`, { token: owner.token });
    const [year, month, day] = billing.subscription.trialEndsOn.split("-").map(Number) as [number, number, number];
    const until = new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(year, month - 1, day)),
    );
    await expect(rowLines(page, "מסלול")).toHaveText(["יחיד · 30 יום ניסיון", `עד ${until}`]);

    // The next step: done, then sharing — WhatsApp says it shares.
    await expect(steps(page).locator("li")).toHaveCount(2);
    await expect(steps(page).locator("li").first()).toHaveAttribute("data-state", "done");
    await expect(steps(page).getByText("העסק נרשם ומופיע בחיפוש ובמפה")).toBeVisible();
    await expect(steps(page).getByText("עכשיו · לקוחות כבר יכולים לקבוע")).toBeVisible();
    await expect(steps(page).getByText("שלחו את הקישור ללקוחות")).toBeVisible();
    await expect(steps(page).getByRole("link", { name: "שיתוף בוואטסאפ" })).toBeVisible();
    await expect(steps(page).getByRole("button", { name: "העתקת הקישור" })).toBeVisible();
    await expect(steps(page).getByRole("button", { name: "קוד QR" })).toBeVisible();

    // In the band: sharing, and the page customers see.
    await expect(band(page).getByRole("button", { name: "שיתוף הקישור" })).toBeVisible();
    const asCustomer = band(page).getByRole("link", { name: "צפייה כלקוח" });
    await expect(asCustomer).toHaveAttribute("href", new RegExp(`^https?://[^/]+/business/${id}$`));
    await expect(asCustomer).toHaveAttribute("target", "_blank");

    // Nothing on it pays, changes or removes anything.
    await expect(screen(page).getByRole("link", { name: "לתשלום" })).toHaveCount(0);
    await expect(screen(page).getByRole("button", { name: anyEditingControl })).toHaveCount(0);
    await expect(screen(page).getByRole("link", { name: anyEditingControl })).toHaveCount(0);
    await expect(summary(page).locator("input, select, textarea")).toHaveCount(0);
    await expect(summary(page).locator(".live-photo-note")).toHaveCount(0);

    // ADR 0011: discoverable the moment it registers.
    const found = await call<{ id: string }[]>(`/businesses/search?q=${encodeURIComponent(name)}`);
    expect(found.map((business) => business.id)).toContain(id);

    // The way forward is always in reach, and leads into the business.
    const forward = screen(page).getByRole("button", { name: "ליומן שלי" });
    await expect(forward).toBeInViewport();
    await forward.click();
    await expect(page).toHaveURL(new RegExp(`/manage\\?business=${id}$`), { timeout: 15_000 });
  });

  test("the customer page it links to is the business's own", async ({ page, context }) => {
    const owner = await anOwner(page);
    const name = `עמוד ללקוח ${Date.now()}`;
    await openABusiness(page, owner.phone, { name });
    const [customerPage] = await Promise.all([
      context.waitForEvent("page"),
      band(page).getByRole("link", { name: "צפייה כלקוח" }).click(),
    ]);
    await customerPage.waitForLoadState();
    await expect(customerPage.getByRole("heading", { level: 1 })).toHaveText(name, { timeout: 20_000 });
    await customerPage.close();
    // And the owner is still on the screen they left.
    await expect(screen(page)).toBeVisible();
  });

  test("the back arrow also leads into the business, never back into the wizard", async ({ page }) => {
    const owner = await anOwner(page);
    await openABusiness(page, owner.phone, { name: `חזרה ${Date.now()}` });
    const id = await openedId(page);
    await page.getByRole("button", { name: "חזרה" }).first().click();
    await expect(page).toHaveURL(new RegExp(`/manage\\?business=${id}$`), { timeout: 15_000 });
  });

  test("a Team business with many calendars and services counts the rest, and says each run of hours", async ({ page }) => {
    const owner = await anOwner(page);
    const name = `צוות גדול ${Date.now()}`;
    await openABusiness(page, owner.phone, {
      name,
      plan: "TEAM",
      calendars: ["דנה", "רון", "מאיה", "יוסי", "נועה"],
      services: [{ name: "תספורת", price: "80" }, { name: "זקן", price: "40" }, { name: "צבע", price: "150" }],
      shortFriday: true,
    });

    await expect(rowLines(page, "שירותים")).toHaveText([/^תספורת · 30 דק׳ · .*80.*₪$/, "ועוד 2 שירותים"]);
    await expect(rowLines(page, "יומנים")).toHaveText(["דנה, רון, מאיה", "ועוד 2"]);
    await expect(rowLines(page, "פתוח")).toHaveText(["א׳–ה׳ 09:00–17:00", "ו׳ 09:00–13:00"]);
    await expect(rowLines(page, "מסלול").first()).toHaveText("צוות · 30 יום ניסיון");

    // What the summary says is what was stored.
    const id = await openedId(page);
    const profile = await call<{ services: { name: string; priceMinor: number }[]; resources: { name: string }[] }>(`/businesses/${id}`);
    expect(profile.resources.map((resource) => resource.name).sort()).toEqual(["דנה", "יוסי", "מאיה", "נועה", "רון"].sort());
    expect(profile.services.map((service) => [service.name, service.priceMinor]).sort()).toEqual(
      [["זקן", 4000], ["צבע", 15000], ["תספורת", 8000]].sort(),
    );
  });

  test("two services say one more, and a price left at nought opens as free", async ({ page }) => {
    const owner = await anOwner(page);
    await openABusiness(page, owner.phone, {
      name: `חינם ${Date.now()}`,
      services: [{ name: "שיחת היכרות" }, { name: "ייעוץ", price: "120" }],
    });
    await expect(rowLines(page, "שירותים")).toHaveText(["שיחת היכרות · 30 דק׳ · חינם", "ועוד שירות אחד"]);
    const id = await openedId(page);
    const profile = await call<{ services: { name: string; priceMinor: number }[] }>(`/businesses/${id}`);
    expect(profile.services.find((service) => service.name === "שיחת היכרות")?.priceMinor).toBe(0);
    expect(profile.services.find((service) => service.name === "ייעוץ")?.priceMinor).toBe(12_000);
  });

  test("the wizard's price starts at nought and its minutes at half an hour, both typed over cleanly", async ({ page }) => {
    const owner = await anOwner(page);
    await page.goto("/onboarding?plan=SOLO");
    await ready(page);
    await page.getByLabel("שם העסק").fill(`מחיר ${Date.now()}`);
    await page.getByLabel("טלפון").fill(asTyped(owner.phone));
    await pickAnAddress(page, "הרצל 1");
    await pickACategory(page);
    await page.getByRole("button", { name: "המשך" }).click();
    await page.getByRole("button", { name: "המשך" }).click();
    await page.locator("#resource-0").fill("ראשי");
    await page.getByRole("button", { name: "המשך" }).click();

    const price = page.locator("#service-price-0");
    const minutes = page.locator("#service-minutes-0");
    const name = page.locator("#service-name-0");
    await expect(price).toHaveValue("0");
    await expect(minutes).toHaveValue("30");

    // Tapped, the nought is selected and typing replaces it.
    await price.click();
    await price.pressSequentially("80");
    await expect(price).toHaveValue("80");
    // With the caret after a nought, still no leading nought.
    await price.fill("0");
    await price.press("End");
    await price.pressSequentially("80");
    await expect(price).toHaveValue("80");
    await price.fill("");
    await price.pressSequentially("0.5");
    await expect(price).toHaveValue("0.5");
    // Emptied and left, nought again.
    await price.fill("");
    await name.click();
    await expect(price).toHaveValue("0");

    // Minutes: never a leading nought, and anything that is not a length goes back.
    await minutes.click();
    await minutes.pressSequentially("45");
    await expect(minutes).toHaveValue("45");
    await minutes.fill("0");
    await minutes.press("End");
    await minutes.pressSequentially("50");
    await expect(minutes).toHaveValue("50");
    for (const wrong of ["0", "3", "5000"]) {
      await minutes.fill(wrong);
      await name.click();
      await expect(minutes, wrong).toHaveValue("50");
    }
    await minutes.fill("");
    await name.click();
    await expect(minutes).toHaveValue("30");

    await page.getByRole("button", { name: "הוספת שירות" }).click();
    await expect(page.locator("#service-price-1")).toHaveValue("0");
    await expect(page.locator("#service-minutes-1")).toHaveValue("30");
  });

  test("a photo that did not upload is said once, quietly, and the business is open anyway", async ({ page }) => {
    const owner = await anOwner(page);
    let refused = 0;
    await page.route(/\/businesses\/[^/]+\/photos\/0$/, async (route) => {
      refused += 1;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "INTERNAL" }) });
    });
    await openABusiness(page, owner.phone, { name: `תמונה אחת ${Date.now()}`, photos: 2 });
    expect(refused).toBe(1);
    await expect(summary(page).locator(".live-photo-note")).toHaveText("תמונה אחת לא עלתה. אפשר להוסיף אותה בהגדרות העסק.");
    await expect(summary(page).getByRole("button")).toHaveCount(0);
    await expect(band(page).getByText("העסק באוויר", { exact: true })).toBeVisible();
    const profile = await call<{ photos: { slot: number }[] }>(`/businesses/${await openedId(page)}`);
    expect(profile.photos.map((photo) => photo.slot)).toEqual([1]);
  });

  test("several photos that did not upload are counted", async ({ page }) => {
    const owner = await anOwner(page);
    await page.route(/\/businesses\/[^/]+\/photos\/\d$/, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "INTERNAL" }) }),
    );
    await openABusiness(page, owner.phone, { name: `תמונות ${Date.now()}`, photos: 3 });
    await expect(summary(page).locator(".live-photo-note")).toHaveText("3 תמונות לא עלו. אפשר להוסיף אותן בהגדרות העסק.");
  });

  test("when the Trial's end cannot be read, the plan is said without it rather than as an error", async ({ page }) => {
    const owner = await anOwner(page);
    await page.route(/\/businesses\/[^/]+\/subscription$/, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "INTERNAL" }) }),
    );
    await openABusiness(page, owner.phone, { name: `בלי תאריך ${Date.now()}` });
    await expect(rowLines(page, "מסלול")).toHaveText(["יחיד · 30 יום ניסיון"]);
    await expect(screen(page).locator(".crit")).toHaveCount(0);
  });

  test("if registering fails, the wizard stays on its last step with the error", async ({ page }) => {
    const owner = await anOwner(page);
    await page.route(/\/businesses$/, (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "INTERNAL" }) })
        : route.continue(),
    );
    await page.goto("/onboarding?plan=SOLO");
    await ready(page);
    await page.getByLabel("שם העסק").fill(`נכשל ${Date.now()}`);
    await page.getByLabel("טלפון").fill(asTyped(owner.phone));
    await pickAnAddress(page, "הרצל 1");
    await pickACategory(page);
    await page.getByRole("button", { name: "המשך" }).click();
    await page.getByRole("button", { name: "המשך" }).click();
    await page.locator("#resource-0").fill("ראשי");
    await page.getByRole("button", { name: "המשך" }).click();
    await page.locator("#service-name-0").fill("ייעוץ");
    await page.getByRole("button", { name: "המשך" }).click();
    await page.getByRole("checkbox", { name: /קראתי ואני מסכים/ }).check();
    await page.getByRole("button", { name: "סיום" }).click();

    await expect(page.getByText("מתי אתם פתוחים")).toBeVisible();
    await expect(page.getByRole("button", { name: "סיום" })).toBeEnabled({ timeout: 15_000 });
    await expect(page.locator(".crit, [role=alert]").first()).toBeVisible();
    await expect(screen(page)).toHaveCount(0);
  });
});

test.describe("with the Trial already used", () => {
  /** An owner whose first business took the Trial, back for a second. */
  const anOwnerWithATrialBehind = async (page: Page) => {
    const phone = uniquePhone();
    await aBusinessWithOpenHours({ name: `העסק הראשון ${Date.now()}`, ownerPhone: phone, plan: "SOLO" });
    return anOwner(page, phone);
  };

  /** When the nightly run is, on Israel's clock, for a date. */
  const runOn = (date: string): string => {
    const [year, month, day] = date.split("-").map(Number) as [number, number, number];
    return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
      new Date(Date.UTC(year, month - 1, day, 4)),
    );
  };

  test("before the night's run: live until today, pay first, and no sharing until then", async ({ page }) => {
    const today = aDayFromNow(0);
    await page.clock.setFixedTime(new Date(anInstantAt(today, "03:00")));
    const owner = await anOwnerWithATrialBehind(page);
    const name = `עסק שני ${Date.now()}`;
    await openABusiness(page, owner.phone, { name, plan: "TEAM" });
    const time = runOn(today);

    const badge = band(page).locator(".live-badge");
    await expect(badge).toHaveText(`באוויר עד היום ב־${time}`);
    await expect(badge).toHaveClass(/due/);

    // Paying is the only thing in the band.
    const pay = band(page).getByRole("link", { name: "לתשלום" });
    await expect(pay).toBeVisible();
    await expect(band(page).getByRole("link")).toHaveCount(1);
    await expect(band(page).getByRole("button")).toHaveCount(0);
    const href = (await pay.getAttribute("href")) ?? "";
    expect(href).toMatch(/^https:\/\/wa\.me\/\d+\?text=/);
    expect(decodeURIComponent(href.split("?text=")[1] ?? "")).toBe(`שלום, פתחתי את העסק "${name}" במסלול צוות ואני רוצה לשלם.`);
    await expect(pay).toHaveAttribute("target", "_blank");

    await expect(rowLines(page, "מסלול")).toHaveText([/^צוות · .*89.*₪ לחודש$/, "ללא תקופת ניסיון"]);

    // The one next step is the payment, with its deadline, amber.
    const due = steps(page).locator("li").nth(1);
    await expect(due).toHaveAttribute("data-state", "due");
    await expect(due.getByText("יש לשלם היום", { exact: true })).toBeVisible();
    await expect(due).toContainText(`בלי תשלום, היום ב־${time} העסק יוסר מהחיפוש ולא יקבל תורים חדשים.`);
    await expect(due.getByRole("link", { name: "לתשלום בוואטסאפ" })).toHaveAttribute("href", href);

    // No sharing anywhere until it is paid for.
    await expect(screen(page).getByText("שלחו את הקישור ללקוחות")).toHaveCount(0);
    await expect(screen(page).getByRole("link", { name: /שיתוף|צפייה כלקוח/ })).toHaveCount(0);
    await expect(screen(page).getByRole("button", { name: /שיתוף|העתקת|QR/ })).toHaveCount(0);

    // Still live meanwhile, and the way into the business is the same.
    const found = await call<{ name: string }[]>(`/businesses/search?q=${encodeURIComponent(name)}`);
    expect(found.some((business) => business.name === name)).toBe(true);
    await expect(screen(page).getByRole("button", { name: "ליומן שלי" })).toBeVisible();
  });

  test("after the night's run: live until tomorrow, said as tomorrow everywhere", async ({ page }) => {
    const today = aDayFromNow(0);
    await page.clock.setFixedTime(new Date(anInstantAt(today, "12:00")));
    const owner = await anOwnerWithATrialBehind(page);
    await openABusiness(page, owner.phone, { name: `עסק שני מחר ${Date.now()}` });
    const time = runOn(aDayFromNow(1));

    await expect(band(page).locator(".live-badge")).toHaveText(`באוויר עד מחר ב־${time}`);
    await expect(steps(page).getByText("יש לשלם מחר", { exact: true })).toBeVisible();
    await expect(steps(page).locator("li").nth(1)).toContainText(`בלי תשלום, מחר ב־${time} העסק יוסר מהחיפוש`);
    await expect(rowLines(page, "מסלול")).toHaveText([/^יחיד · .*49.*₪ לחודש$/, "ללא תקופת ניסיון"]);
  });
});

test.describe("sharing the link", () => {
  test("with no share sheet on the device, the band opens this page's own, with the message and the link", async ({ page, context }) => {
    await noShareSheetOnTheDevice(page);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const owner = await anOwner(page);
    const name = `שיתוף ${Date.now()}`;
    await openABusiness(page, owner.phone, { name });
    const id = await openedId(page);

    await band(page).getByRole("button", { name: "שיתוף הקישור" }).click();
    const sheet = page.getByRole("dialog", { name: "שיתוף העסק" });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator(".share-message")).toContainText("אפשר לקבוע אצלי תור כאן, בלי להתקשר:");
    const link = sheet.locator(".share-message a");
    await expect(link).toHaveAttribute("href", new RegExp(`/business/${id}$`));
    // The page customers see is in the sheet too, and no "עוד…" without a device share sheet.
    await expect(sheet.getByRole("link", { name: "צפייה כלקוח" })).toHaveAttribute("href", new RegExp(`/business/${id}$`));
    await expect(sheet.getByRole("button", { name: "עוד…" })).toHaveCount(0);
    const url = (await link.getAttribute("href")) ?? "";

    // WhatsApp, saying it shares, with the message and the link written and nobody chosen.
    const whatsapp = sheet.getByRole("link", { name: "שיתוף בוואטסאפ" });
    const href = (await whatsapp.getAttribute("href")) ?? "";
    expect(href.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(href.slice("https://wa.me/?text=".length))).toBe(`אפשר לקבוע אצלי תור כאן, בלי להתקשר:\n${url}`);

    // Copying says so in place, and then goes back to saying what it does.
    await sheet.getByRole("button", { name: "העתקת הקישור" }).click();
    await expect(sheet.getByRole("button", { name: "הקישור הועתק" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
    await expect(sheet.getByRole("button", { name: "העתקת הקישור" })).toBeVisible({ timeout: 5_000 });

    // Closed by its button and by Escape.
    await sheet.getByRole("button", { name: "סגירה" }).click();
    await expect(sheet).toBeHidden();
    await band(page).getByRole("button", { name: "שיתוף הקישור" }).click();
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });

  test("with a share sheet on the device, the band hands it the link and opens nothing of its own", async ({ page }) => {
    await aShareSheetOnTheDevice(page);
    const owner = await anOwner(page);
    const name = `שיתוף טלפון ${Date.now()}`;
    await openABusiness(page, owner.phone, { name });
    const id = await openedId(page);

    await band(page).getByRole("button", { name: "שיתוף הקישור" }).click();
    await expect.poll(() => sharedOnTheDevice(page)).toHaveLength(1);
    const [handed] = await sharedOnTheDevice(page);
    expect(handed).toMatchObject({ title: name, text: "אפשר לקבוע אצלי תור כאן, בלי להתקשר:", files: [] });
    expect(handed?.url).toMatch(new RegExp(`/business/${id}$`));
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // The QR step opens this page's sheet, where "עוד…" hands the link to the device too.
    await steps(page).getByRole("button", { name: "קוד QR" }).click();
    await page.getByRole("dialog", { name: "שיתוף העסק" }).getByRole("button", { name: "עוד…" }).click();
    await expect.poll(() => sharedOnTheDevice(page)).toHaveLength(2);
  });

  test("a cancelled device share sheet is not an error", async ({ page }) => {
    await aShareSheetOnTheDevice(page, { cancels: true });
    const owner = await anOwner(page);
    await openABusiness(page, owner.phone, { name: `ביטול שיתוף ${Date.now()}` });
    await band(page).getByRole("button", { name: "שיתוף הקישור" }).click();
    await expect.poll(() => sharedOnTheDevice(page)).toHaveLength(1);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".crit")).toHaveCount(0);
    await expect(band(page).getByRole("button", { name: "שיתוף הקישור" })).toBeEnabled();
  });

  test("the next step shares on WhatsApp and copies the link in place", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const owner = await anOwner(page);
    await openABusiness(page, owner.phone, { name: `צעד הבא ${Date.now()}` });
    const id = await openedId(page);

    const whatsapp = steps(page).getByRole("link", { name: "שיתוף בוואטסאפ" });
    const href = (await whatsapp.getAttribute("href")) ?? "";
    const message = decodeURIComponent(href.slice("https://wa.me/?text=".length));
    expect(href.startsWith("https://wa.me/?text=")).toBe(true);
    expect(message).toMatch(new RegExp(`^אפשר לקבוע אצלי תור כאן, בלי להתקשר:\\nhttps?://[^/]+/business/${id}$`));
    await expect(whatsapp).toHaveAttribute("target", "_blank");

    await steps(page).getByRole("button", { name: "העתקת הקישור" }).click();
    await expect(steps(page).getByRole("button", { name: "הקישור הועתק" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(new RegExp(`/business/${id}$`));
    await expect(steps(page).getByRole("button", { name: "העתקת הקישור" })).toBeVisible({ timeout: 5_000 });
  });

  test("a refused clipboard says nothing and changes nothing", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.reject(new DOMException("Denied", "NotAllowedError")) },
      });
    });
    const owner = await anOwner(page);
    await openABusiness(page, owner.phone, { name: `בלי לוח ${Date.now()}` });
    await steps(page).getByRole("button", { name: "העתקת הקישור" }).click();
    await page.waitForTimeout(300);
    await expect(steps(page).getByRole("button", { name: "העתקת הקישור" })).toBeVisible();
    await expect(page.getByText("הקישור הועתק")).toHaveCount(0);
    await expect(page.locator(".crit")).toHaveCount(0);
  });
});

test.describe("the QR card", () => {
  test("is made from the business's link, scans with the logo in it, and downloads to print", async ({ page }) => {
    await noShareSheetOnTheDevice(page);
    const owner = await anOwner(page);
    const name = `קוד ${Date.now()}`;
    await openABusiness(page, owner.phone, { name });
    const id = await openedId(page);

    await steps(page).getByRole("button", { name: "קוד QR" }).click();
    const sheet = page.getByRole("dialog", { name: "שיתוף העסק" });
    const card = sheet.getByRole("img", { name: `כרטיס QR להדפסה של ${name}` });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(sheet.locator(".share-card")).toHaveAttribute("data-language", "he");

    // A6 at print resolution, navy band on top, and a code a camera reads as the business's page.
    const read = await readTheCard(page);
    expect(read).toMatchObject({ width: 1240, height: 1748, band: [10, 36, 80], paper: [255, 255, 255] });
    expect(read?.data).toMatch(new RegExp(`^https?://[^/]+/business/${id}$`));
    expect(read?.data).toBe(await band(page).getByRole("link", { name: "צפייה כלקוח" }).getAttribute("href"));

    // Downloaded as a PNG named for the business.
    const [download] = await Promise.all([page.waitForEvent("download"), sheet.getByRole("link", { name: "הורדה להדפסה" }).click()]);
    expect(download.suggestedFilename()).toBe(`qr-${name.replace(/\s+/g, "-")}.png`);
    const bytes = await readFile((await download.path()) ?? "");
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1240, 1748]);

    // No device sheet that takes files, so no offer to share it as a picture.
    await expect(sheet.getByRole("button", { name: "שיתוף כתמונה" })).toHaveCount(0);
  });

  test("is shared as a picture where the device takes files", async ({ page }) => {
    await aShareSheetOnTheDevice(page, { files: true });
    const owner = await anOwner(page);
    const name = `תמונה לשיתוף ${Date.now()}`;
    await openABusiness(page, owner.phone, { name });

    await steps(page).getByRole("button", { name: "קוד QR" }).click();
    const sheet = page.getByRole("dialog", { name: "שיתוף העסק" });
    await sheet.getByRole("button", { name: "שיתוף כתמונה" }).click();
    await expect.poll(() => sharedOnTheDevice(page)).toHaveLength(1);
    const [handed] = await sharedOnTheDevice(page);
    expect(handed?.title).toBe(name);
    expect(handed?.files).toHaveLength(1);
    expect(handed?.files[0]).toMatchObject({ name: `qr-${name.replace(/\s+/g, "-")}.png`, type: "image/png" });
    expect(handed?.files[0]?.size).toBeGreaterThan(10_000);
  });

  test("speaks the app's language: a name in Latin letters still gets a Hebrew card in a Hebrew app", async ({ page }) => {
    const owner = await anOwner(page);
    const name = `Dana Barbershop ${Date.now()}`;
    await openABusiness(page, owner.phone, { name });
    await steps(page).getByRole("button", { name: "קוד QR" }).click();
    const sheet = page.getByRole("dialog", { name: "שיתוף העסק" });
    await expect(sheet.locator(".share-card img")).toBeVisible({ timeout: 15_000 });
    await expect(sheet.locator(".share-card")).toHaveAttribute("data-language", "he");
    const read = await readTheCard(page);
    expect(read?.data).toMatch(/\/business\/[^/]+$/);
  });

  test("a very long name still makes a card that scans", async ({ page }) => {
    const owner = await anOwner(page);
    const name = `המרכז הישראלי לטיפולי פנים וגוף מתקדמים ועיצוב גבות ${Date.now()}`;
    await openABusiness(page, owner.phone, { name });
    await steps(page).getByRole("button", { name: "קוד QR" }).click();
    await expect(page.locator(".share-card img")).toBeVisible({ timeout: 15_000 });
    const read = await readTheCard(page);
    expect(read?.data).toMatch(/\/business\/[^/]+$/);
  });
});

test.describe("in English", () => {
  test("the whole screen turns to English, and back", async ({ page }) => {
    const owner = await anOwner(page);
    const name = `Dana's ${Date.now()}`;
    await openABusiness(page, owner.phone, { name, services: [{ name: "Haircut", price: "80" }], shortFriday: true });

    await page.getByRole("button", { name: "החשבון שלי" }).click();
    await page.getByRole("group", { name: "שפה · Language" }).getByRole("button", { name: "English" }).click();
    await page.keyboard.press("Escape");

    await expect(band(page).getByText("Your business is live", { exact: true })).toBeVisible();
    await expect(band(page).getByRole("button", { name: "Share the link" })).toBeVisible();
    await expect(band(page).getByRole("link", { name: "See it as a customer" })).toBeVisible();
    await expect(rowLines(page, "Services")).toHaveText([/^Haircut · 30 min · ₪80$/]);
    await expect(rowLines(page, "Calendars")).toHaveText(["ראשי"]);
    await expect(rowLines(page, "Open")).toHaveText(["Sun–Thu 09:00–17:00", "Fri 09:00–13:00"]);
    await expect(rowLines(page, "Plan")).toHaveText(["Solo · 30-day trial", /^until \w+day/]);
    await expect(steps(page).getByText("Registered, and in search and on the map")).toBeVisible();
    await expect(steps(page).getByText("Send the link to your customers")).toBeVisible();
    await expect(steps(page).getByRole("link", { name: "Share on WhatsApp" })).toBeVisible();
    await expect(steps(page).getByRole("button", { name: "Copy the link" })).toBeVisible();
    await expect(steps(page).getByRole("button", { name: "QR code" })).toBeVisible();
    await expect(screen(page).getByRole("button", { name: "To my calendar" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");

    // The card follows the name, not the app: a Latin name, an English card.
    await steps(page).getByRole("button", { name: "QR code" }).click();
    const sheet = page.getByRole("dialog", { name: "Share the business" });
    await expect(sheet.getByRole("link", { name: "Share on WhatsApp" })).toBeVisible();
    await expect(sheet.getByRole("img", { name: `Printable QR card for ${name}` })).toBeVisible({ timeout: 15_000 });
    await expect(sheet.getByRole("link", { name: "Download to print" })).toBeVisible();
    await sheet.getByRole("button", { name: "Close" }).click();
  });

  test("owing from today, in English", async ({ page }) => {
    const today = aDayFromNow(0);
    await page.clock.setFixedTime(new Date(anInstantAt(today, "03:00")));
    const phone = uniquePhone();
    await aBusinessWithOpenHours({ name: `First ${Date.now()}`, ownerPhone: phone, plan: "SOLO" });
    const owner = await anOwner(page, phone);
    const name = `Second ${Date.now()}`;
    await openABusiness(page, owner.phone, { name });
    await page.getByRole("button", { name: "החשבון שלי" }).click();
    await page.getByRole("group", { name: "שפה · Language" }).getByRole("button", { name: "English" }).click();
    await page.keyboard.press("Escape");

    await expect(band(page).locator(".live-badge")).toHaveText(/^Live until today at \d{2}:\d{2}$/);
    await expect(band(page).getByRole("link", { name: "Pay" })).toBeVisible();
    await expect(rowLines(page, "Plan")).toHaveText([/^Solo · ₪49 a month$/, "No trial"]);
    await expect(steps(page).getByText("Payment due today", { exact: true })).toBeVisible();
    const pay = steps(page).getByRole("link", { name: "Pay on WhatsApp" });
    expect(decodeURIComponent(((await pay.getAttribute("href")) ?? "").split("?text=")[1] ?? "")).toBe(
      `Hello, I opened the business "${name}" on the Solo plan and would like to pay.`,
    );
  });
});

test.describe("drawn cleanly", () => {
  const box = async (locator: Locator) => {
    const found = await locator.boundingBox();
    expect(found).not.toBeNull();
    return found ?? { x: 0, y: 0, width: 0, height: 0 };
  };

  const noSidewaysScroll = (page: Page) =>
    page.evaluate(() =>
      [document.scrollingElement, ...Array.from(document.querySelectorAll("main"))].every(
        (element) => element === null || element.scrollWidth <= element.clientWidth + 1,
      ),
    );

  test("a long name stays inside the band, and the summary sits half on it on a phone", async ({ page }, info) => {
    const owner = await anOwner(page);
    await openABusiness(page, owner.phone, { name: `המרכז הישראלי לטיפולי פנים וגוף מתקדמים ${Date.now()}` });
    const hero = await box(band(page));
    const title = await box(band(page).getByRole("heading", { level: 1 }));
    const actions = await box(band(page).locator(".live-actions"));
    const card = await box(summary(page));

    expect(title.y + title.height).toBeLessThanOrEqual(hero.y + hero.height);
    expect(actions.y + actions.height).toBeLessThanOrEqual(hero.y + hero.height);
    expect(actions.y).toBeGreaterThanOrEqual(title.y + title.height - 1);
    if (info.project.name === "mobile") {
      // The card overlaps the band, and starts below the band's last control.
      expect(card.y).toBeLessThan(hero.y + hero.height);
      expect(card.y).toBeGreaterThan(actions.y + actions.height);
    } else {
      // On a desktop the band is a panel of its own, the summary and the steps side by side under it.
      expect(card.y).toBeGreaterThanOrEqual(hero.y + hero.height);
      const side = await box(screen(page).locator(".booked-side"));
      expect(Math.abs(side.y - card.y)).toBeLessThan(2);
      expect(side.x === card.x).toBe(false);
    }
    expect(await noSidewaysScroll(page)).toBe(true);
  });

  test("fits a 320px phone with nothing cut or scrolling sideways", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "a phone width");
    await page.setViewportSize({ width: 320, height: 640 });
    const owner = await anOwner(page);
    await openABusiness(page, owner.phone, {
      name: `צר ${Date.now()}`,
      plan: "TEAM",
      calendars: ["דנה", "רון", "מאיה", "יוסי"],
      services: [{ name: "תספורת גברים קלאסית עם שטיפה", price: "1250.5" }, { name: "זקן" }],
      shortFriday: true,
    });
    expect(await noSidewaysScroll(page)).toBe(true);
    for (const action of await steps(page).locator(".booked-action").all()) {
      const found = await box(action);
      expect(found.x).toBeGreaterThanOrEqual(0);
      expect(found.x + found.width).toBeLessThanOrEqual(320);
    }
    await expect(screen(page).getByRole("button", { name: "ליומן שלי" })).toBeInViewport();

    await steps(page).getByRole("button", { name: "קוד QR" }).click();
    const sheet = page.getByRole("dialog", { name: "שיתוף העסק" });
    await expect(sheet.locator(".share-card img")).toBeVisible({ timeout: 15_000 });
    const image = await box(sheet.locator(".share-card img"));
    expect(image.x).toBeGreaterThanOrEqual(0);
    expect(image.x + image.width).toBeLessThanOrEqual(320);
    expect(await noSidewaysScroll(page)).toBe(true);
  });

  test("the summary's rows line up, label beside value", async ({ page }) => {
    const owner = await anOwner(page);
    await openABusiness(page, owner.phone, { name: `שורות ${Date.now()}`, shortFriday: true });
    const labels = await summary(page).locator(".live-row > .label").all();
    const starts = await Promise.all(labels.map(async (label) => (await box(label)).x));
    expect(new Set(starts.map((x) => Math.round(x))).size).toBe(1);
    const values = await summary(page).locator(".live-row > .live-value").all();
    const valueStarts = await Promise.all(values.map(async (value) => Math.round((await box(value)).x)));
    expect(new Set(valueStarts).size).toBe(1);
  });
});
