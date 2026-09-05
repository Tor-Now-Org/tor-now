import {
  compareByName,
  displayName,
  END_OF_DAY,
  MIDNIGHT,
  notFound,
  parseInstant,
  addDays,
  parseLocalDate,
  validationFailed,
  zonedToInstant,
  type Appointment,
  type Block,
  type BlockId,
  type BusinessId,
  type Clock,
  type Customer,
  type LocalDate,
  type ResourceId,
  type User,
} from "@tor-now/domain";
import { SEARCH } from "../config.ts";
import type { BookedAppointment } from "../ports/repositories.ts";
import type { Actor, UnitOfWork } from "../ports/unit-of-work.ts";

/**
 * How long the month containing this date is. Derived rather than tabulated, so
 * February is right in a leap year without the table knowing which years those
 * are.
 */
const daysInMonthOf = (date: LocalDate): number => {
  const [year, month] = date.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, month ?? 1, 0)).getUTCDate();
};
import { loadOwnedBusiness, loadOwnedResource } from "./authorization.ts";

/**
 * The owner's view of their own Business: the day's appointments, the Blocks
 * carved out of it, and the customers who have booked.
 *
 * ADR 0003 declines to keep this live. It is fetched on open and on refresh;
 * Supabase Realtime could deliver it and deliberately does not, because the
 * case it buys is a calendar left open unattended.
 */

export type CalendarDay = {
  readonly date: string;
  readonly appointments: readonly (Appointment & { customerName: string; customerPhone: string })[];
  readonly blocks: readonly Block[];
};

/** One square of the month grid. */
export type MonthDay = {
  readonly date: LocalDate;
  readonly appointments: number;
  readonly blocks: number;
};

/** Enough to answer a phone call without becoming a page of its own. */
const SEARCH_RESULTS = 25;

