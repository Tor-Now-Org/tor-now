import type { OccupiedSpan } from "../model/appointment.ts";
import type { Business, Resource, Service } from "../model/business.ts";
import { occupiedMinutes } from "../model/business.ts";
import type { BlockedSpan, DateOverride, WorkingHours } from "../model/schedule.ts";
import type { Instant } from "../time/instant.ts";
import { addMinutesToInstant } from "../time/instant.ts";
import type { LocalDate } from "../time/local-date.ts";
import { bookingWindowFor, isTrimmedByNotice } from "./booking-window.ts";
import { bufferForBooking, freeIntervalsOn } from "./free-intervals.ts";
import { greedyWalk, type Slot, type SlotGenerationStrategy } from "./slots.ts";
import { zonedToInstant } from "../time/zone.ts";
import { END_OF_DAY, MIDNIGHT } from "../time/local-time.ts";

export type AvailabilityRequest = {
  readonly business: Business;
  readonly resource: Resource;
  readonly service: Service;
  readonly date: LocalDate;
  readonly workingHours: readonly WorkingHours[];
  readonly overrides: readonly DateOverride[];
  readonly blocks: readonly BlockedSpan[];
  readonly occupied: readonly OccupiedSpan[];
  readonly now: Instant;
};

/**
 * Why a day has no Slots. ADR 0012 asks the near-end case to surface the
 * Business's phone number rather than a bare refusal, so the interface needs to
 * tell the three apart.
 */
export const EMPTY_REASONS = [
  "CLOSED",
  "FULLY_BOOKED",
  "TOO_SOON",
  "BEYOND_HORIZON",
] as const;

export type EmptyReason = (typeof EMPTY_REASONS)[number];

export type DayAvailability = {
  readonly date: LocalDate;
  readonly slots: readonly Slot[];
  /** Null when slots were found. */
  readonly emptyReason: EmptyReason | null;
};

const startOfDay = (request: AvailabilityRequest): Instant =>
  zonedToInstant(request.date, MIDNIGHT, request.business.timeZone);

const endOfDay = (request: AvailabilityRequest): Instant =>
  zonedToInstant(request.date, END_OF_DAY, request.business.timeZone);

/**
 * The whole availability pipeline for one Resource on one date: resolve the
 * schedule layers, clip to the booking window, then hand the Free Intervals to
 * a slot strategy. Nothing here knows how slots are chosen, and the strategy
 * knows nothing about schedules.
 */
export const availableSlotsOn = (
  request: AvailabilityRequest,
  strategy: SlotGenerationStrategy = greedyWalk,
): DayAvailability => {
  const { business, service, date, now } = request;
  const window = bookingWindowFor(business, now);
  const bufferMinutes = bufferForBooking(service.bufferMinutes, business);

  const free = freeIntervalsOn({
    date,
    timeZone: business.timeZone,
    workingHours: request.workingHours,
    overrides: request.overrides,
    blocks: request.blocks,
    occupied: request.occupied,
    bufferMinutes,
    window,
  });

  const slots = strategy(free, service.durationMinutes, bufferMinutes);
  if (slots.length > 0) {
    return { date, slots, emptyReason: null };
  }

  return { date, slots: [], emptyReason: emptyReasonFor(request, window) };
};

const emptyReasonFor = (
  request: AvailabilityRequest,
  window: { start: Instant; end: Instant },
): EmptyReason => {
  const dayStart = startOfDay(request);
  const dayEnd = endOfDay(request);

  if (isTrimmedByNotice(window, dayEnd)) return "TOO_SOON";
  if (dayStart >= window.end) return "BEYOND_HORIZON";

  // The day is inside the window, so the schedule itself is what emptied it.
  const openAtAll = freeIntervalsOn({
    date: request.date,
    timeZone: request.business.timeZone,
    workingHours: request.workingHours,
    overrides: request.overrides,
    blocks: [],
    occupied: [],
    bufferMinutes: 0,
    window: { start: dayStart, end: dayEnd },
  });

  return openAtAll.length === 0 ? "CLOSED" : "FULLY_BOOKED";
};

/** The span a booking of this Service would occupy, starting at `startAt`. */
export const occupiedSpanFor = (
  service: Pick<Service, "durationMinutes" | "bufferMinutes">,
  business: Pick<Business, "defaultBufferMinutes">,
  startAt: Instant,
): { readonly endAt: Instant; readonly occupiedUntil: Instant } => ({
  endAt: addMinutesToInstant(startAt, service.durationMinutes),
  occupiedUntil: addMinutesToInstant(
    startAt,
    occupiedMinutes(service, business),
  ),
});
