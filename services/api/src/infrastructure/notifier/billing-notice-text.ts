import type { LocalDate } from "@tor-now/domain";
import type { BillingNoticePayload } from "../../ports/notifier.ts";

/**
 * The BILLING_NOTICE template (ADR 0020): one fixed frame Meta approves once,
 * with one sentence per kind of Notice about paying filled into it. Hebrew, as
 * every template is — the owner's language preference lives in their browser,
 * not anywhere a message can read it.
 */

/** Where the owner reads the rest, inside the app. */
export const BILLING_PATH = "/manage?tab=business&panel=billing";

const longDate = (date: LocalDate): string =>
  new Intl.DateTimeFormat("he-IL", { timeZone: "UTC", day: "numeric", month: "long" }).format(
    new Date(`${date}T00:00:00.000Z`),
  );

const summaryOf = (facts: BillingNoticePayload["facts"]): string => {
  switch (facts.kind) {
    case "TRIAL_ENDING":
      return `תקופת הניסיון נגמרת ב־${longDate(facts.trialEndsOn)}. בלי תשלום עד אז, העסק יוסר מהחיפוש.`;
    case "PAYMENT_LATE":
      return `התשלום על המנוי באיחור. העסק נשאר בחיפוש עד ${longDate(facts.graceEndsOn)}, ואחרי זה יוסר ממנו.`;
    case "DEACTIVATED":
      return "המנוי לא שולם, והעסק הוסר מהחיפוש. תורים שכבר נקבעו לא נפגעו, ואחרי התשלום הכול חוזר.";
    case "PAYMENT_RECORDED":
      return `התשלום התקבל, והמנוי שולם עד ${longDate(facts.paidThrough)}. תודה!`;
  }
};

/**
 * The whole message. The link names the deployment it came from, so it is left
 * out rather than guessed when the deployment does not know its own address.
 */
export const billingNoticeText = (payload: BillingNoticePayload, webOrigin: string | null): string =>
  [
    `עדכון על המנוי של ${payload.businessName}: ${summaryOf(payload.facts)}`,
    ...(webOrigin === null ? [] : [`לפרטים באפליקציה: ${webOrigin}${BILLING_PATH}`]),
  ].join("\n");
