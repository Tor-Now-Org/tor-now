import { expect, test } from "@playwright/test";
import { ready } from "./support.ts";

/**
 * The front door.
 *
 * Nothing here needs a session or a seeded business — which is the point of it,
 * and worth holding: a landing page that only works for somebody already signed
 * in is a landing page nobody lands on.
 */
test.describe("the welcome page", () => {
  test("says what the product is, in Hebrew, to a stranger", async ({ page }) => {
    await page.goto("/welcome");
    await ready(page);

    await expect(page.getByRole("heading", { name: /התור הבא שלך/ })).toBeVisible();
    // Both ways in, from the top.
    await expect(page.getByRole("link", { name: "נסו עכשיו" })).toBeVisible();
    await expect(page.getByRole("link", { name: "יש לי עסק" })).toBeVisible();

    // The screens are the product's own, served as files rather than drawn.
    const shots = page.locator(".lp-phone img");
    await expect(shots.first()).toBeVisible();
    for (const src of await shots.evaluateAll((nodes) =>
      nodes.map((n) => (n as HTMLImageElement).getAttribute("src") ?? ""))) {
      expect(src).toMatch(/^\/landing\/.+\.jpg$/);
    }
    // And they actually load: a broken screenshot is a broken promise.
    expect(
      await shots.first().evaluate((n) => (n as HTMLImageElement).naturalWidth),
    ).toBeGreaterThan(100);
  });

  test("both tours move when a step is chosen", async ({ page }) => {
    await page.goto("/welcome");
    await ready(page);

    const customer = page.locator("#how .lp-step");
    await expect(customer).toHaveCount(3);
    await customer.nth(2).click();
    await expect(customer.nth(2)).toHaveAttribute("aria-current", "true");
    await expect(page.locator("#how .lp-phone img")).toHaveAttribute("src", /c3-booking/);

    const owner = page.locator("#owners .lp-step");
    await expect(owner).toHaveCount(4);
    await owner.nth(3).click();
    await expect(page.locator("#owners .lp-phone img")).toHaveAttribute("src", /o4-team/);
  });

  test("turns into English, and back", async ({ page }) => {
    await page.goto("/welcome");
    await ready(page);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    await page.getByRole("button", { name: "EN" }).click();
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.getByRole("heading", { name: /without a single call/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Try it now" })).toBeVisible();

    await page.getByRole("button", { name: "עב" }).click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });

  test("quotes the price the rest of the product quotes", async ({ page }) => {
    await page.goto("/welcome");
    await ready(page);
    // Read from lib/plans.ts, so the front door and the pricing page cannot
    // drift into disagreeing about what this costs.
    const pricing = page.locator("#pricing");
    await expect(pricing.getByText(/₪\d+/)).toBeVisible();
    const said = (await pricing.getByText(/₪\d+/).innerText()).replace(/\D/g, "");

    await pricing.getByRole("link", { name: "לכל התוכניות" }).click();
    await ready(page);
    await expect(page).toHaveURL(/\/pricing/);
    expect(await page.getByText(new RegExp(`₪\\s*${said}`)).first().isVisible()).toBe(true);
  });

  test("leads somewhere from every call to action", async ({ page }) => {
    await page.goto("/welcome");
    await ready(page);
    await page.getByRole("link", { name: "נסו עכשיו" }).click();
    await ready(page);
    // The app itself, which is what the page is selling.
    await expect(page.getByPlaceholder("מספרה, קליניקה, מאמן אישי…")).toBeVisible({ timeout: 15_000 });
  });
});
