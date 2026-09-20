import { TEMPLATES, type NotificationPayload, type Template } from "../../ports/notifier.ts";

/**
 * ADR 0005 counts the approved templates. Meta bills per delivered template
 * message, so the set is closed deliberately: adding a sixth is an approval
 * process with Meta, not a code change.
 *
 * Hebrew is the source language of the product, and a customer's WhatsApp is
 * not the place to guess at a language preference the platform does not store.
 */
const RENDERERS: Readonly<Record<Template, (payload: NotificationPayload) => string>> =
  Object.freeze({
    [TEMPLATES.bookingConfirmed]: (payload) =>
      `שלום ${payload.customerName}, התור שלך ל${payload.serviceName} ב${payload.businessName} נקבע ל־${payload.startAt}. לביטול או שינוי: ${payload.businessPhone}`,
    [TEMPLATES.bookingCancelled]: (payload) =>
      `שלום ${payload.customerName}, התור שלך ל${payload.serviceName} ב${payload.businessName} ב־${payload.startAt} בוטל.`,
    [TEMPLATES.bookingReminder]: (payload) =>
      `שלום ${payload.customerName}, תזכורת: התור שלך ל${payload.serviceName} ב${payload.businessName} מחר ב־${payload.startAt}. לביטול או שינוי: ${payload.businessPhone}`,
    [TEMPLATES.bookingRescheduled]: (payload) =>
      `שלום ${payload.customerName}, התור שלך ל${payload.serviceName} ב${payload.businessName} הועבר מ־${payload.previousStartAt ?? "מועד קודם"} ל־${payload.startAt}.`,
    /**
     * ADR 0018. It names the part of the day rather than the hour: by the time
     * anybody reads this the exact hour may be gone, and a wrong specific is
     * worse than a right general. It does name the calendar, because "either
     * of them" was on offer and which one freed is the thing the customer
     * could not have worked out. And it says plainly that others were told, so
     * arriving second is expected rather than a broken promise.
     */
    [TEMPLATES.waitingListOpening]: (payload) =>
      `שלום ${payload.customerName}, התפנתה שעה ב${payload.businessName} ל${payload.serviceName}${
        payload.resourceName === undefined ? "" : ` אצל ${payload.resourceName}`
      } — ${PART_IN_HEBREW[payload.partOfDay ?? ""] ?? "במהלך היום"}${
        payload.onDate === undefined ? "" : ` של ${dayInHebrew(payload.onDate)}`
      }. ההודעה נשלחה גם לממתינים נוספים; מי שתופס ראשון, תופס.`,
  });

/**
 * A date a person can read.
 *
 * The other four templates print `startAt`, which is an Instant and renders as
 * an ISO timestamp — a wart they share and one this template must not copy,
 * because it names a day rather than an hour. Read as UTC: a Local Date is a
 * calendar day with no zone, and re-interpreting it in one can move it.
 */
const dayInHebrew = (onDate: string): string =>
  new Intl.DateTimeFormat("he-IL", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${onDate}T00:00:00.000Z`));

/** The product's own words for the parts of the day, as the slot grid says them. */
const PART_IN_HEBREW: Readonly<Record<string, string>> = Object.freeze({
  MORNING: "בבוקר",
  NOON: "בצהריים",
  EVENING: "בערב",
});

export const renderTemplate = (
  template: Template,
  payload: NotificationPayload,
): string => RENDERERS[template](payload);
