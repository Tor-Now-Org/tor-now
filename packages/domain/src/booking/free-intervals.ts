import type { Business } from "../model/business.ts";
import type { OccupiedSpan } from "../model/appointment.ts";
import { occupiedInterval } from "../model/appointment.ts";
import type { BlockedSpan, DateOverride, WorkingHours } from "../model/schedule.ts";
import { openIntervalsOn } from "../schedule/open-hours.ts";
import type { Instant } from "../time/instant.ts";
import { addMinutesToInstant } from "../time/instant.ts";
import {
  clipAll,
  interval,
  normalize,
  subtractAll,
  type Interval,
} from "../time/interval.ts";
import type { LocalDate } from "../time/local-date.ts";
import { zonedToInstant, type TimeZone } from "../time/zone.ts";
import type { BookingWindow } from "./booking-window.ts";

/**
 * A stretch of time in which a Resource is open and unencumbered — the single
 * shape in which every scheduling constraint has been resolved, and the only
 * input slot generation ever sees (CONTEXT.md: "Free Interval").
 *
 * The invariant that makes this useful: within a Free Interval, a service of
 * duration `d` may start anywhere `[start, end - d]` and the booking will be
 * accepted. Buffer collisions are already accounted for, so a caller never has
 * to reason about them.
 */
export type FreeInterval = Interval<Instant>;

export type ScheduleInputs = {
  readonly date: LocalDate;
  readonly timeZone: TimeZone;
  readonly workingHours: readonly WorkingHours[];
  readonly overrides: readonly DateOverride[];
  readonly blocks: readonly BlockedSpan[];
  /** Already filtered to the Appointments that actually occupy time. */
  readonly occupied: readonly OccupiedSpan[];
  /** The Buffer of the Service being booked, resolved against the Business. */
  readonly bufferMinutes: number;
  readonly window: BookingWindow;
};

/** The date's open Local Time ranges, lifted onto the absolute timeline. */
const openInstantsOn = (
  date: LocalDate,
  timeZone: TimeZone,
  workingHours: readonly WorkingHours[],
  overrides: readonly DateOverride[],
): Interval<Instant>[] =>
  openIntervalsOn(date, workingHours, overrides).map((range) =>
    // A range ending at 24:00 resolves to the midnight that starts the next
    // date, which is exactly the instant meant by "the end of this day".
    interval(
      zonedToInstant(date, range.start, timeZone),
      zonedToInstant(date, range.end, timeZone),
    ),
  );

/**
 * An existing Appointment denies more than the time it occupies: a new
 * Appointment ending flush against it would have its own Buffer overlap it,
 * and ADR 0003's exclusion constraint would refuse the insert.
 *
 * Widening the subtracted range backwards by the incoming Buffer is what keeps
 * the Free Interval's promise — that anything fitting inside it is bookable —
 * without slot generation or the caller knowing why. Closing time needs no such
 * widening: nothing is there to collide with, so a Buffer may run past it.
 */
const deniedBy = (
  span: OccupiedSpan,
  bufferMinutes: number,
): Interval<Instant> => {
  const occupied = occupiedInterval(span);
  return interval(
    addMinutesToInstant(occupied.start, -bufferMinutes),
    occupied.end,
  );
};

/**
 * Resolves the three schedule layers of ADR 0002 and the booking window of
 * ADR 0012 into Free Intervals, in that order: the date's Overrides else the
 * weekday's Working Hours, minus Blocks, minus occupied Appointments, clipped
 * to the window.
 */
export const freeIntervalsOn = (inputs: ScheduleInputs): FreeInterval[] => {
  const open = openInstantsOn(
    inputs.date,
    inputs.timeZone,
    inputs.workingHours,
    inputs.overrides,
  );

  const blocked = inputs.blocks.map((block) =>
    interval(block.startAt, block.endAt),
  );

  const taken = inputs.occupied.map((span) =>
    deniedBy(span, inputs.bufferMinutes),
  );

  const unencumbered = subtractAll(normalize(open), [...blocked, ...taken]);

  return normalize(clipAll(unencumbered, inputs.window));
};

/** The Buffer that applies to a Service being booked at a Business. */
export const bufferForBooking = (
  serviceBufferMinutes: number | null,
  business: Pick<Business, "defaultBufferMinutes">,
): number => serviceBufferMinutes ?? business.defaultBufferMinutes;
