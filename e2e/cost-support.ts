import { expect, type Page } from "@playwright/test";
import { call, database, makeAdministrator, ready, uniquePhone } from "./support.ts";

/**
 * What the cost journeys need (ADR 0023). Usage is written straight into
 * usage_record, as the delivery worker would after a real send — the suite's
 * transports go to the log, which records nothing, and a journey cannot send a
 * thousand WhatsApp messages. Everything a journey changes that other journeys
 * would see — limits, saved Businesses, running costs — is put back after it.
 */

export type Unit = "WHATSAPP_UTILITY" | "WHATSAPP_AUTHENTICATION" | "SMS_SEGMENT";

/** `times` messages of `quantity` units each, sent at a moment (now by default). */
export const recordUsage = async (input: {
  businessId: string | null;
  source: string;
  unit: Unit;
  times: number;
  quantity?: number;
  at?: string;
}): Promise<void> => {
  const sql = database();
  const at = input.at ?? new Date().toISOString();
  await sql`
    insert into usage_record (business_id, source, unit, quantity, occurred_at)
    select ${input.businessId}, ${input.source}, ${input.unit}, ${input.quantity ?? 1}, ${at}::timestamptz
    from generate_series(1, ${input.times})`;
};

/** Paid well into next month: a paying Business, as the figures count one. */
export const paidUp = async (businessId: string): Promise<void> => {
  const sql = database();
  await sql`
    update subscription
    set trial_ends_on = null, paid_through = current_date + 40
    where business_id = ${businessId}`;
};

/**
 * The cost tables as the migration left them. Usage is not touched: it is
 * append-only, and every journey reads only what it can tell apart as its own.
 */
export const resetCosts = async (): Promise<void> => {
  const sql = database();
  await sql`update fair_use_limit set business_month_minor = 12000 where source = 'BOOKING'`;
  await sql`update fair_use_limit set business_month_minor = 10000 where source = 'REMINDERS'`;
  await sql`update fair_use_limit set business_month_minor = 1000 where source = 'WAITING_LIST'`;
  await sql`update fair_use_limit set codes_per_day = 300 where source = 'SIGN_IN'`;
  await sql`delete from reference_business where name not in ('בינוני', 'עמוס')`;
  await sql`delete from running_cost`;
};

/** An administrator's session, flagged and allowlisted as the seeding migration does it. */
export const anAdministrator = async (): Promise<string> => {
  const phone = uniquePhone();
  const first = await call<{ code: string }>("/auth/request-code", { method: "POST", body: { phone } });
  await call("/auth/verify", { method: "POST", body: { phone, code: first.code, name: { givenName: "הנהלה", familyName: null } } });
  await makeAdministrator(phone);
  const again = await call<{ code: string }>("/auth/request-code", { method: "POST", body: { phone } });
  return (await call<{ token: string }>("/auth/verify", { method: "POST", body: { phone, code: again.code, name: null } })).token;
};

export const asAdministrator = async (page: Page, token: string): Promise<void> => {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    ["tor-now.session", token],
  );
  await page.goto("/admin");
  await ready(page);
};

/** Catalogue → Cost → one of its three parts. */
export const openCosts = async (page: Page, part: "החודש" | "מחשבון" | "שימוש הוגן"): Promise<void> => {
  await page.getByRole("button", { name: "מחירון" }).click();
  await page.getByRole("tab", { name: "עלויות" }).click();
  await page.getByRole("tab", { name: part }).click();
};

/** The figure a card shows, as text: "₪18.21". */
export const shekels = (text: string | null): number => Number((text ?? "").replace(/[^\d.]/g, ""));

export { expect };
