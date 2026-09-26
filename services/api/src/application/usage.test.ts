import { describe, expect, it } from "vitest";
import { asId, instant } from "@tor-now/domain";
import { TEMPLATES } from "../ports/notifier.ts";
import { SOURCE_OF_TEMPLATE, usageRecordFor } from "./usage.ts";

const at = instant(0);
const shop = asId<"Business">("business-1");

describe("SOURCE_OF_TEMPLATE", () => {
  it("charges booking messages to the product and the rest to their Feature", () => {
    expect(SOURCE_OF_TEMPLATE[TEMPLATES.bookingConfirmed]).toBe("BOOKING");
    expect(SOURCE_OF_TEMPLATE[TEMPLATES.bookingReminder]).toBe("REMINDERS");
    expect(SOURCE_OF_TEMPLATE[TEMPLATES.waitingListOpening]).toBe("WAITING_LIST");
  });
});

describe("usageRecordFor", () => {
  it("records a Business's WhatsApp message as one utility template", () => {
    expect(
      usageRecordFor({ businessId: shop, source: "BOOKING", kind: "UTILITY", via: "WHATSAPP", units: 1, at }),
    ).toEqual({ businessId: shop, source: "BOOKING", unit: "WHATSAPP_UTILITY", quantity: 1, occurredAt: at });
  });

  it("records a sign-in code as an authentication template, charged to no Business", () => {
    expect(
      usageRecordFor({ businessId: null, source: "SIGN_IN", kind: "AUTHENTICATION", via: "WHATSAPP", units: 1, at }),
    ).toMatchObject({ businessId: null, unit: "WHATSAPP_AUTHENTICATION" });
  });

  it("records an SMS by its segments, whatever the message was", () => {
    expect(
      usageRecordFor({ businessId: shop, source: "REMINDERS", kind: "UTILITY", via: "SMS", units: 3, at }),
    ).toMatchObject({ unit: "SMS_SEGMENT", quantity: 3 });
  });

  it("records nothing for a delivery nobody pays for", () => {
    expect(
      usageRecordFor({ businessId: shop, source: "BOOKING", kind: "UTILITY", via: "LOG", units: 1, at }),
    ).toBeNull();
  });
});
