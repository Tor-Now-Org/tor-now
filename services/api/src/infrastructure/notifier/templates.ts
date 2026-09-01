import { TEMPLATES, type NotificationPayload, type Template } from "../../ports/notifier.ts";

/**
 * ADR 0005 counts the approved templates. Meta bills per delivered template
 * message, so the set is closed deliberately: adding a fourth is an approval
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
  });

export const renderTemplate = (
  template: Template,
  payload: NotificationPayload,
): string => RENDERERS[template](payload);
