import type { Business } from "../model/business.ts";
import { addMinutesToInstant, type Instant } from "../time/instant.ts";
import { interval, type Interval } from "../time/interval.ts";
import { MILLISECONDS_PER_DAY } from "../shared/constants.ts";

/**
 * ADR 0012: how far out a Business accepts bookings, at both ends. The window
 * is a final clip applied after the schedule layers have been resolved — slot
 * generation never learns about it.
 */
export type BookingWindow = Interval<Instant>;

export const bookingWindowFor = (
  business: Pick<Business, "minimumNoticeMinutes" | "bookingHorizonDays">,
  now: Instant,
): BookingWindow =>
  interval(
    addMinutesToInstant(now, business.minimumNoticeMinutes),
    ((now + business.bookingHorizonDays * MILLISECONDS_PER_DAY) as Instant),
  );

export const isWithinBookingWindow = (
  window: BookingWindow,
  start: Instant,
  end: Instant,
): boolean => start >= window.start && end <= window.end;

/**
 * Whether the near end of the window is what emptied a day. ADR 0012 asks for
 * the Business's phone number in that case, rather than a bare "nothing
 * available" — the customer is told how to ask, not merely told no.
 */
export const isTrimmedByNotice = (
  window: BookingWindow,
  dayEnd: Instant,
): boolean => dayEnd <= window.start;
