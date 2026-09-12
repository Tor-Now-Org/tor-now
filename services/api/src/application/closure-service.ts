import {
  addDays,
  cancelAppointment,
  instantToZoned,
  interval,
  parseLocalDate,
  parseLocalTime,
  survivesHours,
  validationFailed,
  zonedToInstant,
  END_OF_DAY,
  MIDNIGHT,
  type Appointment,
  type Business,
  type BusinessId,
  type Clock,
  type LocalDate,
  type LocalInterval,
  type Resource,
} from "@tor-now/domain";
import { loadManagedBusiness } from "./authorization.ts";
import { notificationFor } from "./notifications.ts";
import { TEMPLATES } from "../ports/notifier.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { Actor, UnitOfWork } from "../ports/unit-of-work.ts";

/**
 * The shop's own days: closed for a holiday, or open on different hours.
 *
 * ADR 0002 keeps the schedule per calendar, and it stays that way — a closure
 * is written as one Override per calendar per date, which is what makes it
 * visible to availability, to booking and to the day screen with nothing
 * taught about a new layer. What this service adds is the *decision*: the shop
 * closes, not one chair, and the business is the unit the owner is thinking in.
 *
 * It is its own context rather than another method on the calendar service for
 * two reasons that both bit us. It is manager-and-up work — a worker may keep
 * their own calendar, but "the business is shut next week" is not theirs to
 * say — and the per-calendar route could only ever authorise per calendar, so
 * a worker looping over the calendars got half a closure and no error. And it
 * is the one schedule change that strands people: the appointments inside those
 * days have to be answered for, which the plain Override route never did.
 */

/** What the shop is doing on those days. No ranges is shut; some is shorter. */
export type ClosurePlan = {
  readonly fromDate: string;
  readonly toDate: string;
  /** Why, in the owner's words. Shown on the calendar and kept on every day. */
  readonly note: string | null;
  readonly ranges: readonly { start: string; end: string }[];
};

/** An appointment a plan would strand, said the way a screen has to say it. */
export type StrandedAppointment = {
  readonly id: Appointment["id"];
  readonly startAt: Appointment["startAt"];
  readonly resourceName: string;
  readonly serviceName: string;
  readonly customerName: string;
  readonly customerPhone: string;
};

export type ClosureImpact = {
  readonly days: number;
  readonly calendars: number;
  readonly appointments: readonly StrandedAppointment[];
};

export type ClosureOutcome = {
  readonly days: number;
  readonly calendars: number;
  readonly cancelled: number;
};

/** What a closure has to answer for: what is still standing, and still to come. */
const STILL_STANDING = "CONFIRMED";

const datesOf = (fromDate: string, toDate: string): LocalDate[] => {
  const first = parseLocalDate(fromDate);
  const last = parseLocalDate(toDate);
  if (last < first) {
    throw validationFailed("A closure cannot end before it starts");
  }
  const out: LocalDate[] = [];
  for (let date = first; date <= last; date = addDays(date, 1)) out.push(date);
  return out;
};

/** The hours the days would keep, as the domain's own intervals. */
const hoursOf = (ranges: readonly { start: string; end: string }[]): LocalInterval[] =>
  ranges.map((range) => {
    const start = parseLocalTime(range.start);
    const end = parseLocalTime(range.end);
    if (end <= start) {
      throw validationFailed("Opening hours must end after they start");
    }
    return interval(start, end);
  });

/** One Override per calendar per date: the shop's decision, in ADR 0002's terms. */
const writeOverrides = async (
  repositories: Repositories,
  businessId: BusinessId,
  calendars: readonly Resource[],
  dates: readonly LocalDate[],
  note: string | null,
  hours: readonly LocalInterval[],
): Promise<void> => {
  const ranges = hours.map((range) => ({
    startMinutes: range.start,
    endMinutes: range.end,
  }));
  for (const calendar of calendars) {
    for (const date of dates) {
      await repositories.dateOverrides.put({
        resourceId: calendar.id,
        businessId,
        date,
        note,
        ranges,
      });
    }
  }
};

const onOfferIn = async (
  repositories: Repositories,
  businessId: BusinessId,
): Promise<readonly Resource[]> =>
  (await repositories.resources.listForBusiness(businessId)).filter(
    (resource) => resource.active,
  );

