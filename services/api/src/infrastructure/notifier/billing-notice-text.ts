import type { Feature, LocalDate, Plan } from "@tor-now/domain";
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

const PLAN_IN_HEBREW: Readonly<Record<Plan, string>> = Object.freeze({ SOLO: "יחיד", TEAM: "צוות" });

const FEATURE_IN_HEBREW: Readonly<Record<Feature, string>> = Object.freeze({
  REMINDERS: "תזכורות",
  CUSTOMER_HISTORY: "היסטוריית לקוח",
  TEAM_ROLES: "מנהלים ועובדים",
  WAITING_LIST: "רשימת המתנה",
});

const shekels = (minor: number): string => `₪${Math.round(minor / 100)}`;

const inHebrew = (names: readonly string[]): string =>
  new Intl.ListFormat("he-IL", { type: "conjunction" }).format(names);

/** What a new edition changes, the part that takes first. */
const editionChanges = (facts: Extract<BillingNoticePayload["facts"], { kind: "EDITION_ANNOUNCED" }>): string =>
  inHebrew([
    ...(facts.priceTo === facts.priceFrom
      ? []
      : [`המחיר ${facts.priceTo > facts.priceFrom ? "עולה" : "יורד"} מ־${shekels(facts.priceFrom)} ל־${shekels(facts.priceTo)} לחודש`]),
    ...(facts.allowanceTo === facts.allowanceFrom ? [] : [`${facts.allowanceTo} יומנים במקום ${facts.allowanceFrom}`]),
    ...(facts.lost.length === 0 ? [] : [`${inHebrew(facts.lost.map((f) => FEATURE_IN_HEBREW[f]))} כבר לא כלול`]),
    ...(facts.gained.length === 0 ? [] : [`נוסף ${inHebrew(facts.gained.map((f) => FEATURE_IN_HEBREW[f]))}`]),
  ]);

const summaryOf = (facts: BillingNoticePayload["facts"]): string => {
  switch (facts.kind) {
    case "TRIAL_ENDING":
      return `תקופת הניסיון נגמרת ב־${longDate(facts.trialEndsOn)}. בלי תשלום עד אז, העסק יוסר מהחיפוש.`;
    case "PAYMENT_LATE":
      return `התשלום על המנוי באיחור. העסק נשאר בחיפוש עד ${longDate(facts.graceEndsOn)}, ואחרי זה יוסר ממנו.`;
    case "PAYMENT_DUE":
      return `תקופת הניסיון הסתיימה — היא כבר נוצלה בעסק קודם. יש לשלם היום: בלי תשלום, ב־${longDate(facts.deactivatesOn)} בשעה ${facts.at} העסק יוסר מהחיפוש ולא יקבל תורים חדשים.`;
    case "DEACTIVATED":
      return "המנוי לא שולם, והעסק הוסר מהחיפוש. תורים שכבר נקבעו לא נפגעו, ואחרי התשלום הכול חוזר.";
    case "PAYMENT_RECORDED":
      return `התשלום התקבל, והמנוי שולם עד ${longDate(facts.paidThrough)}. תודה!`;
    case "EDITION_ANNOUNCED":
      return `מסלול ${PLAN_IN_HEBREW[facts.plan]} משתנה ב־${longDate(facts.effectiveOn)} — ${editionChanges(facts)}. עד אז הכול נשאר כמו שהוא.`;
    case "EDITION_CANCELLED":
      return `השינוי שהודענו עליו במסלול ${PLAN_IN_HEBREW[facts.plan]} בוטל. המסלול נשאר כמו שהוא.`;
    case "PREVIEW_LEAVING":
      return [
        `${FEATURE_IN_HEBREW[facts.feature]} היה בתצוגה מוקדמת, והוא יוצא ממסלול ${PLAN_IN_HEBREW[facts.plan]} ב־${longDate(facts.endsOn)}. מה שכבר נעשה איתו נשאר.`,
        ...(facts.addonPriceMinor === null
          ? []
          : [`אפשר להשאיר אותו כתוספת ב־${shekels(facts.addonPriceMinor)} לחודש, מדף המנוי.`]),
      ].join(" ");
    case "ADDON_PRICE_RISING":
      return `המחיר של התוספת ${FEATURE_IN_HEBREW[facts.feature]} עולה מ־${shekels(facts.priceFrom)} ל־${shekels(facts.priceTo)} לחודש, מהתשלום ב־${longDate(facts.effectiveOn)}. עד אז הוא לא משתנה, ואפשר לבטל את התוספת בדף המנוי.`;
    case "ADDON_RISE_CANCELLED":
      return `העלאת המחיר של התוספת ${FEATURE_IN_HEBREW[facts.feature]} בוטלה. המחיר נשאר ${shekels(facts.priceMinor)} לחודש.`;
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
