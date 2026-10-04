import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  aBusinessWithOpenHours,
  asTyped,
  call,
  pickACategory,
  pickAnAddress,
  ready,
  signInDirectly,
  stubAddressSearch,
  uniquePhone,
  useEnglish,
} from "./support.ts";

/**
 * ADR 0024: up to three Categories per Business, the first the main one — what
 * a card, a map pin and "visited" call it by. Search finds it under any of them.
 */

type Wire = { business: { category: string | null; categories: string[] } };

const chooser = (page: Page) => page.getByRole("combobox", { name: "סוג העסק" });
const chips = (page: Page) => page.getByRole("list", { name: /סוג העסק/ }).getByRole("listitem");
const note = (page: Page) => page.getByRole("status").filter({ hasText: "תחומים שונים" });

const expectChips = async (page: Page, labels: readonly string[]) => {
  await expect(chips(page)).toHaveCount(labels.length);
  for (const [index, label] of labels.entries()) {
    await expect(chips(page).nth(index)).toContainText(label);
  }
  // The first, and only the first, is marked the main one.
  if (labels.length > 0) {
    await expect(chips(page).first().getByRole("button", { name: /· ראשי$/ })).toHaveAttribute("aria-pressed", "true");
    await expect(chips(page).getByText("ראשי", { exact: true })).toHaveCount(1);
  }
};

const openTheWizard = async (page: Page) => {
  const phone = uniquePhone();
  await stubAddressSearch(page);
  await signInDirectly(page, phone, "בעלים חדש");
  await page.goto("/onboarding?plan=TEAM");
  await ready(page);
  await expect(page.getByText("פרטי העסק")).toBeVisible();
  return phone;
};

