import type { OccupiedSpan } from "../model/appointment.ts";
import type { Business, Resource, Service } from "../model/business.ts";
import { occupiedMinutes } from "../model/business.ts";
import type { BlockedSpan, DateOverride, WorkingHours } from "../model/schedule.ts";
import type { Instant } from "../time/instant.ts";
import { addMinutesToInstant, minutesBetweenInstants } from "../time/instant.ts";
import type { LocalDate } from "../time/local-date.ts";
import type { Interval } from "../time/interval.ts";
import { bookingWindowFor, type BookingWindow } from "./booking-window.ts";
import { bufferForBooking, freeIntervalsOn } from "./free-intervals.ts";
import { greedyWalk, type Slot, type SlotGenerationStrategy } from "./slots.ts";
import { instantToZoned, zonedToInstant } from "../time/zone.ts";
import { END_OF_DAY, MIDNIGHT } from "../time/local-time.ts";
import { partsOfDayOpen, type PartOfDay } from "./part-of-day.ts";

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
 * Why a day has no Slots, which is what the customer's day says before it is
 * opened (ADR 0026).
 *
 * - CLOSED: the calendar does not work that day, or works too little of it to
 *   hold the Service.
 * - DAY_OVER: its hours have already been and gone.
 * - TOO_SOON: open hours lie between now and the minimum notice. ADR 0012 asks
 *   for the Business's phone number here rather than a bare refusal.
 * - BEYOND_HORIZON: its open hours lie past the booking horizon, and open as
 *   the window moves.
 * - FULLY_BOOKED: the window holds open hours, and they are taken.
 */
export const EMPTY_REASONS = [
  "CLOSED",
  "FULLY_BOOKED",
  "TOO_SOON",
  "BEYOND_HORIZON",
  "DAY_OVER",
] as const;

export type EmptyReason = (typeof EMPTY_REASONS)[number];

/**
 * The most days one availability request may cover (ADR 0026). A month is the
 * longest span the customer's screen draws at once; without a cap one request
 * could ask the database to resolve a year of schedule.
 */
export const MAX_AVAILABILITY_DAYS = 31;

export type DayAvailability = {
  readonly date: LocalDate;
  readonly slots: readonly Slot[];
  /** Null when slots were found. */
  readonly emptyReason: EmptyReason | null;
  /**
   * The parts of the day this calendar still works from the booking window's
   * near end, whatever is booked. Hours already over, or inside the minimum
   * notice, have nothing that could free up for this customer.
   */
  readonly openParts: readonly PartOfDay[];
  /**
   * Some of the day's open hours, long enough for the Service, lie past the
   * booking horizon: they open as the window moves. True on the window's last,
   * partly open day and on every day wholly beyond it.
   */
  readonly partlyBeyondHorizon: boolean;
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
  const open = openStretchesOf(request);
  const fits = holdsTheService(open, service.durationMinutes);
  const dayEnd = endOfDay(request);
  const openParts = partsOfDayOpen(
    open
      .map((stretch) => ({
        start: stretch.start > window.start ? stretch.start : window.start,
        end: stretch.end,
      }))
      .filter((stretch) => stretch.start < stretch.end)
      .map((stretch) => ({
        start: instantToZoned(stretch.start, business.timeZone).time,
        // A stretch running to midnight ends on the next date, at 00:00.
        end: stretch.end >= dayEnd ? END_OF_DAY : instantToZoned(stretch.end, business.timeZone).time,
      })),
  );
  const partlyBeyondHorizon = fits(window.end, dayEnd);
  if (slots.length > 0) {
    return { date, slots, emptyReason: null, openParts, partlyBeyondHorizon };
  }

  return {
    date,
    slots: [],
    emptyReason: emptyReasonFor(open, fits, window, now, dayEnd),
    openParts,
    partlyBeyondHorizon,
  };
};

/** The day's open hours as instants, before anything is booked or blocked. */
const openStretchesOf = (request: AvailabilityRequest): readonly Interval<Instant>[] =>
  freeIntervalsOn({
    date: request.date,
    timeZone: request.business.timeZone,
    workingHours: request.workingHours,
    overrides: request.overrides,
    blocks: [],
    occupied: [],
    bufferMinutes: 0,
    window: { start: startOfDay(request), end: endOfDay(request) },
  });

/**
 * Whether some open stretch, cut to [from, to), is still long enough for the
 * Service. A sliver shorter than the Service is not a time anyone could have,
 * so it never decides why a day is empty.
 */
const holdsTheService =
  (open: readonly Interval<Instant>[], durationMinutes: number) =>
  (from: Instant, to: Instant): boolean =>
    open.some(
      (stretch) =>
        minutesBetweenInstants(
          stretch.start > from ? stretch.start : from,
          stretch.end < to ? stretch.end : to,
        ) >= durationMinutes,
    );

/**
 * Judged by the open hours inside and around the window, in the order a
 * customer would ask: does the shop work then, could the window hold one, is it
 * the notice that is in the way, is it the horizon, or has the day been and
 * gone.
 */
const emptyReasonFor = (
  open: readonly Interval<Instant>[],
  fits: (from: Instant, to: Instant) => boolean,
  window: BookingWindow,
  now: Instant,
  dayEnd: Instant,
): EmptyReason => {
  if (open.length === 0) return "CLOSED";
  if (fits(window.start, window.end)) return "FULLY_BOOKED";
  if (fits(now, window.start)) return "TOO_SOON";
  if (fits(window.end, dayEnd)) return "BEYOND_HORIZON";
  if (open.some((stretch) => stretch.start < now)) return "DAY_OVER";
  return "CLOSED";
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
