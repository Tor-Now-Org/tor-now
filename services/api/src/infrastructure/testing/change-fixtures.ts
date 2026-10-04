import {
  formatLocalTime,
  instantToZoned,
  parseInstant,
  timeZone,
  type ChangeOutcome,
  type ChangeScope,
  type ResourceId,
} from "@tor-now/domain";
import type { ChangePlan } from "../../application/change-service.ts";
import { signIn, type Harness } from "./harness.ts";
import { anEstablishedBusiness, TUESDAY, TUESDAY_AT } from "./scenarios.ts";

/**
 * A shop with two calendars, both open 09:00–17:00 on the Tuesday the tests
 * book against and on the Wednesday after it — enough to tell a change for
 * one calendar from a change for the whole business by what a customer is
 * offered afterwards.
 */

export const WEDNESDAY = "2026-09-02";
export const THURSDAY = "2026-09-03";
const JERUSALEM = timeZone("Asia/Jerusalem");

const WEEK = [
  { dayOfWeek: 2, start: "09:00", end: "17:00" },
  { dayOfWeek: 3, start: "09:00", end: "17:00" },
  { dayOfWeek: 4, start: "09:00", end: "17:00" },
];

export const aTwoCalendarShop = async (test: Harness) => {
  const shop = await anEstablishedBusiness(test);
  const second = await test.services.business.createResource(shop.owner.actor, shop.business.id, "שימי");
  await test.services.business.replaceWorkingHours(shop.owner.actor, shop.business.id, shop.resource.id, WEEK);
  await test.services.business.replaceWorkingHours(shop.owner.actor, shop.business.id, second.id, WEEK);
  return { ...shop, second };
};

export type Shop = Awaited<ReturnType<typeof aTwoCalendarShop>>;

export const calendar = (resourceId: ResourceId): ChangeScope => ({ kind: "CALENDAR", resourceId });
export const BUSINESS: ChangeScope = { kind: "BUSINESS" };

export const aPlan = (
  scope: ChangeScope,
  outcome: ChangeOutcome,
  ranges: readonly { start: string; end: string }[] = [],
  days: { fromDate?: string; toDate?: string; note?: string | null } = {},
): ChangePlan => ({
  scope,
  outcome,
  ranges,
  fromDate: days.fromDate ?? TUESDAY,
  toDate: days.toDate ?? days.fromDate ?? TUESDAY,
  note: days.note ?? null,
});

/** The start times a customer is offered on a calendar that day, as the clock on the wall says them. */
export const offered = async (test: Harness, shop: Shop, resourceId: ResourceId, date = TUESDAY) => {
  const [day] = await test.services.availability.forRange(
    { kind: "ANONYMOUS" },
    { businessId: shop.business.id, serviceId: shop.service.id, resourceId, from: date as never, to: date as never },
  );
  return (day?.slots ?? []).map((slot) => formatLocalTime(instantToZoned(parseInstant(slot.startAt), JERUSALEM).time));
};

let phones = 100;

export const aBooking = async (test: Harness, shop: Shop, resourceId: ResourceId, at: string, name = "דנה כהן") => {
  phones += 1;
  const customer = await signIn(test, `+97250000${String(phones).padStart(4, "0")}`, name);
  return test.services.booking.book(customer.actor, {
    businessId: shop.business.id,
    serviceId: shop.service.id,
    resourceId,
    startAt: at.includes("T") ? at : TUESDAY_AT(at),
    customerNote: null,
  });
};

export const aMember = async (
  test: Harness,
  shop: Shop,
  role: "WORKER" | "MANAGER",
  resourceIds: readonly ResourceId[],
) => {
  phones += 1;
  const phone = `+97250000${String(phones).padStart(4, "0")}`;
  const member = await signIn(test, phone, role === "WORKER" ? "דנה" : "מנהלת");
  await test.services.business.inviteUser(shop.owner.actor, shop.business.id, {
    phone,
    givenName: role === "WORKER" ? "דנה" : "מנהלת",
    familyName: null,
    role,
    resourceIds,
  });
  return member;
};

/** The hours 09:00 to 16:30 every half hour: a day nobody changed. */
export const A_WHOLE_DAY = Array.from({ length: 16 }, (_unused, index) =>
  formatLocalTime((9 * 60 + index * 30) as never),
);
