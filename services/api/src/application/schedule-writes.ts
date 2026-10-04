import {
  absorbBlockages,
  cancelAppointment,
  instantToZoned,
  interval,
  survivesHours,
  zonedToInstant,
  END_OF_DAY,
  MIDNIGHT,
  type Appointment,
  type Block,
  type Business,
  type BusinessId,
  type Instant,
  type LocalDate,
  type LocalInterval,
  type ResourceId,
} from "@tor-now/domain";
import { notificationFor } from "./notifications.ts";
import { stillToCome } from "./stranded.ts";
import { TEMPLATES } from "../ports/notifier.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { Session } from "../ports/unit-of-work.ts";

/**
 * The writes every change to a day comes down to, shared by the closure, the
 * blockage and "שינוי ביומן" paths so that one change said three ways is written
 * one way. Each takes the session it runs in rather than opening its own, which
 * is what lets an edit remove the old change and write the new one in a single
 * transaction.
 */

/** Nothing is booked for longer than this, which is what makes the reach below enough. */
const A_DAY = 24 * 60 * 60 * 1000;

export type BlockSpan = {
  readonly resourceId: ResourceId;
  readonly startAt: Instant;
  readonly endAt: Instant;
};

/**
 * What is booked underneath some blockages.
 *
 * Overlap rather than containment: a blockage from two o'clock catches the
 * appointment that started at half past one and runs into it, which is exactly
 * the one somebody would otherwise turn up for.
 */
export const bookedInside = async (
  repositories: Repositories,
  businessId: BusinessId,
  spans: readonly BlockSpan[],
  now: number,
): Promise<readonly Appointment[]> => {
  if (spans.length === 0) return [];
  const from = Math.min(...spans.map((span) => span.startAt));
  const to = Math.max(...spans.map((span) => span.endAt));
  const booked = await repositories.appointments.listForBusinessBetween(
    businessId,
    // The query selects on when an appointment *starts*, so it reaches back a
    // day: the one that began at half past one and runs into a two o'clock
    // blockage is the very one somebody would otherwise turn up for.
    (from - A_DAY) as never,
    to as never,
  );
  return booked.filter(
    (appointment) =>
      stillToCome(appointment, now) &&
      spans.some(
        (span) =>
          appointment.resourceId === span.resourceId &&
          appointment.startAt < span.endAt &&
          span.startAt < appointment.endAt,
      ),
  );
};

/**
 * Who is left holding an appointment if these hours become these days' hours,
 * on these calendars.
 */
export const strandedByHours = async (
  repositories: Repositories,
  business: Business,
  calendars: readonly ResourceId[],
  dates: readonly LocalDate[],
  hours: readonly LocalInterval[],
  now: number,
): Promise<readonly Appointment[]> => {
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first === undefined || last === undefined) return [];

  const booked = await repositories.appointments.listForBusinessBetween(
    business.id,
    zonedToInstant(first, MIDNIGHT, business.timeZone),
    // The window ends at the end of the last day rather than at its start,
    // or a closure's final evening would be answered for by nobody.
    zonedToInstant(last, END_OF_DAY, business.timeZone),
  );

  const covered = new Set<string>(dates);
  const on = new Set<string>(calendars);

  return booked.filter((appointment) => {
    // A day that has already happened happened. Cancelling what is behind us
    // would rewrite the record and message people about it afterwards.
    if (!stillToCome(appointment, now)) return false;
    if (!on.has(appointment.resourceId)) return false;
    const from = instantToZoned(appointment.startAt, business.timeZone);
    const to = instantToZoned(appointment.endAt, business.timeZone);
    if (!covered.has(from.date)) return false;
    return !survivesHours(interval(from.time, to.time), hours);
  });
};

/**
 * Calling off the people a change strands, and telling each of them.
 *
 * Answered for before the change is written: a failure to tell somebody stops
 * the change rather than leaving them uninvited to a shut door.
 */
export const cancelAndTell = async (
  session: Session,
  business: Business,
  stranded: readonly Appointment[],
  now: Instant,
): Promise<void> => {
  for (const appointment of stranded) {
    const outcome = cancelAppointment(appointment, business, "BUSINESS", now);
    const cancelled = await session.repositories.appointments.update(appointment.id, {
      status: "CANCELLED",
      ...outcome,
    });
    const customer = await session.repositories.users.findById(appointment.customerId);
    if (customer !== null) {
      await session.outbox.enqueue(
        notificationFor(TEMPLATES.bookingCancelled, cancelled, business, customer),
      );
    }
  }
};

/**
 * Blockages on one calendar, as one decision.
 *
 * A new blockage absorbs the ones it meets rather than lying on top of them:
 * two blockages over the same hour is one hour kept free said twice, and
 * removing either gives back nothing. What it is called is what this decision
 * said, or — when it said nothing — what the blockage it swallowed was called.
 */
export const writeBlocks = async (
  repositories: Repositories,
  businessId: BusinessId,
  resourceId: ResourceId,
  wanted: readonly { startAt: Instant; endAt: Instant }[],
  said: string,
  groupId: string,
): Promise<readonly Block[]> => {
  if (wanted.length === 0) return [];
  const nearby = await repositories.blocks.listForResourceBetween(
    resourceId,
    (Math.min(...wanted.map((span) => span.startAt)) - A_DAY) as Instant,
    (Math.max(...wanted.map((span) => span.endAt)) + A_DAY) as Instant,
  );
  const { removed, spans: kept } = absorbBlockages(
    nearby,
    wanted.map((span) => interval(span.startAt, span.endAt)),
  );
  for (const block of removed) await repositories.blocks.delete(block.id);

  const reason =
    (said.trim() !== "" ? said.trim() : undefined) ??
    removed.find((block) => block.reason.trim() !== "")?.reason.trim() ??
    "";

  const made: Block[] = [];
  for (const span of kept) {
    made.push(
      await repositories.blocks.create({
        resourceId,
        businessId,
        startAt: span.start,
        endAt: span.end,
        reason,
        groupId,
      }),
    );
  }
  return made;
};

/** One Override per calendar per date: a day's hours, in ADR 0002's terms. */
export const writeOverrides = async (
  repositories: Repositories,
  businessId: BusinessId,
  calendars: readonly ResourceId[],
  dates: readonly LocalDate[],
  note: string | null,
  hours: readonly LocalInterval[],
): Promise<void> => {
  const ranges = hours.map((range) => ({ startMinutes: range.start, endMinutes: range.end }));
  // One write for the decision. A fortnight across four chairs is still one
  // Override per calendar per date — ADR 0002 leaves no other way to say it —
  // but they are written together rather than one round trip at a time.
  await repositories.dateOverrides.putMany(
    calendars.flatMap((resourceId) =>
      dates.map((date) => ({ resourceId, businessId, date, note, ranges })),
    ),
  );
};
