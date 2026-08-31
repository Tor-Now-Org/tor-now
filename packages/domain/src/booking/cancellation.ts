import type { Appointment, CancelledBy } from "../model/appointment.ts";
import type { Business } from "../model/business.ts";
import { DomainError, validationFailed } from "../shared/errors.ts";
import { MINUTES_PER_HOUR } from "../shared/constants.ts";
import {
  minutesBetweenInstants,
  type Instant,
} from "../time/instant.ts";

/**
 * The Cancellation Window governs visibility, not permission (CONTEXT.md).
 * A customer may always cancel; cancelling inside the window is recorded as a
 * Late Cancellation and shown to the Business, and never blocked.
 */
export const isInsideCancellationWindow = (
  business: Pick<Business, "cancellationWindowHours">,
  appointmentStart: Instant,
  now: Instant,
): boolean =>
  minutesBetweenInstants(now, appointmentStart) <
  business.cancellationWindowHours * MINUTES_PER_HOUR;

export type CancellationOutcome = {
  readonly cancelledAt: Instant;
  readonly cancelledBy: CancelledBy;
  readonly lateCancellation: boolean;
};

export const cancelAppointment = (
  appointment: Pick<Appointment, "status" | "startAt">,
  business: Pick<Business, "cancellationWindowHours">,
  cancelledBy: CancelledBy,
  now: Instant,
): CancellationOutcome => {
  if (appointment.status === "CANCELLED") {
    throw new DomainError(
      "ALREADY_CANCELLED",
      "This appointment has already been cancelled",
    );
  }
  if (appointment.status !== "CONFIRMED") {
    throw validationFailed("Only a confirmed appointment can be cancelled");
  }

  return {
    cancelledAt: now,
    cancelledBy,
    // A Late Cancellation is a customer's doing. A Business cancelling its own
    // appointment is not holding the customer to the notice it asked for.
    lateCancellation:
      cancelledBy === "CUSTOMER" &&
      isInsideCancellationWindow(business, appointment.startAt, now),
  };
};

/**
 * An Appointment whose time passed without the customer attending, marked as
 * such by the Business. Distinct from a cancellation, which is a decision taken
 * before the fact by a named party.
 */
export const markNoShow = (
  appointment: Pick<Appointment, "status" | "endAt">,
  now: Instant,
): void => {
  if (appointment.status === "CANCELLED") {
    throw validationFailed("A cancelled appointment cannot be a no show");
  }
  if (now < appointment.endAt) {
    throw validationFailed(
      "An appointment cannot be marked a no show before it has ended",
    );
  }
};

/** Undoing the mark, which the owner screens offer on the appointment card. */
export const clearNoShow = (
  appointment: Pick<Appointment, "status">,
): void => {
  if (appointment.status !== "NO_SHOW") {
    throw validationFailed("This appointment is not marked as a no show");
  }
};