test.describe("choosing a business's categories in the wizard", () => {
  test("one to three, the first main, the note for separate fields, and no hints", async ({ page }) => {
    const phone = await openTheWizard(page);
    const name = `קליניקה ${Date.now()}`;
    await page.getByLabel("שם העסק").fill(name);
    await page.getByLabel("טלפון").fill(asTyped(phone));
    await pickAnAddress(page, "הרצל 1");

    // The field is its label and nothing else: no hint to read.
    await expect(chooser(page)).toHaveAccessibleName("סוג העסק · עד 3");
    await expect(page.getByText("כך לקוחות ימצאו אתכם")).toHaveCount(0);
    await expect(chooser(page)).toHaveAttribute("placeholder", "למשל: מספרה, קוסמטיקה, מאמן כושר");
    // Nothing chosen, nothing to continue with.
    await expect(page.getByRole("button", { name: "המשך" })).toBeDisabled();

    await pickACategory(page, "פיזיו", /^פיזיותרפיה וכירופרקטיקה/);
    await expectChips(page, ["פיזיותרפיה וכירופרקטיקה"]);
    await expect(page.getByRole("button", { name: "המשך" })).toBeEnabled();
    // The next one is another, so the box says so, and what is chosen is not offered again.
    await expect(chooser(page)).toHaveAttribute("placeholder", "הוספת סוג נוסף…");
    await chooser(page).fill("פיזיו");
    await expect(page.getByRole("option", { name: /^פיזיותרפיה וכירופרקטיקה/ })).toHaveCount(0);

    // A sibling under the same parent group earns no note.
    await pickACategory(page, "סינית", /^רפואה משלימה/);
    await expectChips(page, ["פיזיותרפיה וכירופרקטיקה", "רפואה משלימה"]);
    await expect(note(page)).toHaveCount(0);

    // A third from another field: the note, in one line, and the box is gone.
    await pickACategory(page, "קעקוע", /^קעקועים ופירסינג/);
    await expectChips(page, ["פיזיותרפיה וכירופרקטיקה", "רפואה משלימה", "קעקועים ופירסינג"]);
    await expect(note(page)).toHaveText("⚠ שני תחומים שונים: בריאות וטיפול · יופי");
    await expect(chooser(page)).toHaveCount(0);

    // Removing the chip that made the second field clears the note and brings the box back.
    await page.getByRole("button", { name: "הסרת קעקועים ופירסינג" }).click();
    await expect(note(page)).toHaveCount(0);
    await expect(chooser(page)).toBeVisible();

    // One tap makes another the main one; the rest keep their order.
    await chips(page).nth(1).getByRole("button", { name: "רפואה משלימה כסוג הראשי" }).click();
    await expectChips(page, ["רפואה משלימה", "פיזיותרפיה וכירופרקטיקה"]);

    // Removing the main one makes the next one main.
    await page.getByRole("button", { name: "הסרת רפואה משלימה" }).click();
    await expectChips(page, ["פיזיותרפיה וכירופרקטיקה"]);

    // Removing the last leaves nothing to continue with.
    await page.getByRole("button", { name: "הסרת פיזיותרפיה וכירופרקטיקה" }).click();
    await expect(chips(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "המשך" })).toBeDisabled();
  });

  test("names three fields when there are three, and never stops the business opening", async ({ page }) => {
    const phone = await openTheWizard(page);
    const name = `שלושה תחומים ${Date.now()}`;
    await page.getByLabel("שם העסק").fill(name);
    await page.getByLabel("טלפון").fill(asTyped(phone));
    await pickAnAddress(page, "הרצל 1");

    await pickACategory(page, "פיזיו", /^פיזיותרפיה וכירופרקטיקה/);
    await pickACategory(page, "קעקוע", /^קעקועים ופירסינג/);
    // From the keyboard too: typing lights the first match, the arrows move, Enter takes it.
    await chooser(page).fill("מוסך");
    await chooser(page).press("ArrowDown");
    await chooser(page).press("ArrowUp");
    await chooser(page).press("Enter");
    await expectChips(page, ["פיזיותרפיה וכירופרקטיקה", "קעקועים ופירסינג", "מוסך וצמיגים"]);
    await expect(note(page)).toHaveText("⚠ שלושה תחומים שונים: בריאות וטיפול · יופי · בית, רכב ותיקונים");

    // The note is a word, not a stop: the wizard carries on and the business opens.
    await page.getByRole("button", { name: "המשך" }).click();
    await page.getByRole("button", { name: "המשך" }).click();
    await page.getByLabel("שם היומן").fill("ראשי");
    await page.getByRole("button", { name: "המשך" }).click();
    await page.getByLabel("שם השירות").fill("ייעוץ");
    await page.getByRole("button", { name: "המשך" }).click();
    await page.getByRole("checkbox", { name: /קראתי ואני מסכים/ }).check();
    await page.getByRole("button", { name: "סיום" }).click();
    await expect(page.getByText("באוויר")).toBeVisible({ timeout: 20_000 });

    const found = await call<{ id: string; name: string; category: string; categories: string[] }[]>(
      `/businesses/search?q=${encodeURIComponent(name)}`,
    );
    expect(found.find((business) => business.name === name)).toMatchObject({
      category: "physiotherapy",
      categories: ["physiotherapy", "tattoo_piercing", "car_mechanic"],
    });
  });
});

