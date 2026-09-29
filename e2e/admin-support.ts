import { expect, type Page } from "@playwright/test";
import { call } from "./support.ts";

/**
 * Finding one's way around the administrator panel, shared by every journey
 * that works in it.
 */

export const SEARCH = "חיפוש לפי שם עסק, בעלים או טלפון";

/** A Business's line in the directory: a table row on a desktop, a card on a phone. */
export const inDirectory = (page: Page, name: string) =>
  page.locator(".dir-table tbody tr, .dir-card").filter({ hasText: name }).filter({ visible: true });

/**
 * The suite's database holds every Business any run has made, so a journey
 * finds its own the way an administrator would: by typing its name.
 */
export const findInDirectory = async (page: Page, name: string): Promise<void> => {
  await page.getByPlaceholder(SEARCH).fill(name);
  await expect(inDirectory(page, name)).toBeVisible({ timeout: 20_000 });
};

/** Only two Add-ons may be on sale at once, and the suite shares one database. */
export const noAddonsOnSale = async (token: string): Promise<void> => {
  const { features } = await call<{ features: { feature: string; addon?: unknown }[] }>("/admin/catalogue/features", { token });
  for (const view of features) {
    if (view.addon !== null && view.addon !== undefined) {
      await call(`/admin/catalogue/features/${view.feature}/addon/stop`, { method: "POST", token });
    }
  }
};

/** Catalogue → Features. */
export const openFeatures = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "מחירון" }).click();
  await page.getByRole("tab", { name: "פיצ'רים" }).click();
};
