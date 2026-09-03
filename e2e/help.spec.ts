import { expect, test } from "@playwright/test";

/**
 * Support.
 *
 * The one screen in the system that must work for somebody who cannot sign in,
 * so the first thing tested is that it opens with no session at all. The rest
 * is the promise the screen makes: an answer without writing to anybody, and a
 * message that arrives somewhere the person can see it afterwards.
 */
test.describe("support", () => {
  test("opens without a session and answers before it asks", async ({ page }) => {
    await page.goto("/support");

    await expect(page.getByRole("heading", { name: "תמיכה" })).toBeVisible();

    // Answers are closed until asked for: four questions fit on the screen,
    // four answers do not.
    const question = page.getByRole("button", { name: "איך מבטלים תור?" });
    await expect(question).toHaveAttribute("aria-expanded", "false");
    await question.click();
    await expect(question).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("נכנסים לתור ולוחצים ביטול", { exact: false })).toBeVisible();
  });

  test("offers WhatsApp and email, each ready to open", async ({ page }) => {
    await page.goto("/support");

    // Both are real destinations, not text to copy out by hand.
    const whatsapp = page.getByRole("link", { name: /וואטסאפ/ });
    await expect(whatsapp).toHaveAttribute("href", /^https:\/\/wa\.me\/\d+$/);

    const email = page.getByRole("link", { name: /אימייל/ });
    await expect(email).toHaveAttribute("href", /^mailto:.+@.+/);
  });

  test("asks nobody to fill in a form", async ({ page }) => {
    // Support is two ways of reaching a person. A message box here would
    // promise a reply from somewhere nothing reads.
    await page.goto("/support");

    await expect(page.locator("textarea")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /שליחה|לשלוח/ })).toHaveCount(0);
  });

  test("rides in the header of the screen somebody is stuck on", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: "תמיכה" }).click();
    await expect(page.getByRole("heading", { name: "תמיכה" })).toBeVisible();

    // And not on support itself: a control that goes where you already are.
    await expect(page.getByRole("link", { name: "תמיכה" })).toHaveCount(0);
  });

  test("is reachable from the screen somebody cannot get past", async ({ page }) => {
    // Somebody who never receives a code is stuck here with no session, so the
    // header mark is the only way to a person — and the way back must return
    // them to the sign-in they abandoned, not to the front door.
    await page.goto("/signin");

    await page.getByRole("link", { name: "תמיכה" }).click();
    await expect(page.getByRole("heading", { name: "תמיכה" })).toBeVisible();

    await expect(page.getByRole("button", { name: "חזרה" })).toBeVisible();
    await page.getByRole("button", { name: "חזרה" }).click();
    await expect(page).toHaveURL(/\/signin$/);
  });

  test("credits the people who built it", async ({ page }) => {
    await page.goto("/support");

    await expect(page.getByText("נבנה באהבה ❤️ על ידי צוות תור פנוי")).toBeVisible();
    await expect(page.getByText("כל הזכויות שמורות", { exact: false })).toBeVisible();
  });
});