test.describe("changing a business's categories in settings", () => {
  const openSettings = async (page: Page, token: string) => {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", token],
    );
    await page.goto("/manage");
    await ready(page);
    await page.getByRole("button", { name: "העסק" }).click();
    await page.getByRole("button", { name: "הגדרות העסק" }).click();
  };

  const save = async (page: Page) => {
    const written = page.waitForResponse(
      (response) => /\/businesses\/[^/]+$/.test(response.url()) && response.request().method() === "PATCH",
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: "שמירה" }).click();
    return (await written).request().postDataJSON() as Record<string, unknown>;
  };

  test("adds, makes another main and removes, and the order is what is saved", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({ name: `הגדרות סוגים ${Date.now()}`, ownerPhone: uniquePhone() });
    await openSettings(page, shop.owner.token);

    await expectChips(page, ["מספרה / ספר"]);
    await pickACategory(page, "כלות", /^מספרת נשים וכלות/);
    await pickACategory(page, "פאות", /^עיצוב פאות/);
    // Three, all hair: full, and no note.
    await expect(chooser(page)).toHaveCount(0);
    await expect(note(page)).toHaveCount(0);
    await chips(page).nth(1).getByRole("button", { name: "מספרת נשים וכלות כסוג הראשי" }).click();
    await expectChips(page, ["מספרת נשים וכלות", "מספרה / ספר", "עיצוב פאות"]);

    expect((await save(page)).categories).toEqual(["hair_salon", "barbershop", "wig_styling"]);
    await expect(page.getByText("ההגדרות נשמרו")).toBeVisible({ timeout: 15_000 });
    expect((await call<Wire>(`/businesses/${shop.business.id}`)).business).toMatchObject({
      category: "hair_salon",
      categories: ["hair_salon", "barbershop", "wig_styling"],
    });

    // Back after a reload, in the same order.
    await page.reload();
    await ready(page);
    await page.getByRole("button", { name: "העסק" }).click();
    await page.getByRole("button", { name: "הגדרות העסק" }).click();
    await expectChips(page, ["מספרת נשים וכלות", "מספרה / ספר", "עיצוב פאות"]);

    await page.getByRole("button", { name: "הסרת מספרה / ספר" }).click();
    expect((await save(page)).categories).toEqual(["hair_salon", "wig_styling"]);
    await expect.poll(async () => (await call<Wire>(`/businesses/${shop.business.id}`)).business.categories)
      .toEqual(["hair_salon", "wig_styling"]);
  });

  test("never clears them: with none chosen it says what that costs and sends none", async ({ page }) => {
    const shop = await aBusinessWithOpenHours({
      name: `בלי סוגים ${Date.now()}`,
      ownerPhone: uniquePhone(),
      categories: ["spa", "massage"],
    });
    await openSettings(page, shop.owner.token);

    await page.getByRole("button", { name: "הסרת ספא" }).click();
    await page.getByRole("button", { name: "הסרת עיסוי ורפלקסולוגיה" }).click();
    await expect(page.getByText("עדיין לא נבחרה קטגוריה")).toBeVisible();

    const sent = await save(page);
    expect(sent).not.toHaveProperty("categories");
    expect(sent).not.toHaveProperty("category");
    await expect(page.getByText("ההגדרות נשמרו")).toBeVisible({ timeout: 15_000 });
    expect((await call<Wire>(`/businesses/${shop.business.id}`)).business.categories).toEqual(["spa", "massage"]);
  });

  test("speaks English, with the note in English", async ({ page }) => {
    await useEnglish(page);
    const shop = await aBusinessWithOpenHours({
      name: `English categories ${Date.now()}`,
      ownerPhone: uniquePhone(),
      categories: ["physiotherapy"],
    });
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["tor-now.session", shop.owner.token],
    );
    await page.goto("/manage");
    await ready(page);
    await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Business" }).click();
    await page.getByRole("button", { name: "Business settings" }).click();

    await expect(page.getByText("Category · up to 3")).toBeVisible();
    const box = page.getByRole("combobox", { name: "Category" });
    await expect(box).toHaveAttribute("placeholder", "Add another category…");
    await box.fill("tattoo");
    await page.getByRole("option", { name: /^Tattoo & piercing/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "different fields" }))
      .toHaveText("⚠ Two different fields: Health & therapy · Beauty");
    await expect(page.getByRole("button", { name: "Make Tattoo & piercing the main one" })).toBeVisible();
  });
});

