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
  test("says what the product is, in Hebrew, to a business owner", async ({ page }) => {
    await page.goto("/welcome");
    await ready(page);

    await expect(page.getByRole("heading", { name: /יותר לקוחות/ })).toBeVisible();
    // The owner's two ways in, and the one line for somebody who came to book.
    const hero = page.locator(".lp-hero");
    await expect(hero.getByRole("link", { name: "התחילו לקבל תורים" })).toBeVisible();
    await expect(hero.getByRole("link", { name: "איך זה עובד" })).toBeVisible();
    await expect(hero.getByRole("link", { name: "חפשו עסק" })).toBeVisible();

    // The screens are the product's own, served as files rather than drawn —
    // pictures where a picture will do, and short films of the rest.
    const shots = page.locator(".lp-phone img, .lp-phone video");
    await expect(shots.first()).toBeVisible();
    for (const src of await shots.evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("src") ?? ""))) {
      expect(src).toMatch(/^\/landing\/.+\.(jpg|mp4)$/);
    }
    // And they actually load: a broken screenshot is a broken promise.
    const still = page.locator(".lp-phone img").first();
    expect(
      await still.evaluate((n) => (n as HTMLImageElement).naturalWidth),
    ).toBeGreaterThan(100);
  });

  /**
   * Every caption, its own picture.
   *
   * The first cut of this page shipped with two steps pointing at the same
   * file: the capture that was meant to produce the second had a click that
   * quietly missed, so "choose a service" and "pick an hour" were one
   * screenshot shown twice. The capture suite now proves the files differ;
   * this proves the page still points at all of them.
   */
  test("shows a different screen for every step it describes", async ({ page }) => {
    await page.goto("/welcome");
    await ready(page);

    const shown: string[] = [];
    for (const tour of ["#how", "#owners"]) {
      const steps = page.locator(`${tour} .lp-step`);
      const count = await steps.count();
      expect(count, `${tour} has no steps`).toBeGreaterThan(0);
      for (let at = 0; at < count; at += 1) {
        await steps.nth(at).click();
        // Each step names its own picture, so read it back after choosing.
        shown.push(
          (await page
            .locator(`${tour} .lp-phone img, ${tour} .lp-phone video`)
            .getAttribute("src")) ?? "",
        );
      }
    }

    expect(shown).toHaveLength(9);
    expect(new Set(shown).size, `two steps share a screen: ${shown.join(", ")}`)
      .toBe(shown.length);
  });

  test("both tours move when a step is chosen", async ({ page }) => {
    await page.goto("/welcome");
    await ready(page);

    const customer = page.locator("#how .lp-step");
    await expect(customer).toHaveCount(4);
    await customer.nth(3).click();
    await expect(customer.nth(3)).toHaveAttribute("aria-current", "true");
    await expect(page.locator("#how .lp-phone img")).toHaveAttribute("src", /c5-mine/);

    const owner = page.locator("#owners .lp-step");
    await expect(owner).toHaveCount(5);
    await owner.nth(3).click();
    await expect(page.locator("#owners .lp-phone img")).toHaveAttribute("src", /o5-panel/);
    // The month in numbers, last: the statistics page, photographed.
    await owner.nth(4).click();
    await expect(owner.nth(4)).toContainText("החודש במספרים");
    await expect(page.locator("#owners .lp-phone img")).toHaveAttribute("src", /o6-stats/);
  });

  test("turns into English, and back", async ({ page }) => {
    await page.goto("/welcome");
    await ready(page);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    await page.getByRole("button", { name: "EN" }).click();
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.getByRole("heading", { name: /fewer phone calls/ })).toBeVisible();
    await expect(page.locator(".lp-hero").getByRole("link", { name: "Open your calendar" })).toBeVisible();

    await page.getByRole("button", { name: "עב" }).click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });

  /**
   * The screens turn with the page.
   *
   * A page that says "Open your calendar" above a column of Hebrew screenshots is a
   * page admitting its English is a veneer over a product that only works in
   * one language. Both sets are recorded by the capture suite; what this holds
   * is that the page actually reaches for the right one, and that the files are
   * there to reach for.
   */
  test("shows English screens once it is speaking English", async ({ page }) => {
    await page.goto("/welcome");
    await ready(page);

    const shown = async () =>
      page.locator(".lp-phone img, .lp-phone video").evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("src") ?? ""),
      );
    for (const src of await shown()) expect(src).toMatch(/^\/landing\/he\//);

    await page.getByRole("button", { name: "EN" }).click();
    await expect(page.locator(".lp-hero").getByRole("link", { name: "Open your calendar" })).toBeVisible();
    const english = await shown();
    expect(english.length).toBeGreaterThan(0);
    for (const src of english) expect(src).toMatch(/^\/landing\/en\//);

    // And they are files rather than a hopeful path: a screen that 404s leaves
    // the phone on the page empty, which the language toggle would not reveal.
    for (const src of english) {
      const answer = await page.request.get(src);
      expect(answer.status(), `${src} is not there`).toBe(200);
    }
  });

  test("quotes the price the rest of the product quotes", async ({ page }) => {
    await page.goto("/welcome");
    await ready(page);
    // Both read the Catalogue, so the front door and the pricing page cannot
    // drift into disagreeing about what this costs.
    const pricing = page.locator("#pricing");
    await expect(pricing.getByText(/₪\d+/)).toBeVisible();
    const said = (await pricing.getByText(/₪\d+/).innerText()).replace(/\D/g, "");

    await pricing.getByRole("link", { name: "לכל המסלולים" }).click();
    await ready(page);
    await expect(page).toHaveURL(/\/pricing/);
    expect(await page.getByText(new RegExp(`₪\\s*${said}`)).first().isVisible()).toBe(true);
  });

  test("leads somewhere from every call to action", async ({ page }) => {
    await page.goto("/welcome");
    await ready(page);

    // Every button on the page, not only the first: a section on the page it
    // names, or a screen that answers.
    const targets = await page.locator("a.lp-btn").evaluateAll((links) =>
      links.map((link) => link.getAttribute("href") ?? ""),
    );
    expect(targets.length).toBeGreaterThan(5);
    for (const href of new Set(targets)) {
      if (href.startsWith("#")) {
        await expect(page.locator(href), `${href} names no section`).toHaveCount(1);
      } else {
        expect((await page.request.get(href)).status(), `${href} does not answer`).toBe(200);
      }
    }

    await page.locator(".lp-hero").getByRole("link", { name: "חפשו עסק" }).click();
    await ready(page);
    // The app itself, for somebody who came to book rather than to sell.
    await expect(page.getByPlaceholder("מספרה, קליניקה, מאמן אישי…")).toBeVisible({ timeout: 15_000 });
  });
});
