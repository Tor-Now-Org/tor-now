import { expect, test, type Page } from "@playwright/test";
import { findInDirectory, inDirectory, noAddonsOnSale, openFeatures } from "./admin-support.ts";
import { anAdministrator, asAdministrator, paidUp } from "./cost-support.ts";
import {
  aBusinessWithOpenHours,
  aDayFromNow,
  anInstantAt,
  call,
  closeDatabase,
  database,
  paymentFellDue,
  ready,
  signInDirectly,
  uniquePhone,
} from "./support.ts";

test.afterAll(async () => {
  await closeDatabase();
});

/**
 * What a Business pays, end to end (ADRs 0019–0021): a payment recorded from
 * the Business sheet, a move down that waits for the renewal and is withdrawn,
 * the days owed for moving up again or adding back an Add-on, a paused
 * calendar that comes back with the room for it, and a Preview extended.
 *
 * A month cannot pass in a journey, so what only time would do — paying,
 * having held a Plan, an Add-on that ended — is written the way time would
 * leave it, and anything shared with other journeys is put back after.
 */

type Resource = { id: string; name: string; paused: boolean };

const openBilling = async (page: Page, businessId: string) => {
  await page.goto(`/manage?business=${businessId}&tab=business&panel=billing`);
  await ready(page);
  await expect(page.getByText("המסלולים")).toBeVisible({ timeout: 15_000 });
};

const resourcesOf = (shop: { business: { id: string }; owner: { token: string } }) =>
  call<Resource[]>(`/businesses/${shop.business.id}/resources`, { token: shop.owner.token });

const billingOf = (shop: { business: { id: string }; owner: { token: string } }) =>
  call<{
    subscription: { plan: string; scheduledMove: { plan: string } | null };
    nextPayment: { totalMinor: number; lines: { kind: string; amountMinor: number }[] };
    moveUpOwed: { plan: string; amountMinor: number }[];
    addons: { feature: string; ifAdded: { owed: { amountMinor: number } | null } | null }[];
  }>(`/businesses/${shop.business.id}/subscription`, { token: shop.owner.token });

test.describe("paying", () => {
  test("an administrator records the payment the sheet works out, on Israel's day, and the Business is paid", async ({ page }) => {
    const admin = await anAdministrator();
    const name = `תשלום ${Date.now()}`;
    const shop = await aBusinessWithOpenHours({ name, ownerPhone: uniquePhone(), plan: "SOLO" });
    await paymentFellDue(shop.business.id);
    // Half past midnight in Israel, when UTC still reads yesterday: the hour a
    // payment stamped with the UTC date lands on the wrong day.
    const today = aDayFromNow(0);
    await page.clock.setFixedTime(new Date(anInstantAt(today, "00:30")));

    await asAdministrator(page, admin);
    await findInDirectory(page, name);
    await inDirectory(page, name).getByText(name).click();

    const sheet = page.getByRole("dialog");
    const amount = sheet.getByLabel("סכום");
    // What the owner was told the next payment comes to, line by line.
    await expect(amount).toHaveValue("49", { timeout: 15_000 });
    await expect(sheet.getByText(/^יחיד .*49.*\. אפשר לשנות\.$/)).toBeVisible();
    await sheet.getByRole("button", { name: "רישום תשלום" }).click();

    await expect(inDirectory(page, name).getByText("משולם")).toBeVisible({ timeout: 20_000 });
    const payments = await database()<{ amount_minor: number; paid_on: string }[]>`
      select amount_minor, paid_on::text from payment where business_id = ${shop.business.id}`;
    expect(payments).toEqual([{ amount_minor: 4_900, paid_on: today }]);
  });
});

