import type { Appointment } from "../model/appointment.ts";
import type { Business, Resource, Service } from "../model/business.ts";
import { occupiedMinutes } from "../model/business.ts";
import type { ServiceId, UserId } from "../model/ids.ts";
import { DomainError, validationFailed } from "../shared/errors.ts";
import type { Instant } from "../time/instant.ts";
import { addMinutesToInstant } from "../time/instant.ts";
import type { LocalDate } from "../time/local-date.ts";
import { instantToZoned } from "../time/zone.ts";
import { availableSlotsOn, type AvailabilityRequest } from "./availability.ts";
import { bookingWindowFor, isWithinBookingWindow } from "./booking-window.ts";
import type { SlotGenerationStrategy } from "./slots.ts";

export type BookingRequest = {
  readonly business: Business;
  readonly resource: Resource;
  readonly service: Service;
  readonly customerId: UserId;
  readonly startAt: Instant;
  readonly customerNote: string | null;
  readonly now: Instant;
};

/**
 * The shape a validated booking takes before it reaches the database. Price,
 * duration, buffer and service name are copied rather than referenced: an
 * Appointment keeps the terms it was booked under (ADR 0003).
 */
export type AppointmentDraft = Omit<
  Appointment,
  "id" | "cancelledAt" | "cancelledBy" | "lateCancellation" | "createdAt"
>;

export type BookingContext = Omit<
  AvailabilityRequest,
  "business" | "resource" | "service" | "date" | "now"
>;

const MAX_CUSTOMER_NOTE_LENGTH = 500;

export const draftAppointment = (
  request: BookingRequest,
): AppointmentDraft => {
  const { business, service, resource, startAt } = request;
  const buffer = service.bufferMinutes ?? business.defaultBufferMinutes;
  return {
    businessId: business.id,
    resourceId: resource.id,
    serviceId: service.id,
    customerId: request.customerId,
    startAt,
    endAt: addMinutesToInstant(startAt, service.durationMinutes),
    occupiedUntil: addMinutesToInstant(
      startAt,
      occupiedMinutes(service, business),
    ),
    status: "CONFIRMED",
    serviceName: service.name,
    price: service.price,
    durationMinutes: service.durationMinutes,
    bufferMinutes: buffer,
    customerNote: request.customerNote,
  };
};

/**
 * Everything that must hold for a booking to be accepted, checked in the order
 * that produces the most useful message. The final check — that the requested
 * start is one the engine actually offers — is what stops a caller inventing a
 * time that merely happens not to collide with anything.
 *
 * This is not the last line of defence. ADR 0003's exclusion constraint is,
 * and it catches the race this function cannot: two customers passing these
 * checks at the same moment.
 */
export const validateBooking = (
  request: BookingRequest,
  schedule: BookingContext,
  strategy?: SlotGenerationStrategy,
): AppointmentDraft => {
  const { business, resource, service, startAt, now } = request;

  if (!business.active) {
    throw new DomainError(
      "BUSINESS_INACTIVE",
      "This business is not accepting bookings",
    );
  }
  if (!service.active) {
    throw validationFailed("This service is no longer offered");
  }
  if (!resource.active) {
    throw validationFailed("This calendar is not accepting bookings");
  }
  if (service.businessId !== business.id || resource.businessId !== business.id) {
    throw validationFailed("Service and calendar must belong to the business");
  }
  if (
    request.customerNote !== null &&
    request.customerNote.length > MAX_CUSTOMER_NOTE_LENGTH
  ) {
    throw validationFailed(
      `A note may be at most ${MAX_CUSTOMER_NOTE_LENGTH} characters`,
    );
  }

  const draft = draftAppointment(request);
  const window = bookingWindowFor(business, now);
  if (!isWithinBookingWindow(window, startAt, draft.endAt)) {
    throw new DomainError(
      "OUTSIDE_BOOKING_WINDOW",
      "That time is outside the period this business accepts bookings for",
      {
        minimumNoticeMinutes: business.minimumNoticeMinutes,
        bookingHorizonDays: business.bookingHorizonDays,
      },
    );
  }

  const date: LocalDate = instantToZoned(startAt, business.timeZone).date;
  const availability = availableSlotsOn(
    { ...schedule, business, resource, service, date, now },
    strategy,
  );
  const offered = availability.slots.some((slot) => slot.startAt === startAt);
  if (!offered) {
    throw new DomainError(
      "OUTSIDE_WORKING_HOURS",
      "That time is not available",
      { emptyReason: availability.emptyReason },
    );
  }

  return draft;
};

/** Guards the owner-side reschedule of ADR 0005 — a Business action only. */
export const validateReschedule = (
  appointment: Appointment,
  request: BookingRequest,
  schedule: BookingContext,
  strategy?: SlotGenerationStrategy,
): AppointmentDraft => {
  if (appointment.status !== "CONFIRMED") {
    throw validationFailed("Only a confirmed appointment can be rescheduled");
  }
  // The appointment being moved must not block its own new time.
  const withoutItself = {
    ...schedule,
    appointments: schedule.appointments.filter(
      (candidate) => candidate.id !== appointment.id,
    ),
  };
  return validateBooking(request, withoutItself, strategy);
};

export const serviceIdOf = (appointment: Appointment): ServiceId =>
  appointment.serviceId;
