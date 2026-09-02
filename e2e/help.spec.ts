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

  test("carries the chosen topic and the message into WhatsApp", async ({ page }) => {
    await page.goto("/support");

    await page.getByRole("button", { name: "יש לי עסק", exact: true }).click();
    await page.getByLabel("מה קרה?").fill("צריך לשנות שעות פתיחה");

    const send = page.getByRole("link", { name: /וואטסאפ עם ההודעה/ });
    const href = await send.getAttribute("href");
    expect(href).toContain("wa.me");
    expect(decodeURIComponent(href ?? "")).toContain("יש לי עסק: צריך לשנות שעות פתיחה");
  });

  test("will not hand over an empty message", async ({ page }) => {
    await page.goto("/support");

    // No message, no destination: an empty hand-off would open WhatsApp on a
    // blank conversation, which is worse than not opening it.
    const send = page.getByText("פתיחת וואטסאפ עם ההודעה");
    await expect(send).toHaveAttribute("aria-disabled", "true");
    expect(await send.getAttribute("href")).toBeNull();
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