test.describe("moving between Plans", () => {
  test("a paying owner schedules a move down for the renewal, and withdraws it", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({ name: `מעבר מתוזמן ${Date.now()}`, ownerPhone, plan: "TEAM" });
    await paidUp(shop.business.id);
    await signInDirectly(page, ownerPhone, "בעלים");
    await openBilling(page, shop.business.id);

    await page.getByRole("radio", { name: /יחיד/ }).check();
    await expect(page.getByText(/המעבר ייכנס לתוקף בחידוש, ב־/)).toBeVisible();
    await page.getByRole("button", { name: "תזמון מעבר ליחיד" }).click();

    const pending = page.locator(".pending-move");
    await expect(pending).toContainText(/המעבר ליחיד ייכנס לתוקף ב־/, { timeout: 15_000 });
    // Nothing changes before the renewal: still Team, still on it.
    await expect(page.locator(".plan-choice.on").getByText("המסלול שלכם")).toBeVisible();
    expect((await billingOf(shop)).subscription).toMatchObject({ plan: "TEAM", scheduledMove: { plan: "SOLO" } });

    await pending.getByRole("button", { name: "ביטול המעבר" }).click();
    await expect(pending).toBeHidden({ timeout: 15_000 });
    expect((await billingOf(shop)).subscription).toMatchObject({ plan: "TEAM", scheduledMove: null });
  });

  test("moving up again to a Plan left before says the days owed first, and adds them to the next payment", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({ name: `שוב בצוות ${Date.now()}`, ownerPhone, plan: "SOLO" });
    await paidUp(shop.business.id);
    // Held Team while paying, as a Business that moved down from it would have.
    await database()`insert into plan_held (business_id, plan) values (${shop.business.id}, 'TEAM')`;
    const owed = (await billingOf(shop)).moveUpOwed.find((entry) => entry.plan === "TEAM")?.amountMinor ?? 0;
    expect(owed).toBeGreaterThan(0);
    await signInDirectly(page, ownerPhone, "בעלים");
    await openBilling(page, shop.business.id);

    await page.getByRole("radio", { name: /צוות/ }).check();
    await expect(page.getByText(/כבר הייתם בצוות, ולכן ההפרש משולם מהיום/)).toBeVisible();
    await page.getByRole("button", { name: "עוברים לצוות עכשיו" }).click();

    await expect(page.locator(".plan-choice.on").getByText("המסלול שלכם")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".pay-row", { hasText: /בתשלום הבא/ })).toBeVisible();
    const after = await billingOf(shop);
    // Exactly what it said it would owe, on top of Team's price.
    expect(after.nextPayment.lines).toEqual([
      expect.objectContaining({ kind: "PLAN", amountMinor: 8_900 }),
      expect.objectContaining({ kind: "DAYS", amountMinor: owed }),
    ]);
    expect(after.nextPayment.totalMinor).toBe(8_900 + owed);
  });

  test("a calendar paused for a smaller Plan comes back when the owner moves up", async ({ page }) => {
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({ name: `חזרה לצוות ${Date.now()}`, ownerPhone, plan: "TEAM" });
    await call(`/businesses/${shop.business.id}/resources`, { method: "POST", token: shop.owner.token, body: { name: "כיסא שני" } });
    const first = (await resourcesOf(shop)).find((resource) => resource.name !== "כיסא שני");
    await call(`/businesses/${shop.business.id}/subscription/plan`, {
      method: "PUT",
      token: shop.owner.token,
      body: { plan: "SOLO", keep: [first?.id] },
    });
    expect((await resourcesOf(shop)).find((resource) => resource.name === "כיסא שני")?.paused).toBe(true);

    await signInDirectly(page, ownerPhone, "בעלים");
    await openBilling(page, shop.business.id);
    await page.getByRole("radio", { name: /צוות/ }).check();
    await page.getByRole("button", { name: "עוברים לצוות עכשיו" }).click();

    await expect(page.locator(".plan-choice.on").getByText("המסלול שלכם")).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => (await resourcesOf(shop)).find((resource) => resource.name === "כיסא שני")?.paused, { timeout: 15_000 })
      .toBe(false);
  });
});

