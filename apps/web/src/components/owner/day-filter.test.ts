import { describe, expect, it } from "vitest";
import type { CalendarAppointmentDto } from "@/lib/api/types.ts";
import {
  NOTHING,
  anyFilter,
  countOfFilters,
  customersIn,
  keptBy,
  matchesQuery,
  statusOf,
  withinReach,
} from "./day-filter.ts";

const JERUSALEM = "Asia/Jerusalem";

const NOW = Date.parse("2026-10-19T13:20:00.000Z");

const appointment = (
  over: Partial<CalendarAppointmentDto> & { customerName: string; customerPhone: string },
): CalendarAppointmentDto =>
  ({
    id: `a-${over.customerPhone}-${over.startAt ?? ""}`,
    businessId: "b",
    resourceId: "r1",
    serviceId: "s",
    customerId: "c",
    startAt: "2026-10-19T09:00:00.000Z",
    endAt: "2026-10-19T09:30:00.000Z",
    status: "CONFIRMED",
    serviceName: "תספורת",
    resourceName: "דנה",
    priceMinor: 8000,
    price: 80,
    durationMinutes: 30,
    customerNote: null,
    cancelledAt: null,
    cancelledBy: null,
    lateCancellation: false,
    createdAt: "2026-10-01T09:00:00.000Z",
    ...over,
  });

const yael = appointment({ customerName: "יעל כהן", customerPhone: "050-555-6677" });
const otherYael = appointment({
  customerName: "יעל אלון",
  customerPhone: "050-111-2233",
  serviceName: "צבע",
  resourceId: "r2",
});
const noa = appointment({
  customerName: "נועה שדה",
  customerPhone: "050-333-4455",
  startAt: "2026-10-21T09:00:00.000Z",
  endAt: "2026-10-21T10:00:00.000Z",
});

describe("naming a person rather than filtering on a string", () => {
  it("offers each customer once, however many appointments they have", () => {
    const twice = appointment({
      customerName: "יעל כהן",
      customerPhone: "050-555-6677",
      startAt: "2026-10-19T16:00:00.000Z",
    });
    expect(customersIn([yael, twice, otherYael])).toHaveLength(2);
  });

  it("tells two customers with the same first name apart", () => {
    const found = customersIn([yael, otherYael]).filter((one) => matchesQuery(one, "יעל"));
    expect(found.map((one) => one.name)).toEqual(["יעל אלון", "יעל כהן"]);
  });

  it("finds her by phone, however the number is punctuated", () => {
    const her = customersIn([yael])[0];
    expect(her === undefined ? false : matchesQuery(her, "0505556677")).toBe(true);
    expect(her === undefined ? false : matchesQuery(her, "555-6677")).toBe(true);
    expect(her === undefined ? false : matchesQuery(her, "999")).toBe(false);
  });

  it("matches nothing at all on an empty query", () => {
    const her = customersIn([yael])[0];
    expect(her === undefined ? true : matchesQuery(her, "   ")).toBe(false);
  });
});

describe("what the filters leave", () => {
  const all = [yael, otherYael, noa];

  it("is everything when nothing is set", () => {
    expect(anyFilter(NOTHING)).toBe(false);
    expect(keptBy(all, NOTHING, NOW)).toHaveLength(3);
  });

  it("narrows to one person when one is named", () => {
    const kept = keptBy(all, { ...NOTHING, customer: { name: "יעל כהן", phone: "050-555-6677" } }, NOW);
    expect(kept).toEqual([yael]);
  });

  it("combines with and, not or", () => {
    // Her colour appointments — of which there are none, because the colour
    // belongs to the other Yael.
    const kept = keptBy(
      all,
      {
        ...NOTHING,
        customer: { name: "יעל כהן", phone: "050-555-6677" },
        services: ["צבע"],
      },
      NOW,
    );
    expect(kept).toEqual([]);
  });

  it("narrows by calendar and by service", () => {
    expect(keptBy(all, { ...NOTHING, calendars: ["r2"] }, NOW)).toEqual([otherYael]);
    expect(keptBy(all, { ...NOTHING, services: ["תספורת"] }, NOW)).toHaveLength(2);
  });

  it("counts what is set, for the button", () => {
    expect(countOfFilters({ ...NOTHING, calendars: ["r1"], services: ["צבע"] })).toBe(2);
  });
});

describe("status, which the clock decides", () => {
  it("is spent once it has ended", () => {
    expect(statusOf({ status: "CONFIRMED", endAt: "2026-10-19T09:30:00.000Z" }, NOW)).toBe("SPENT");
  });

  it("is upcoming while it is still ahead", () => {
    expect(statusOf({ status: "CONFIRMED", endAt: "2026-10-19T17:00:00.000Z" }, NOW)).toBe(
      "UPCOMING",
    );
  });

  it("is cancelled whatever the clock says", () => {
    expect(statusOf({ status: "CANCELLED", endAt: "2026-10-19T17:00:00.000Z" }, NOW)).toBe(
      "CANCELLED",
    );
  });
});

describe("how far a filtered view reaches", () => {
  const all = [yael, noa];

  it("starts at the day it was opened on", () => {
    expect(withinReach(all, "DAY", "2026-10-19", JERUSALEM)).toEqual([yael]);
  });

  it("takes the week from that day, not the calendar week", () => {
    expect(withinReach(all, "WEEK", "2026-10-19", JERUSALEM)).toHaveLength(2);
    expect(withinReach(all, "WEEK", "2026-10-22", JERUSALEM)).toHaveLength(0);
  });

  it("asks the business's own clock which day it is", () => {
    // 22:30 UTC is half past one the next morning in Jerusalem. Slicing the
    // instant would file it under the previous day and the owner would be told
    // she has nothing booked.
    const lateNight = appointment({
      customerName: "יעל כהן",
      customerPhone: "050-555-6677",
      startAt: "2026-10-19T22:30:00.000Z",
      endAt: "2026-10-19T23:00:00.000Z",
    });
    expect(withinReach([lateNight], "DAY", "2026-10-20", JERUSALEM)).toHaveLength(1);
    expect(withinReach([lateNight], "DAY", "2026-10-19", JERUSALEM)).toHaveLength(0);
  });

  it("takes everything when asked", () => {
    expect(withinReach(all, "ALL", "2026-10-19", JERUSALEM)).toHaveLength(2);
  });
});