export const closureService = ({
  unitOfWork,
  clock,
}: {
  unitOfWork: UnitOfWork;
  clock: Clock;
}) => {
  /**
   * Who is left holding an appointment if these hours become the day's hours.
   *
   * Shared by the preview and by the closure itself, so what the owner was
   * warned about and what is acted on cannot drift apart — the warning is the
   * same question, not a second opinion about it.
   */
  const strandedBy = async (
    repositories: Repositories,
    business: Business,
    dates: readonly LocalDate[],
    hours: readonly LocalInterval[],
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

    return booked.filter((appointment) => {
      if (appointment.status !== STILL_STANDING) return false;
      // A day that has already happened happened. Cancelling what is behind us
      // would rewrite the record and message people about it afterwards.
      if (appointment.startAt <= clock.now()) return false;
      const from = instantToZoned(appointment.startAt, business.timeZone);
      const to = instantToZoned(appointment.endAt, business.timeZone);
      if (!covered.has(from.date)) return false;
      return !survivesHours(interval(from.time, to.time), hours);
    });
  };

  return {
    /**
     * What closing would cost, before anything is written.
     *
     * The owner is told the number and the names, because "12 appointments"
     * and "12 appointments, one of them your Tuesday regular" are different
     * decisions — and because a screen that calls off a fortnight of bookings
     * without saying so is not one anybody should trust.
     */
    async preview(
      actor: Actor,
      businessId: BusinessId,
      plan: Pick<ClosurePlan, "fromDate" | "toDate" | "ranges">,
    ): Promise<ClosureImpact> {
      return unitOfWork.run(actor, async ({ repositories }) => {
        const business = await loadManagedBusiness(repositories, actor, businessId);
        const dates = datesOf(plan.fromDate, plan.toDate);
        const calendars = await onOfferIn(repositories, businessId);
        const stranded = await strandedBy(
          repositories,
          business,
          dates,
          hoursOf(plan.ranges),
        );

        const named = await Promise.all(
          stranded.map(async (appointment) => {
            const customer = await repositories.users.findById(appointment.customerId);
            return {
              id: appointment.id,
              startAt: appointment.startAt,
              resourceName: appointment.resourceName,
              serviceName: appointment.serviceName,
              customerName:
                customer === null
                  ? ""
                  : [customer.givenName, customer.familyName]
                      .filter((part) => part !== null && part !== "")
                      .join(" "),
              customerPhone: customer?.phone ?? "",
            };
          }),
        );

        return { days: dates.length, calendars: calendars.length, appointments: named };
      });
    },

    /**
     * The shop's days, written for every calendar at once.
     *
     * One transaction, because it was one decision: a holiday that took Monday
     * and Tuesday and then failed on Wednesday is a calendar nobody can trust,
     * and half a closure with half its customers told is worse than either.
     *
     * `upcoming` is the caller's answer to what happens to the people already
     * booked — the same choice, in the same words, that taking a calendar away
     * asks. Cancelling is not a default: both answers are wrong by default, so
     * the screen asks and this obeys.
     */
    async close(
      actor: Actor,
      businessId: BusinessId,
      plan: ClosurePlan,
      upcoming: "KEEP" | "CANCEL",
    ): Promise<ClosureOutcome> {
      return unitOfWork.run(actor, async (session) => {
        const { repositories } = session;
        const business = await loadManagedBusiness(repositories, actor, businessId);
        const dates = datesOf(plan.fromDate, plan.toDate);
        const hours = hoursOf(plan.ranges);
        const calendars = await onOfferIn(repositories, businessId);

        const stranded =
          upcoming === "CANCEL"
            ? await strandedBy(repositories, business, dates, hours)
            : [];

        // Answered for first, written second: a failure to tell somebody stops
        // the closure rather than leaving them uninvited to a shut shop.
        for (const appointment of stranded) {
          const outcome = cancelAppointment(appointment, business, "BUSINESS", clock.now());
          const cancelled = await repositories.appointments.update(appointment.id, {
            status: "CANCELLED",
            ...outcome,
          });
          const customer = await repositories.users.findById(appointment.customerId);
          if (customer !== null) {
            await session.outbox.enqueue(
              notificationFor(TEMPLATES.bookingCancelled, cancelled, business, customer),
            );
          }
        }

        await writeOverrides(repositories, businessId, calendars, dates, plan.note, hours);

        return {
          days: dates.length,
          calendars: calendars.length,
          cancelled: stranded.length,
        };
      });
    },

    /**
     * The shop's days given back: every Override across those dates, removed,
     * so each day returns to the week's own hours.
     *
     * Appointments called off are not restored, and are not quietly pretended
     * away either. Re-opening a day makes it bookable again; it does not undo
     * having told somebody not to come.
     */
    async lift(
      actor: Actor,
      businessId: BusinessId,
      fromDate: string,
      toDate: string,
    ): Promise<number> {
      return unitOfWork.run(actor, async ({ repositories }) => {
        await loadManagedBusiness(repositories, actor, businessId);
        const dates = datesOf(fromDate, toDate);
        const first = dates[0];
        const last = dates[dates.length - 1];
        /* istanbul ignore next -- datesOf never yields an empty range */
        if (first === undefined || last === undefined) return 0;

        // Every calendar, not only the ones still on offer: a withdrawn
        // calendar's Override would otherwise outlive the closure that made it.
        const calendars = await repositories.resources.listForBusiness(businessId);
        let removed = 0;
        for (const calendar of calendars) {
          const overrides = await repositories.dateOverrides.listForResource(
            calendar.id,
            first,
            last,
          );
          for (const override of overrides) {
            await repositories.dateOverrides.delete(override.id);
            removed += 1;
          }
        }
        return removed;
      });
    },
  };
};
