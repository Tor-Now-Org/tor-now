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

/**
 * How far past the minimum notice the first offered Slot is pushed.
 *
 * Without this the near end of the window lands on `now + notice` exactly, so
 * the first Slot offered is unbookable the instant it is drawn: the customer
 * reads it, decides, confirms, and by then `now` has moved and the same rule
 * refuses the booking. Rounding the offer up to the next boundary gives them
 * somewhere between a moment and five minutes to answer.
 *
 * The rule itself is untouched — `isWithinBookingWindow` still measures against
 * the true `now + notice`. It is the offer that is conservative, which is the
 * right way round: a Business asked for an hour's notice and gets at least it.
 */
export const OFFER_BOUNDARY_MINUTES = 5;

const MILLISECONDS_PER_MINUTE = 60_000;

/** The next boundary strictly after `at`, so the slack is never zero. */
const roundUpToBoundary = (at: Instant): Instant => {
  const step = OFFER_BOUNDARY_MINUTES * MILLISECONDS_PER_MINUTE;
  return (Math.floor(at / step) * step + step) as Instant;
};

/**
 * The window availability offers from. Its near end is rounded up; its far end
 * is the horizon exactly, since nothing is lost by trimming a moment there.
 */
export const bookingWindowFor = (
  business: Pick<Business, "minimumNoticeMinutes" | "bookingHorizonDays">,
  now: Instant,
): BookingWindow =>
  interval(
    roundUpToBoundary(addMinutesToInstant(now, business.minimumNoticeMinutes)),
    ((now + business.bookingHorizonDays * MILLISECONDS_PER_DAY) as Instant),
  );

/**
 * Whether a booking may actually be made. Measured against the true notice
 * rather than the rounded offer, so the Business always gets the notice it
 * asked for even though the first Slot was offered a little beyond it.
 */
export const isWithinBookingWindow = (
  window: BookingWindow,
  start: Instant,
  end: Instant,
  now?: Instant,
  minimumNoticeMinutes?: number,
): boolean => {
  const nearEnd =
    now === undefined || minimumNoticeMinutes === undefined
      ? window.start
      : addMinutesToInstant(now, minimumNoticeMinutes);
  return start >= nearEnd && end <= window.end;
};

/**
 * Whether the near end of the window is what emptied a day. ADR 0012 asks for
 * the Business's phone number in that case, rather than a bare "nothing
 * available" — the customer is told how to ask, not merely told no.
 */
export const isTrimmedByNotice = (
  window: BookingWindow,
  dayEnd: Instant,
): boolean => dayEnd <= window.start;
