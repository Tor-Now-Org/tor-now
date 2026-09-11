import {
  compareByName,
  dayOfWeekOf,
  displayName,
  END_OF_DAY,
  instantToZoned,
  MIDNIGHT,
  minutesBetweenInstants,
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
  type LocalTimeRangeValue,
  type ResourceId,
  type User,
} from "@tor-now/domain";
import { SEARCH } from "../config.ts";

/**
 * What counts as a day taken rather than an hour of one. A blockage made "all
 * day" runs midnight to a minute before the next, so anything at least this
 * long is the whole day as far as a month grid is concerned.
 */
const WHOLE_DAY_MINUTES = 20 * 60;

/** The month as the grid draws it: every calendar, and the decisions spanning days. */
export type BusinessMonth = {
  readonly days: readonly {
    readonly date: LocalDate;
    readonly byCalendar: readonly {
      readonly resourceId: ResourceId;
      readonly appointments: number;
      readonly away: boolean;
    }[];
    readonly shopClosed: boolean;
    readonly shopHours: readonly LocalTimeRangeValue[];
  }[];
  readonly blockages: readonly {
    readonly groupId: string;
    readonly resourceId: ResourceId;
    readonly reason: string;
    readonly fromDate: LocalDate;
    readonly toDate: LocalDate;
    readonly days: number;
    readonly allDay: boolean;
  }[];
};
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
import { loadOwnedBusiness, loadOwnedResource, requireResourceAccess } from "./authorization.ts";

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