test.describe("finding a business by any of its categories", () => {
  const card = (page: Page, name: string): Locator =>
    page.getByRole("button").filter({ has: page.getByText(name, { exact: true }) }).first();

  test("found under a second category, the card says what it mainly is and how many more", async ({ page }) => {
    const name = `סטודיו נועה ${Date.now()}`;
    const shop = await aBusinessWithOpenHours({
      name,
      ownerPhone: uniquePhone(),
      categories: ["hair_salon", "nail_salon", "makeup_artist"],
    });

    await page.goto("/");
    await ready(page);
    const search = page.getByRole("combobox", { name: "מספרה, קליניקה, מאמן אישי…" });
    await search.fill("מניקור");
    await page.getByRole("option", { name: /^ציפורניים: מניקור, פדיקור וג׳ל/ }).click();
    await search.fill(name);

    const found = card(page, name);
    await expect(found).toBeVisible({ timeout: 15_000 });
    await expect(found.getByText("מספרת נשים וכלות")).toBeVisible();
    await expect(found.getByText("+2")).toBeVisible();
    // Read aloud as the names, not as "plus two".
    await expect(found.getByText("ועוד: ציפורניים: מניקור, פדיקור וג׳ל, מאפרת")).toBeAttached();

    // The business page lists them all, the main one first.
    await found.click();
    await expect(page).toHaveURL(new RegExp(`/business/${shop.business.id}$`));
    const listed = page.getByRole("list", { name: "סוגי העסק" }).getByRole("listitem");
    await expect(listed).toHaveText(["מספרת נשים וכלות", "ציפורניים: מניקור, פדיקור וג׳ל", "מאפרת"]);
  });

  test("browsing its main category says nothing twice, and a one-category card has no +N", async ({ page }) => {
    const name = `מספרה אחת ${Date.now()}`;
    await aBusinessWithOpenHours({ name, ownerPhone: uniquePhone(), categories: ["hair_salon", "nail_salon"] });
    const single = `ספר יחיד ${Date.now()}`;
    await aBusinessWithOpenHours({ name: single, ownerPhone: uniquePhone(), categories: ["barbershop"] });

    await page.goto("/");
    await ready(page);
    const search = page.getByRole("combobox", { name: "מספרה, קליניקה, מאמן אישי…" });
    await search.fill("כלות");
    await page.getByRole("option", { name: /^מספרת נשים וכלות/ }).click();
    await search.fill(name);
    const found = card(page, name);
    await expect(found).toBeVisible({ timeout: 15_000 });
    // The box already says the Category; the card does not repeat it.
    await expect(found.getByText("מספרת נשים וכלות")).toHaveCount(0);

    // Out of the Category, a card with one says it with no +N.
    await page.getByRole("button", { name: /מספרת נשים וכלות · / }).click();
    await search.fill(single);
    const lone = card(page, single);
    await expect(lone).toBeVisible({ timeout: 15_000 });
    await expect(lone.getByText("מספרה / ספר")).toBeVisible();
    await expect(lone.getByText(/^\+\d/)).toHaveCount(0);
  });

  test("the map's card names the main one and how many more", async ({ page, context }) => {
    const name = `מפה סוגים ${Date.now()}`;
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 32.08, longitude: 34.78 });
    await aBusinessWithOpenHours({ name, ownerPhone: uniquePhone(), categories: ["massage", "spa"] });

    await page.goto("/");
    await ready(page);
    await page.getByPlaceholder("מספרה, קליניקה, מאמן אישי…").fill(name);
    const pill = page.getByRole("button", { name: /^מפה/ });
    await expect(pill).toBeVisible({ timeout: 15_000 });
    await pill.click();
    const map = page.getByRole("dialog", { name: "מפה" });
    await map.getByTitle(name).dispatchEvent("click");
    const tag = map.locator(".cat-tag");
    await expect(tag).toBeVisible();
    await expect(tag).toContainText("עיסוי ורפלקסולוגיה");
    await expect(tag.getByText("+1")).toBeVisible();
  });

  test("a client from before sends one category, and it is the business's only one", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const owner = await signInDirectly(page, ownerPhone, "בעלים ישן");
    const name = `לקוח ישן ${Date.now()}`;
    const made = await call<{ id: string; categories: string[] }>("/businesses", {
      method: "POST",
      token: owner.token,
      body: {
        name,
        phone: ownerPhone,
        description: null,
        address: "רחוב הבדיקה 1",
        latitude: 32.0853,
        longitude: 34.7818,
        // A code that has since joined a sibling, the way an old screen would send it.
        category: "gel_nails",
        plan: "SOLO",
        resourceNames: ["יומן"],
        services: [{ name: "לק", durationMinutes: 30, priceMinor: 8000, bufferMinutes: null }],
        workingHours: [{ dayOfWeek: 0, start: "09:00", end: "17:00" }],
      },
    });
    expect(made.categories).toEqual(["nail_salon"]);

    await page.goto(`/business/${made.id}`);
    await ready(page);
    await expect(page.getByRole("list", { name: "סוגי העסק" }).getByRole("listitem"))
      .toHaveText(["ציפורניים: מניקור, פדיקור וג׳ל"]);
  });
});
