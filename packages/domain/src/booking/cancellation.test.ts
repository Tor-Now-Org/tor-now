import { describe, expect, it } from "vitest";
import {
  cancelAppointment,
  clearNoShow,
  isInsideCancellationWindow,
  markNoShow,
} from "./cancellation.ts";
import { aBusiness, anAppointment, at } from "../testing/fixtures.ts";
import { DomainError } from "../shared/errors.ts";

const business = aBusiness({ cancellationWindowHours: 24 });
const appointment = anAppointment("2026-09-01", "10:00", 30);

describe("the cancellation window", () => {
  it("is outside the window with more notice than it asks for", () => {
    expect(
      isInsideCancellationWindow(
        business,
        appointment.startAt,
        at("2026-08-30", "10:00"),
      ),
    ).toBe(false);
  });

  it("is inside the window with less", () => {
    expect(
      isInsideCancellationWindow(
        business,
        appointment.startAt,
        at("2026-09-01", "08:00"),
      ),
    ).toBe(true);
  });
});

describe("cancelAppointment", () => {
  it("never blocks a customer, but records a late cancellation", () => {
    const outcome = cancelAppointment(
      appointment,
      business,
      "CUSTOMER",
      at("2026-09-01", "08:00"),
    );
    expect(outcome.lateCancellation).toBe(true);
    expect(outcome.cancelledBy).toBe("CUSTOMER");
  });

  it("does not record a late cancellation with enough notice", () => {
    const outcome = cancelAppointment(
      appointment,
      business,
      "CUSTOMER",
      at("2026-08-28", "08:00"),
    );
    expect(outcome.lateCancellation).toBe(false);
  });

  it("never holds a business to its own notice period", () => {
    const outcome = cancelAppointment(
      appointment,
      business,
      "BUSINESS",
      at("2026-09-01", "09:00"),
    );
    expect(outcome.lateCancellation).toBe(false);
  });

  it("refuses to cancel twice", () => {
    expect(() =>
      cancelAppointment(
        { ...appointment, status: "CANCELLED" },
        business,
        "CUSTOMER",
        at("2026-09-01", "08:00"),
      ),
    ).toThrow(DomainError);
  });
});

describe("no show", () => {
  it("cannot be marked before the appointment has started", () => {
    expect(() => markNoShow(appointment, at("2026-09-01", "09:59"))).toThrow(
      DomainError,
    );
  });

  it("can be marked from the appointed time, not only once the slot is over", () => {
    // Somebody who has not walked in at ten has not turned up, and the business
    // knows it then rather than half an hour later.
    expect(() => markNoShow(appointment, at("2026-09-01", "10:00"))).not.toThrow();
    expect(() => markNoShow(appointment, at("2026-09-01", "10:15"))).not.toThrow();
    expect(() => markNoShow(appointment, at("2026-09-01", "10:30"))).not.toThrow();
  });

  it("cannot be marked on a cancelled appointment", () => {
    expect(() =>
      markNoShow(
        { ...appointment, status: "CANCELLED" },
        at("2026-09-02", "10:30"),
      ),
    ).toThrow(DomainError);
  });

  it("can only be cleared when it is set", () => {
    expect(() => clearNoShow({ status: "NO_SHOW" })).not.toThrow();
    expect(() => clearNoShow({ status: "CONFIRMED" })).toThrow(DomainError);
  });
});