/** One day, every calendar: what is booked, what is blocked, and when it is open. */
export type BusinessDay = {
  readonly date: string;
  readonly calendars: readonly {
    readonly resourceId: ResourceId;
    readonly resourceName: string;
    readonly open: readonly LocalTimeRangeValue[];
    readonly special: boolean;
    readonly appointments: readonly (Appointment & {
      customerName: string;
      customerPhone: string;
    })[];
    readonly blocks: readonly Block[];
  }[];
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
      await requireResourceAccess(repositories, actor, businessId, resourceId);
      await loadOwnedResource(repositories, businessId, resourceId);
      const business = await repositories.businesses.findById(businessId);
      if (business === null) throw notFound("Business", businessId);

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

  /**
   * The month as the grid draws it: every calendar at once.
   *
   * One read rather than one per calendar, because the screen shows the whole
   * business and a month of three calendars would otherwise be three round
   * trips and three chances to disagree with itself.
   *
   * A day is the shop's own when every calendar says the same thing about it —
   * all closed, or all keeping the same hours. There is no business-level
   * closure in the store (ADR 0002 has layers per calendar), so "the shop is
   * shut" is read rather than recorded: it is what it means for nobody to be
   * open.
   */
  async businessMonth(
    actor: Actor,
    businessId: BusinessId,
    firstOfMonth: string,
  ): Promise<BusinessMonth> {
    const first = parseLocalDate(firstOfMonth);
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      const business = await repositories.businesses.findById(businessId);
      if (business === null) throw notFound("Business", businessId);

      const resources = await repositories.resources.listForBusiness(businessId);
      const onOffer = resources.filter((resource) => resource.active);
      const days = daysInMonthOf(first);
      const last = addDays(first, days - 1);
      const start = zonedToInstant(first, MIDNIGHT, business.timeZone);
      const afterLast = zonedToInstant(addDays(first, days), MIDNIGHT, business.timeZone);

      const perResource = await Promise.all(
        onOffer.map(async (resource) => ({
          resource,
          appointments: await repositories.appointments.countsByLocalDay(
            resource.id, start, afterLast, business.timeZone,
          ),
          overrides: await repositories.dateOverrides.listForResource(resource.id, first, last),
          blocks: await repositories.blocks.listForResourceBetween(resource.id, start, afterLast),
        })),
      );

      const countOn = (
        counts: readonly { date: LocalDate; count: number }[],
        date: LocalDate,
      ) => counts.find((entry) => entry.date === date)?.count ?? 0;

      const dayRows = Array.from({ length: days }, (_unused, offset) => {
        const date = addDays(first, offset);
        const byCalendar = perResource.map((entry) => ({
          resourceId: entry.resource.id,
          appointments: countOn(entry.appointments, date),
          away: entry.blocks.some(
            (block) =>
              instantToZoned(block.startAt, business.timeZone).date === date &&
              minutesBetweenInstants(block.startAt, block.endAt) >= WHOLE_DAY_MINUTES,
          ),
        }));

        // What the shop does that day, when every calendar agrees.
        const spoken = perResource.map((entry) =>
          entry.overrides.find((override) => override.date === date) ?? null,
        );
        const everyoneSaid = spoken.length > 0 && spoken.every((one) => one !== null);
        const shut = everyoneSaid && spoken.every((one) => (one?.ranges.length ?? 0) === 0);
        const sameHours =
          everyoneSaid && !shut
            ? JSON.stringify(spoken[0]?.ranges ?? []) ===
              JSON.stringify(spoken.at(-1)?.ranges ?? [])
            : false;

        return {
          date,
          byCalendar,
          shopClosed: shut,
          shopHours: sameHours ? (spoken[0]?.ranges ?? []) : [],
        };
      });

      // Blocks that belong to one decision are answered as one thing, so the
      // grid can draw a band instead of a stripe of marks.
      const grouped = new Map<string, Block[]>();
      perResource.forEach((entry) =>
        entry.blocks.forEach((block) => {
          const key = block.groupId ?? block.id;
          grouped.set(key, [...(grouped.get(key) ?? []), block]);
        }),
      );
      const blockages = [...grouped.entries()].map(([key, blocks]) => {
        const ordered = [...blocks].sort((left, right) => left.startAt - right.startAt);
        const firstBlock = ordered[0];
        const lastBlock = ordered[ordered.length - 1];
        return {
          groupId: key,
          resourceId: firstBlock?.resourceId ?? ("" as ResourceId),
          reason: firstBlock?.reason ?? "",
          fromDate: instantToZoned(firstBlock?.startAt ?? start, business.timeZone).date,
          toDate: instantToZoned(lastBlock?.startAt ?? start, business.timeZone).date,
          days: ordered.length,
          allDay: ordered.every(
            (block) =>
              minutesBetweenInstants(block.startAt, block.endAt) >= WHOLE_DAY_MINUTES,
          ),
        };
      });

      return { days: dayRows, blockages };
    });
  },

  /**
   * One day, every calendar, and the hours each of them keeps.
   *
   * The day screen draws lanes side by side and shades what is outside the
   * working hours, so it needs all three layers at once: what is booked, what
   * is blocked, and when the calendar is open at all. One read, for the same
   * reason the month is one read.
   */
  async businessDay(
    actor: Actor,
    businessId: BusinessId,
    date: string,
  ): Promise<BusinessDay> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      const business = await repositories.businesses.findById(businessId);
      if (business === null) throw notFound("Business", businessId);

      const on = parseLocalDate(date);
      const from = zonedToInstant(on, MIDNIGHT, business.timeZone);
      const to = zonedToInstant(on, END_OF_DAY, business.timeZone);
      const weekday = dayOfWeekOf(on);

      const resources = await repositories.resources.listForBusiness(businessId);
      const onOffer = resources.filter((resource) => resource.active);

      const calendars = await Promise.all(
        onOffer.map(async (resource) => {
          const [appointments, blocks, hours, overrides] = await Promise.all([
            repositories.appointments.listForResourceBetween(resource.id, from, to),
            repositories.blocks.listForResourceBetween(resource.id, from, to),
            repositories.workingHours.listForResource(resource.id),
            repositories.dateOverrides.listForResource(resource.id, on, on),
          ]);
          const customers = await loadCustomers(
            repositories,
            appointments.map((appointment) => appointment.customerId),
          );
          // The override replaces the weekday entirely (ADR 0002); its absence
          // is what makes the week's own hours the answer.
          const override = overrides.find((entry) => entry.date === on) ?? null;
          const open =
            override !== null
              ? override.ranges
              : hours
                  .filter((entry) => entry.dayOfWeek === weekday)
                  .map((entry) => ({ start: entry.start, end: entry.end }));

          return {
            resourceId: resource.id,
            resourceName: resource.name,
            open,
            special: override !== null,
            appointments: appointments.map((appointment) => {
              const customer = customers.get(appointment.customerId);
              return {
                ...appointment,
                customerName: customer === undefined ? "—" : displayName(customer),
                customerPhone: customer?.phone ?? "",
              };
            }),
            blocks,
          };
        }),
      );

      return { date: on, calendars };
    });
  },

  async day(
    actor: Actor,
    businessId: BusinessId,
    resourceId: ResourceId,
    date: string,
  ): Promise<CalendarDay> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await requireResourceAccess(repositories, actor, businessId, resourceId);
      await loadOwnedResource(repositories, businessId, resourceId);
      const business = await repositories.businesses.findById(businessId);
      if (business === null) throw notFound("Business", businessId);

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

      // One decision, one group — including a blockage of a single day, so
      // "what did this tap create" always has a truthful answer.
      const groupId = crypto.randomUUID();
      const made: Block[] = [];
      for (const span of wanted) {
        made.push(await repositories.blocks.create({ ...span, groupId }));
      }
      return made;
    });
  },

  /**
   * A whole blockage, given back the way it was taken.
   *
   * Removing a holiday row by row is how half a holiday ends up still blocking
   * a diary; the group is what makes "all three days" a single decision again.
   * Returns how many it took, so the screen can say so.
   */
  async deleteBlockGroup(
    actor: Actor,
    businessId: BusinessId,
    groupId: string,
  ): Promise<number> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      return repositories.blocks.deleteGroup(businessId, groupId);
    });
  },

  /** What a blockage covers, for a screen about to describe or undo it. */
  async blockGroup(
    actor: Actor,
    businessId: BusinessId,
    groupId: string,
  ): Promise<readonly Block[]> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      return repositories.blocks.listGroup(businessId, groupId);
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