export const calendarService = ({
  unitOfWork,
  clock,
}: {
  unitOfWork: UnitOfWork;
  clock: Clock;
}) => ({
  /**
   * Finding one appointment when the owner knows who, not when.
   *
   * The calendar answers "what is happening on this day", which is the wrong
   * question when a customer rings up about something two months out: the owner
   * would have to guess the date or page forward until it appeared. This
   * answers "when is X coming in" instead, and hands back enough to open the
   * appointment straight from the result.
   *
   * Only what is still to come. An owner searching mid-call is changing
   * something, and there is nothing to change about a day that has gone.
   */
  async search(
    actor: Actor,
    businessId: BusinessId,
    query: string,
  ): Promise<readonly BookedAppointment[]> {
    const trimmed = query.trim();
    if (trimmed.length < SEARCH.minimumQueryLength) return [];
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      return repositories.appointments.searchUpcoming(
        businessId,
        trimmed,
        clock.now(),
        SEARCH_RESULTS,
      );
    });
  },

  /**
   * A month at a glance: how many appointments stand on each day, and whether
   * any of it is blocked out.
   *
   * Counts rather than appointments, because the grid draws numbers. Reading
   * the appointments to count them would fetch a month of rows and hydrate a
   * customer for each one — a page of work to draw a page of digits.
   *
   * The month is bounded in the Business's own zone, so the first and last
   * squares hold what the owner would call the first and last of the month
   * wherever the server happens to be.
   */
  async month(
    actor: Actor,
    businessId: BusinessId,
    resourceId: ResourceId,
    firstOfMonth: string,
  ): Promise<readonly MonthDay[]> {
    const first = parseLocalDate(firstOfMonth);
    return unitOfWork.run(actor, async ({ repositories }) => {
      const business = await loadOwnedBusiness(repositories, actor, businessId);
      await loadOwnedResource(repositories, businessId, resourceId);

      const start = zonedToInstant(first, MIDNIGHT, business.timeZone);
      const afterLast = zonedToInstant(
        addDays(first, daysInMonthOf(first)),
        MIDNIGHT,
        business.timeZone,
      );

      const [appointments, blocks] = await Promise.all([
        repositories.appointments.countsByLocalDay(
          resourceId,
          start,
          afterLast,
          business.timeZone,
        ),
        repositories.blocks.countsByLocalDay(
          resourceId,
          start,
          afterLast,
          business.timeZone,
        ),
      ]);

      const countFor = (counts: readonly { date: LocalDate; count: number }[], date: LocalDate) =>
        counts.find((entry) => entry.date === date)?.count ?? 0;

      // Every day of the month, including the empty ones: the grid draws them
      // all, and a gap in the answer would become a gap in the calendar.
      return Array.from({ length: daysInMonthOf(first) }, (_, offset) => {
        const date = addDays(first, offset);
        return {
          date,
          appointments: countFor(appointments, date),
          blocks: countFor(blocks, date),
        };
      });
    });
  },

  async day(
    actor: Actor,
    businessId: BusinessId,
    resourceId: ResourceId,
    date: string,
  ): Promise<CalendarDay> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      const business = await loadOwnedBusiness(repositories, actor, businessId);
      await loadOwnedResource(repositories, businessId, resourceId);

      const on = parseLocalDate(date);
      const from = zonedToInstant(on, MIDNIGHT, business.timeZone);
      const to = zonedToInstant(on, END_OF_DAY, business.timeZone);

      const [appointments, blocks] = await Promise.all([
        repositories.appointments.listForResourceBetween(resourceId, from, to),
        repositories.blocks.listForResourceBetween(resourceId, from, to),
      ]);

      // An owner needs the customer's name and number on the card; the join is
      // done here rather than in the repository so the appointment stays the
      // shape the domain defined.
      const customers = await loadCustomers(
        repositories,
        appointments.map((appointment) => appointment.customerId),
      );

      return {
        date: on,
        blocks,
        appointments: appointments.map((appointment) => {
          const customer = customers.get(appointment.customerId);
          return {
            ...appointment,
            customerName: customer === undefined ? "—" : displayName(customer),
            customerPhone: customer?.phone ?? "",
          };
        }),
      };
    });
  },

  /**
   * One blockage, which the owner may have described as several spans: days
   * away are a span each, and an hour kept free across a fortnight is fourteen.
   *
   * They are made together in one transaction because they were one decision —
   * a holiday blocked from Monday to Wednesday and then failing on Thursday is
   * a calendar nobody can trust — and each is a Block of its own afterwards, so
   * a single day of it can be given back without unpicking the rest.
   */
  async createBlocks(
    actor: Actor,
    businessId: BusinessId,
    resourceId: ResourceId,
    spans: readonly { startAt: string; endAt: string; reason: string }[],
  ): Promise<readonly Block[]> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      await loadOwnedResource(repositories, businessId, resourceId);

      // Read in full before any of it is written: the transaction would undo a
      // half-made blockage anyway, but a caller's mistake is better answered
      // than rolled back.
      const wanted = spans.map((span) => {
        const startAt = parseInstant(span.startAt);
        const endAt = parseInstant(span.endAt);
        if (endAt <= startAt) {
          throw validationFailed("A block must end after it starts");
        }
        return { resourceId, businessId, startAt, endAt, reason: span.reason };
      });

      const made: Block[] = [];
      for (const span of wanted) made.push(await repositories.blocks.create(span));
      return made;
    });
  },

  async deleteBlock(
    actor: Actor,
    businessId: BusinessId,
    blockId: BlockId,
  ): Promise<void> {
    await unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      await repositories.blocks.delete(blockId);
    });
  },

  /** The Business's customers: Users seen through a Membership with that role. */
  async customers(actor: Actor, businessId: BusinessId) {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      // Two sources for one question. Booking is what makes the relationship,
      // so anyone who has booked belongs here — including an owner who takes an
      // appointment in their own chair, who holds the OWNER role and would
      // otherwise be missing from their own list. The memberships stay in the
      // union so that a relationship recorded without a surviving appointment
      // is not quietly dropped.
      const memberships = await repositories.memberships.listForBusiness(
        businessId,
        "CUSTOMER",
      );
      const booked = await repositories.appointments.customerIdsFor(businessId);
      const asCustomer = new Map(
        memberships.map((membership) => [membership.userId, membership] as const),
      );
      const ids = [...new Set([...asCustomer.keys(), ...booked])];
      const users = await loadCustomers(repositories, ids);

      return ids
        .map((id) => ({
          user: users.get(id),
          // Null for someone who has booked but holds no customer membership
          // here — the owner. There is no standing to carry, and nothing to
          // block: you cannot bar yourself from your own chair.
          membership: asCustomer.get(id) ?? null,
        }))
        .filter(
          (customer): customer is Customer =>
            customer.user !== undefined && customer.user.deletedAt === null,
        )
        .sort((left, right) => compareByName(left.user, right.user));
    });
  },

  /**
   * Blocking is per-Business, like the Membership it is recorded on: the same
   * person may be blocked here and welcome elsewhere. Existing appointments
   * stand — a block stops the next booking, it does not cancel the last one.
   */
  async setCustomerBlocked(
    actor: Actor,
    businessId: BusinessId,
    customerId: User["id"],
    blocked: boolean,
  ) {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      const membership = await repositories.memberships.find(customerId, businessId);
      if (membership === null || membership.role !== "CUSTOMER") {
        throw notFound("Customer", customerId);
      }
      return repositories.memberships.setBlocked(
        customerId,
        businessId,
        blocked ? clock.now() : null,
      );
    });
  },

  /**
   * One customer's history with this Business, which is what a "customer
   * record" is — always relative to a Business, never in the abstract.
   */
  async customerRecord(
    actor: Actor,
    businessId: BusinessId,
    customerId: User["id"],
  ) {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      const membership = await repositories.memberships.find(customerId, businessId);
      if (membership === null) throw notFound("Customer", customerId);

      const [user, appointments] = await Promise.all([
        repositories.users.findById(customerId),
        repositories.appointments.listForCustomerAtBusiness(customerId, businessId),
      ]);
      if (user === null) throw notFound("Customer", customerId);

      return {
        user,
        blocked: membership.blockedAt !== null,
        // An owner reaching their own record through the customer list holds
        // the OWNER role, and setCustomerBlocked rightly refuses it. Say so
        // here rather than offering a control that can only fail.
        blockable: membership.role === "CUSTOMER",
        appointments,
        lateCancellations: appointments.filter(
          (appointment) => appointment.lateCancellation,
        ).length,
        noShows: appointments.filter((appointment) => appointment.status === "NO_SHOW")
          .length,
      };
    });
  },
});

const loadCustomers = async (
  repositories: Parameters<typeof loadOwnedBusiness>[0],
  ids: readonly User["id"][],
): Promise<Map<User["id"], User>> => {
  const unique = [...new Set(ids)];
  const users = await Promise.all(unique.map((id) => repositories.users.findById(id)));
  return users.reduce((found, user) => {
    if (user !== null) found.set(user.id, user);
    return found;
  }, new Map<User["id"], User>());
};
