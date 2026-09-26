import type { BusinessId, CostSource, CostUnit, Instant, UsageRecord } from "@tor-now/domain";
import { TEMPLATES, type DeliveryChannel, type Template } from "../ports/notifier.ts";

/**
 * Turning a message that went out into the Usage Record of it
 * (docs/billing/CONTEXT.md). It holds no price: what a unit cost is a Unit
 * Rate, entered and corrected apart, and applied when the usage is read. Pure,
 * so the attribution — which Feature caused a message, and what a provider
 * bills it as — is tested apart from the delivery that triggers it.
 */

/**
 * What caused each message. The three that make a booking a booking are the
 * product itself; the rest are Features, so a Plan's price can be read against
 * what each Feature costs.
 */
export const SOURCE_OF_TEMPLATE: Readonly<Record<Template, CostSource>> = Object.freeze({
  [TEMPLATES.bookingConfirmed]: "BOOKING",
  [TEMPLATES.bookingCancelled]: "BOOKING",
  [TEMPLATES.bookingRescheduled]: "BOOKING",
  [TEMPLATES.bookingReminder]: "REMINDERS",
  [TEMPLATES.waitingListOpening]: "WAITING_LIST",
});

/**
 * Meta prices a template by its category — a sign-in code is an
 * authentication template, everything a Business sends is utility (ADR 0005).
 */
export type MessageKind = "UTILITY" | "AUTHENTICATION";

/** What a provider bills a delivery as; nothing for a delivery nobody pays for. */
const unitOf = (via: DeliveryChannel, kind: MessageKind): CostUnit | null => {
  switch (via) {
    case "WHATSAPP":
      return kind === "AUTHENTICATION" ? "WHATSAPP_AUTHENTICATION" : "WHATSAPP_UTILITY";
    case "SMS":
      return "SMS_SEGMENT";
    case "LOG":
      return null;
  }
};

/** The Usage Record of one delivery, or null when it went nowhere billable. */
export const usageRecordFor = (input: {
  businessId: BusinessId | null;
  source: CostSource;
  kind: MessageKind;
  via: DeliveryChannel;
  units: number;
  at: Instant;
}): UsageRecord | null => {
  const unit = unitOf(input.via, input.kind);
  return unit === null
    ? null
    : {
        businessId: input.businessId,
        source: input.source,
        unit,
        quantity: input.units,
        occurredAt: input.at,
      };
};
