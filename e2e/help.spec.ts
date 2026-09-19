import { expect, test } from "@playwright/test";
import { ready, signInDirectly, uniquePhone } from "./support.ts";

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

  test("splits the answers by who is asking", async ({ page }) => {
    // Signed out, nobody is known to own a business, so the customer's side
    // opens first; the owner's questions are one tab away.
    await page.goto("/support");

    const business = page.getByRole("tab", { name: "יש לי עסק" });
    await expect(page.getByRole("tab", { name: "אני לקוח/ה" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "לקוח לא הגיע לתור" })).toHaveCount(0);

    await business.click();
    await expect(business).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "לקוח לא הגיע לתור" })).toBeVisible();
    await expect(page.getByRole("button", { name: "איך מבטלים תור?" })).toHaveCount(0);
  });

  test("scrolls to every question on a short screen rather than clipping them", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 480 });
    await page.goto("/support");
    await page.getByRole("tab", { name: "יש לי עסק" }).click();

    // The list keeps its full height and the page scrolls. A card squeezed by
    // the column clips its own content, which no viewport check sees.
    const clipped = await page
      .getByRole("tabpanel")
      .evaluate((card) => card.scrollHeight - card.clientHeight);
    expect(clipped).toBeLessThanOrEqual(1);
  });

  test("offers WhatsApp and email, each ready to open", async ({ page }) => {
    await page.goto("/support");

    // Both are real destinations, not text to copy out by hand.
    const whatsapp = page.getByRole("link", { name: /וואטסאפ/ });
    await expect(whatsapp).toHaveAttribute("href", /^https:\/\/wa\.me\/\d+$/);

    // The address is its own label: somebody can read it off the screen too.
    const email = page.getByRole("link", { name: /@/ });
    await expect(email).toHaveAttribute("href", /^mailto:.+@.+/);
  });

  test("asks nobody to fill in a form", async ({ page }) => {
    // Support is two ways of reaching a person. A message box here would
    // promise a reply from somewhere nothing reads.
    await page.goto("/support");

    await expect(page.locator("textarea")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /שליחה|לשלוח/ })).toHaveCount(0);
  });

  test("is one of the places the account drawer offers", async ({ page }) => {
    await signInDirectly(page, uniquePhone(), "יעל אבידן");
    await page.goto("/");
    await ready(page);

    await page.getByRole("button", { name: "החשבון שלי" }).click();
    await page.getByRole("link", { name: "תמיכה" }).click();
    await expect(page.getByRole("heading", { name: "תמיכה" })).toBeVisible();

    // And not on support itself: a control that goes where you already are.
    await expect(page.getByRole("link", { name: "תמיכה" })).toHaveCount(0);
  });

  test("is reachable from the screen somebody cannot get past", async ({ page }) => {
    // Somebody who never receives a code is stuck here with no session, so the
    // drawer's row is out of reach — the link on this screen is the only way
    // to a person, and the way back must return them to the sign-in they
    // abandoned, not to the front door.
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
