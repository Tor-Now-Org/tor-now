import { describe, expect, it } from "vitest";
import { validateBooking, validateReschedule } from "./booking.ts";
import {
  aBusiness,
  anAppointment,
  anOccupiedSpan,
  aResource,
  aService,
  at,
  JERUSALEM,
  workingHours,
} from "../testing/fixtures.ts";
import { spanOf } from "../model/appointment.ts";
import { asId } from "../model/ids.ts";
import { DomainError } from "../shared/errors.ts";

const TUESDAY = "2026-09-01";

const schedule = (overrides = {}) => ({
  workingHours: [workingHours(2, "09:00", "17:00")],
  overrides: [],
  blocks: [],
  occupied: [],
  ...overrides,
});

const bookingAt = (time: string, overrides = {}) => ({
  business: aBusiness(),
  resource: aResource(),
  service: aService(),
  customerId: asId<"User">("user-1"),
  startAt: at(TUESDAY, time),
  customerNote: null,
  now: at("2026-08-25", "09:00"),
  ...overrides,
});

describe("validateBooking", () => {
  it("accepts a start the engine offers, and snapshots the terms", () => {
    const draft = validateBooking(bookingAt("09:00"), schedule());
    expect(draft.status).toBe("CONFIRMED");
    expect(draft.startAt).toBe(at(TUESDAY, "09:00"));
    expect(draft.endAt).toBe(at(TUESDAY, "09:30"));
    expect(draft.serviceName).toBe("תספורת");
    expect(draft.price).toBe(8000);
    expect(draft.durationMinutes).toBe(30);
  });

  it("occupies the duration plus the buffer", () => {
    const draft = validateBooking(
      bookingAt("09:00", { service: aService({ bufferMinutes: 10 }) }),
      schedule(),
    );
    expect(draft.occupiedUntil).toBe(at(TUESDAY, "09:40"));
    expect(draft.bufferMinutes).toBe(10);
  });

  it("refuses a time the engine does not offer", () => {
    // 09:07 collides with nothing, but is not a start the greedy walk produces.
    expect(() => validateBooking(bookingAt("09:07"), schedule())).toThrow(
      expect.objectContaining({ code: "OUTSIDE_WORKING_HOURS" }),
    );
  });

  it("refuses a time outside working hours", () => {
    expect(() => validateBooking(bookingAt("20:00"), schedule())).toThrow(
      DomainError,
    );
  });

  it("refuses a time already taken", () => {
    expect(() =>
      validateBooking(
        bookingAt("09:00"),
        schedule({ occupied: [anOccupiedSpan(TUESDAY, "09:00", 30)] }),
      ),
    ).toThrow(DomainError);
  });

  it("refuses a booking at an inactive business", () => {
    expect(() =>
      validateBooking(
        bookingAt("09:00", { business: aBusiness({ active: false }) }),
        schedule(),
      ),
    ).toThrow(expect.objectContaining({ code: "BUSINESS_INACTIVE" }));
  });

  it("refuses a withdrawn service", () => {
    expect(() =>
      validateBooking(
        bookingAt("09:00", { service: aService({ active: false }) }),
        schedule(),
      ),
    ).toThrow(DomainError);
  });

  it("refuses a service belonging to another business", () => {
    expect(() =>
      validateBooking(
        bookingAt("09:00", {
          service: aService({ businessId: asId("other-business") }),
        }),
        schedule(),
      ),
    ).toThrow(DomainError);
  });

  it("refuses a booking inside the minimum notice", () => {
    expect(() =>
      validateBooking(
        bookingAt("09:00", { now: at(TUESDAY, "08:30") }),
        schedule(),
      ),
    ).toThrow(expect.objectContaining({ code: "OUTSIDE_BOOKING_WINDOW" }));
  });

  it("refuses a booking beyond the horizon", () => {
    expect(() =>
      validateBooking(
        bookingAt("09:00", {
          business: aBusiness({ bookingHorizonDays: 1 }),
          now: at("2026-08-01", "09:00"),
        }),
        schedule(),
      ),
    ).toThrow(expect.objectContaining({ code: "OUTSIDE_BOOKING_WINDOW" }));
  });

  it("refuses an over-long note", () => {
    expect(() =>
      validateBooking(
        bookingAt("09:00", { customerNote: "x".repeat(501) }),
        schedule(),
      ),
    ).toThrow(DomainError);
  });

  it("books in the business's own timezone, not the server's", () => {
    const draft = validateBooking(bookingAt("09:00"), schedule());
    expect(new Date(draft.startAt).toISOString()).toBe(
      "2026-09-01T06:00:00.000Z",
    );
    expect(JERUSALEM).toBe("Asia/Jerusalem");
  });
});

describe("validateReschedule", () => {
  const existing = anAppointment(TUESDAY, "09:00", 30);

  it("lets an appointment move onto the time it currently occupies", () => {
    const draft = validateReschedule(
      existing,
      bookingAt("09:00"),
      schedule({ occupied: [spanOf(existing)] }),
    );
    expect(draft.startAt).toBe(at(TUESDAY, "09:00"));
  });

  it("still refuses a move onto someone else's time", () => {
    const other = anAppointment(TUESDAY, "10:00", 30, 0, {
      id: asId("other-appointment"),
    });
    expect(() =>
      validateReschedule(
        existing,
        bookingAt("10:00"),
        schedule({ occupied: [spanOf(existing), spanOf(other)] }),
      ),
    ).toThrow(DomainError);
  });

  it("refuses to reschedule a cancelled appointment", () => {
    expect(() =>
      validateReschedule(
        { ...existing, status: "CANCELLED" },
        bookingAt("11:00"),
        schedule({ occupied: [spanOf(existing)] }),
      ),
    ).toThrow(DomainError);
  });
});