test.describe("Add-ons", () => {
  test("adding back an Add-on that ended says the days owed before anything is added", async ({ page }) => {
    const admin = await anAdministrator();
    await noAddonsOnSale(admin);
    await call("/admin/catalogue/features/TEAM_ROLES/addon", { method: "POST", token: admin, body: { priceMinor: 900 } });
    const ownerPhone = uniquePhone();
    const shop = await aBusinessWithOpenHours({ name: `תוספת חוזרת ${Date.now()}`, ownerPhone, plan: "SOLO" });
    try {
      await paidUp(shop.business.id);
      // Held once and cancelled; it ended last week.
      await database()`
        insert into addon_holding (business_id, feature, added_on, pays_from, price_minor, ends_on, ending)
        values (${shop.business.id}, 'TEAM_ROLES', current_date - 40, current_date - 30, 900,
                current_date - 7, 'CANCELLED')`;
      const owed = (await billingOf(shop)).addons.find((addon) => addon.feature === "TEAM_ROLES")?.ifAdded?.owed?.amountMinor ?? 0;
      expect(owed).toBeGreaterThan(0);
      await signInDirectly(page, ownerPhone, "בעלים");
      await openBilling(page, shop.business.id);

      const row = page.locator(".addon-row", { hasText: "מנהלים ועובדים" });
      await expect(row.getByText("הייתה אצלכם · בתשלום מהיום")).toBeVisible({ timeout: 15_000 });
      await row.getByRole("button", { name: "הוספה" }).click();
      const again = page.getByRole("dialog", { name: "הוספה מחדש: מנהלים ועובדים" });
      await expect(again.getByText(/התוספת כבר הייתה אצלכם, ולכן התשלום מתחיל מהיום/)).toBeVisible();
      await again.getByRole("button", { name: /הוספה — .* על הימים שעד התשלום/ }).click();

      await expect(row.getByText("פעיל")).toBeVisible({ timeout: 15_000 });
      await expect(page.locator(".pay-row", { hasText: /בתשלום הבא/ })).toBeVisible();
      const after = await billingOf(shop);
      expect(after.nextPayment.lines).toEqual([
        expect.objectContaining({ kind: "PLAN", amountMinor: 4_900 }),
        expect.objectContaining({ kind: "ADDON", amountMinor: 900 }),
        expect.objectContaining({ kind: "DAYS", amountMinor: owed }),
      ]);
      expect(after.nextPayment.totalMinor).toBe(4_900 + 900 + owed);
    } finally {
      await call("/admin/catalogue/features/TEAM_ROLES/addon/stop", { method: "POST", token: admin }).catch(() => undefined);
    }
  });
});

test.describe("Previews", () => {
  test("an administrator extends a running Preview, and says to when before saving", async ({ page }) => {
    const admin = await anAdministrator();
    const sql = database();
    const [before] = await sql<{ ends_on: string; keep_on: string[] | null }[]>`
      select ends_on::text, keep_on from feature_preview where feature = 'WAITING_LIST'`;
    // A known end, so the journey reads the same whatever an earlier run left.
    await sql`
      insert into feature_preview (feature, ends_on) values ('WAITING_LIST', current_date + 20)
      on conflict (feature) do update set ends_on = excluded.ends_on`;
    const [{ extended } = { extended: "" }] = await sql<{ extended: string }[]>`select (current_date + 50)::text as extended`;
    try {
      await asAdministrator(page, admin);
      await openFeatures(page);

      const waiting = page.locator(".feature-card", { hasText: "רשימת המתנה" });
      await waiting.getByRole("button", { name: "הארכה" }).click({ timeout: 15_000 });
      const extend = page.getByRole("dialog", { name: "הארכת התצוגה — רשימת המתנה" });
      await expect(extend.getByText("עכשיו עד")).toBeVisible();
      await extend.getByRole("button", { name: /^הארכה עד/ }).click();
      await expect(extend).toBeHidden({ timeout: 15_000 });

      const { previews } = await call<{ previews: { feature: string; endsOn: string }[] }>("/plans");
      expect(previews).toContainEqual({ feature: "WAITING_LIST", endsOn: extended });
    } finally {
      if (before === undefined) await sql`delete from feature_preview where feature = 'WAITING_LIST'`;
      else await sql`update feature_preview set ends_on = ${before.ends_on}, keep_on = ${before.keep_on} where feature = 'WAITING_LIST'`;
    }
  });
});
