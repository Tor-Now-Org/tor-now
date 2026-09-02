import { formatInstant, parseLocalDate, parseLocalTime, timeZone, zonedToInstant } from "@tor-now/domain";
import { signIn, type Harness } from "./harness.ts";

/**
 * The shapes the tests keep needing: a business that is actually bookable, and
 * a way to name a time on a known day without doing timezone arithmetic in
 * every assertion.
 */

/** 2026-09-01 is a Tuesday, and sits after the harness's frozen "now". */
export const TUESDAY = "2026-09-01";
const JERUSALEM = timeZone("Asia/Jerusalem");

export const TUESDAY_AT = (time: string): string =>
  formatInstant(
    zonedToInstant(parseLocalDate(TUESDAY), parseLocalTime(time), JERUSALEM),
  );

/**
 * An owner with one business, one calendar, one thirty-minute service and hours
 * on the Tuesday the tests book against. Registered through the real service,
 * so the audit trail and memberships it creates are the real ones.
 */
export const anEstablishedBusiness = async (test: Harness) => {
  const owner = await signIn(test, "+972500000001", "רן");

  const business = await test.services.business.register(owner.actor, {
    name: "מספרת רן",
    phone: "+972500000001",
    description: null,
    address: "רחוב הרצל 1",
    resourceNames: ["רן"],
    services: [
      { name: "תספורת", durationMinutes: 30, priceMinor: 8000, bufferMinutes: null },
    ],
    workingHours: [{ dayOfWeek: 2, start: "09:00", end: "17:00" }],
  });

  const [service] = await test.services.business.listServices(owner.actor, business.id);
  const [resource] = await test.services.business.listResources(owner.actor, business.id);

  if (service === undefined || resource === undefined) {
    throw new Error("Registration did not produce a bookable business");
  }

  return { owner, business, service, resource };
};
