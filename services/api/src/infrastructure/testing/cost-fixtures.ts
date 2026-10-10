import {
  asId,
  instant,
  money,
  parseInstant,
  parseLocalDate,
  type BusinessId,
  type CostSource,
  type CostUnit,
  type Feature,
  type Plan,
} from "@tor-now/domain";
import { harness, signIn, type Harness } from "./harness.ts";

/**
 * What the cost tests keep needing (ADR 0023): Businesses on a Plan, standing
 * where a test needs them, with usage recorded as the delivery worker and the
 * sign-in path would record it. Usage and standing are written to the store
 * directly — a test cannot send a thousand messages or wait for a month to lapse.
 */

/** 20 September 2026: the default Unit Rates run from the 1st, so everything this month is priced. */
export const COST_NOW = parseInstant("2026-09-20T09:00:00.000Z");

export const costHarness = (now = COST_NOW): Harness => harness({ now });

let phones = 0;
const nextPhone = (): string => {
  phones += 1;
  return `+9725077${String(phones).padStart(5, "0")}`;
};

/** A Business of its own owner, on a Plan, in its Trial as registration leaves it. */
export const aShop = async (test: Harness, name: string, plan: Plan = "SOLO") => {
  const owner = await signIn(test, nextPhone(), "בעלים");
  const business = await test.services.business.register(owner.actor, {
    name,
    phone: nextPhone(),
    description: null,
    address: "רחוב הרצל 1",
    latitude: 32.0853,
    longitude: 34.7818,
    categories: ["barbershop"],
    plan,
    resourceNames: ["כיסא"],
    services: [{ name: "תספורת", durationMinutes: 30, priceMinor: 8000, bufferMinutes: null }],
    workingHours: [{ dayOfWeek: 2, start: "09:00", end: "17:00" }],
  });
  return { owner, business };
};

const setCover = (test: Harness, businessId: BusinessId, cover: { trialEndsOn: string | null; paidThrough: string | null }) => {
  test.store.subscriptions = test.store.subscriptions.map((subscription) =>
    subscription.businessId === businessId
      ? {
          ...subscription,
          trialEndsOn: cover.trialEndsOn === null ? null : parseLocalDate(cover.trialEndsOn),
          paidThrough: cover.paidThrough === null ? null : parseLocalDate(cover.paidThrough),
        }
      : subscription,
  );
};

/** Paid up to a day: paying before it, in grace for three days after, lapsed after that. */
export const paidThrough = (test: Harness, businessId: BusinessId, day: string): void =>
  setCover(test, businessId, { trialEndsOn: null, paidThrough: day });

/** Never paid and past its Trial: lapsed. */
export const neverPaid = (test: Harness, businessId: BusinessId): void =>
  setCover(test, businessId, { trialEndsOn: "2026-08-01", paidThrough: null });

/** Messages sent at a moment, `times` records of `quantity` units each — what one delivery each would record. */
export const sent = (
  test: Harness,
  businessId: BusinessId | null,
  source: CostSource,
  unit: CostUnit,
  at: string,
  times = 1,
  quantity = 1,
): void => {
  const occurredAt = parseInstant(at);
  test.store.usageRecords = [
    ...test.store.usageRecords,
    ...Array.from({ length: times }, () => ({ businessId, source, unit, quantity, occurredAt })),
  ];
};

/** An Add-on held since a day, at a price. */
export const holding = (test: Harness, businessId: BusinessId, feature: Feature, priceMinor: number, since: string): void => {
  test.store.addonHoldings = [
    ...test.store.addonHoldings,
    {
      id: asId(test.store.nextId("addon-holding")),
      businessId,
      feature,
      addedOn: parseLocalDate(since),
      paysFrom: parseLocalDate(since),
      price: money(priceMinor),
      nextPrice: null,
      endsOn: null,
      ending: null,
    },
  ];
};

/** An administrator, signed in. */
export const anAdministrator = async (test: Harness) => (await signIn(test, "+972500000000", "שקד")).administrator;

/** Micro-shekels, from shekels: what the default rates make of a message. */
export const WHATSAPP = 19_610;
export const SMS_PART = 952_750;
export const AUTHENTICATION = 19_610;
export const AGORA = 10_000;

/** The moment a test's usage is recorded, inside September. */
export const IN_SEPTEMBER = "2026-09-10T10:00:00.000Z";

export const at = (iso: string) => instant(Date.parse(iso));
