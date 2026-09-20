import {
  absorbBlockages,
  cancelAppointment,
  compareByName,
  dayOfWeekOf,
  manages,
  displayName,
  END_OF_DAY,
  instantToZoned,
  interval,
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
      /** Whether this calendar works that day at all, by its own week. */
      readonly works: boolean;
      readonly appointments: number;
      readonly away: boolean;
    }[];
    /**
     * Whether anybody works that day at all.
     *
     * A Saturday the business never opens on and a Saturday it decided to
     * close are the same to a customer and nothing like the same to an owner —
     * one is the shape of the week, the other is a decision somebody made and
     * can unmake.
     */
    readonly shopOpen: boolean;
    readonly shopClosed: boolean;
    readonly shopHours: readonly LocalTimeRangeValue[];
    /** Why the shop is doing that, when every calendar was given one reason. */
    readonly shopNote: string | null;
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
  /** Runs of shut days, so a week away is drawn as a week away. */
  readonly closures: readonly ClosureBand[];
};
import { closureBandsOf, type ClosureBand } from "./closure-bands.ts";
import { notificationFor } from "./notifications.ts";
import { namedFor, stillToCome, type Impact, type Upcoming } from "./stranded.ts";
import { TEMPLATES } from "../ports/notifier.ts";
import type { BookedAppointment } from "../ports/repositories.ts";
import type { Actor, UnitOfWork } from "../ports/unit-of-work.ts";
import { markSpanForRecheck } from "./waiting-service.ts";

/**
 * How long the month containing this date is. Derived rather than tabulated, so
 * February is right in a leap year without the table knowing which years those
 * are.
 */
const daysInMonthOf = (date: LocalDate): number => {
  const [year, month] = date.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, month ?? 1, 0)).getUTCDate();
};
import {
  loadManagedBusiness,
  loadOwnedResource,
  loadAccessibleBusiness,
  loadStaffedBusiness,
  requireResourceAccess,
  requireStaff,
} from "./authorization.ts";

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

/**
 * The calendars this caller may read, which for a worker is the ones they were
 * put on. The month and the day both show "the business", and for somebody who
 * staffs two chairs out of four that phrase means two.
 */
const readableCalendars = async (
  repositories: Parameters<typeof loadManagedBusiness>[0],
  actor: Actor,
  businessId: BusinessId,
) => {
  // The Business comes back with them: authorizing had to read it, and both
  // screens below need its time zone — so it travels rather than being read a
  // second time.
  const { membership, business } = await loadStaffedBusiness(
    repositories,
    actor,
    businessId,
  );
  const resources = await repositories.resources.listForBusiness(businessId);
  const active = resources.filter((resource) => resource.active);
  if (membership === null || manages(membership)) return { calendars: active, business };

  const assignments = await repositories.membershipResources.listForMembership(membership.id);
  const mine = new Set(assignments.map((assignment) => assignment.resourceId));
  return {
    calendars: active.filter((resource) => mine.has(resource.id)),
    business,
  };
};

/**
 * Rows read for many calendars at once, back into one list per calendar.
 *
 * Seeded from the calendars that were *asked* about rather than from the rows
 * that came back, because a calendar with nothing on it has no rows — and built
 * the other way round it would vanish from the screen instead of showing as an
 * empty day. Order within each list is the order the read returned, which is
 * the order the single-calendar reads used to give.
 */
const byResource = <T extends { readonly resourceId: ResourceId }>(
  resourceIds: readonly ResourceId[],
  rows: readonly T[],
): Map<ResourceId, T[]> => {
  const grouped = new Map<ResourceId, T[]>(resourceIds.map((id) => [id, []]));
  for (const row of rows) grouped.get(row.resourceId)?.push(row);
  return grouped;
};

/** One day, every calendar: what is booked, what is blocked, and when it is open. */
export type BusinessDay = {
  readonly date: string;
  readonly calendars: readonly {
    readonly resourceId: ResourceId;
    readonly resourceName: string;
    readonly open: readonly LocalTimeRangeValue[];
    readonly special: boolean;
    /** Why the day is special, when the owner said. */
    readonly note: string | null;
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

/** Nothing is booked for longer than this, which is what makes the reach below enough. */
const A_DAY = 24 * 60 * 60 * 1000;

/** The spans a blockage was asked for, checked before any of them is written. */
const spansOf = (
  spans: readonly { startAt: string; endAt: string; reason: string }[],
  resourceId: ResourceId,
  businessId: BusinessId,
) =>
  spans.map((span) => {
    const startAt = parseInstant(span.startAt);
    const endAt = parseInstant(span.endAt);
    if (endAt <= startAt) {
      throw validationFailed("A block must end after it starts");
    }
    return { resourceId, businessId, startAt, endAt, reason: span.reason };
  });

/**
 * What is booked underneath a blockage.
 *
 * Overlap rather than containment: a blockage from two o'clock catches the
 * appointment that started at half past one and runs into it, which is exactly
 * the one somebody would otherwise turn up for.
 */
const bookedInside = async (
  repositories: Parameters<typeof loadManagedBusiness>[0],
  businessId: BusinessId,
  spans: readonly { resourceId: ResourceId; startAt: number; endAt: number }[],
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
      await loadManagedBusiness(repositories, actor, businessId);
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
      const business = await loadAccessibleBusiness(
        repositories,
        actor,
        businessId,
        resourceId,
      );
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
      // Wider than "managed": a worker reads the month and the day for the
      // calendars they were put on, which is what the team feature promised
      // them. Owners and managers read all of them.
      const { calendars: onOffer, business } = await readableCalendars(
        repositories,
        actor,
        businessId,
      );

      const days = daysInMonthOf(first);
      const last = addDays(first, days - 1);
      const start = zonedToInstant(first, MIDNIGHT, business.timeZone);
      const afterLast = zonedToInstant(addDays(first, days), MIDNIGHT, business.timeZone);

      // Four reads for the month, not four per calendar — and these four used to
      // run one after another inside the loop, so a six-chair shop drawing one
      // grid waited through twenty-four sequential round trips.
      const ids = onOffer.map((resource) => resource.id);
      const [everyCount, everyOverride, everyBlock, everyWeek] = await Promise.all([
        repositories.appointments.countsByLocalDayForResources(
          ids, start, afterLast, business.timeZone,
        ),
        repositories.dateOverrides.listForResources(ids, first, last),
        repositories.blocks.listForResourcesBetween(ids, start, afterLast),
        // The week itself, so the grid can tell a day nobody works from a day
        // somebody decided to close. They look the same to a customer and are
        // not the same thing at all to an owner.
        repositories.workingHours.listForResources(ids),
      ]);

      const countsOf = byResource(ids, everyCount);
      const overridesOf = byResource(ids, everyOverride);
      const blocksOf = byResource(ids, everyBlock);
      const weekOf = byResource(ids, everyWeek);

      // The same shape, in the same order as the calendars: everything below
      // reads this array positionally — whether every calendar said the same
      // thing is the first one compared with the last.
      const perResource = onOffer.map((resource) => ({
        resource,
        appointments: countsOf.get(resource.id) ?? [],
        overrides: overridesOf.get(resource.id) ?? [],
        blocks: blocksOf.get(resource.id) ?? [],
        hours: weekOf.get(resource.id) ?? [],
      }));

      const countOn = (
        counts: readonly { date: LocalDate; count: number }[],
        date: LocalDate,
      ) => counts.find((entry) => entry.date === date)?.count ?? 0;

      const dayRows = Array.from({ length: days }, (_unused, offset) => {
        const date = addDays(first, offset);
        const weekday = dayOfWeekOf(date);
        // Whether this calendar works that day at all. An Override replaces the
        // weekday entirely (ADR 0002), so it answers where there is one and the
        // week answers where there is not.
        const worksOn = (entry: (typeof perResource)[number]) => {
          const override = entry.overrides.find((one) => one.date === date);
          return override !== undefined
            ? override.ranges.length > 0
            : entry.hours.some((one) => one.dayOfWeek === weekday);
        };

        const byCalendar = perResource.map((entry) => ({
          resourceId: entry.resource.id,
          works: worksOn(entry),
          appointments: countOn(entry.appointments, date),
          away: entry.blocks.some(
            (block) =>
              instantToZoned(block.startAt, business.timeZone).date === date &&
              minutesBetweenInstants(block.startAt, block.endAt) >= WHOLE_DAY_MINUTES,
          ),
        }));

        // Is anybody open at all?
        const openAtAll = perResource.some(worksOn);

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
        // One reason, or none: a note only belongs to the shop when the shop
        // was what was being described, which is every calendar saying it.
        const firstNote = spoken[0]?.note ?? null;
        const sameNote = everyoneSaid && spoken.every((one) => (one?.note ?? null) === firstNote);

        return {
          date,
          byCalendar,
          shopOpen: openAtAll,
          shopClosed: shut,
          shopHours: sameHours ? (spoken[0]?.ranges ?? []) : [],
          shopNote: sameNote ? firstNote : null,
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

      return { days: dayRows, blockages, closures: closureBandsOf(dayRows) };
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
      // Wider than "managed": a worker reads the month and the day for the
      // calendars they were put on, which is what the team feature promised
      // them. Owners and managers read all of them.
      const { calendars: onOffer, business } = await readableCalendars(
        repositories,
        actor,
        businessId,
      );

      const on = parseLocalDate(date);
      const from = zonedToInstant(on, MIDNIGHT, business.timeZone);
      const to = zonedToInstant(on, END_OF_DAY, business.timeZone);
      const weekday = dayOfWeekOf(on);

      // Four reads for the whole day, whatever the shop has chairs. Asking per
      // calendar cost four round trips each, and a transaction holds one
      // connection — so six chairs meant twenty-four trips in a row to draw one
      // screen.
      const ids = onOffer.map((resource) => resource.id);
      const [everyAppointment, everyBlock, everyWeek, everyOverride] = await Promise.all([
        repositories.appointments.listForResourcesBetween(ids, from, to),
        repositories.blocks.listForResourcesBetween(ids, from, to),
        repositories.workingHours.listForResources(ids),
        repositories.dateOverrides.listForResources(ids, on, on),
      ]);

      const appointmentsOf = byResource(ids, everyAppointment);
      const blocksOf = byResource(ids, everyBlock);
      const weekOf = byResource(ids, everyWeek);
      const overridesOf = byResource(ids, everyOverride);

      // The people once for the day, not once per calendar — and once for
      // anybody sitting in two of them.
      const customers = await loadCustomers(
        repositories,
        everyAppointment.map((appointment) => appointment.customerId),
      );

      const calendars = onOffer.map((resource) => {
        const appointments = appointmentsOf.get(resource.id) ?? [];
        const blocks = blocksOf.get(resource.id) ?? [];
        const hours = weekOf.get(resource.id) ?? [];
        const overrides = overridesOf.get(resource.id) ?? [];
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
          note: override?.note ?? null,
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
      });

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
      const business = await loadAccessibleBusiness(
        repositories,
        actor,
        businessId,
        resourceId,
      );
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
    upcoming: Upcoming = "KEEP",
  ): Promise<readonly Block[]> {
    return unitOfWork.run(actor, async (session) => {
      const { repositories } = session;
      // A worker may keep their own calendar: blocking their own Tuesday is
      // theirs to do, unlike closing the shop. The screen offers it to them,
      // and this is what makes that true rather than a button that 403s.
      await requireResourceAccess(repositories, actor, businessId, resourceId);
      const business = await repositories.businesses.findById(businessId);
      if (business === null) throw notFound("Business", businessId);
      await loadOwnedResource(repositories, businessId, resourceId);

      // Read in full before any of it is written: the transaction would undo a
      // half-made blockage anyway, but a caller's mistake is better answered
      // than rolled back.
      const wanted = spansOf(spans, resourceId, businessId);

      // The people already booked inside it. Same question the shop closing
      // asks, and answered the same way: the caller says, and this obeys.
      if (upcoming === "CANCEL") {
        const stranded = await bookedInside(repositories, businessId, wanted, clock.now());
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
      }

      // A new blockage absorbs the ones it meets rather than lying on top of
      // them. Two blockages over the same hour is one hour kept free said
      // twice, and removing either of them gives back nothing — which is how a
      // calendar stops being something anybody trusts.
      const reach = {
        from: Math.min(...wanted.map((span) => span.startAt)) - A_DAY,
        to: Math.max(...wanted.map((span) => span.endAt)) + A_DAY,
      };
      const nearby = await repositories.blocks.listForResourceBetween(
        resourceId,
        reach.from as never,
        reach.to as never,
      );
      const { removed, spans: kept } = absorbBlockages(
        nearby,
        wanted.map((span) => interval(span.startAt, span.endAt)),
      );
      for (const block of removed) await repositories.blocks.delete(block.id);

      // What it is called: what this decision said, or — when it said nothing —
      // whatever the blockage it swallowed was already called.
      const reason =
        wanted.find((span) => span.reason.trim() !== "")?.reason.trim() ??
        removed.find((block) => block.reason.trim() !== "")?.reason.trim() ??
        "";

      // One decision, one group — including a blockage of a single day, so
      // "what did this tap create" always has a truthful answer.
      const groupId = crypto.randomUUID();
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
    });
  },

  /**
   * Who is booked inside a blockage that has not been made yet.
   *
   * Blocking a fortnight is as capable of stranding somebody as closing the
   * shop is, and the screen used to make it silently — the blockage went in,
   * the appointments stayed on top of it, and nobody was told either way.
   */
  async blockPreview(
    actor: Actor,
    businessId: BusinessId,
    resourceId: ResourceId,
    spans: readonly { startAt: string; endAt: string; reason: string }[],
  ): Promise<Impact> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await requireResourceAccess(repositories, actor, businessId, resourceId);
      const business = await repositories.businesses.findById(businessId);
      if (business === null) throw notFound("Business", businessId);
      await loadOwnedResource(repositories, businessId, resourceId);

      const wanted = spansOf(spans, resourceId, businessId);
      const stranded = await bookedInside(repositories, businessId, wanted, clock.now());
      return {
        // How many days it covers, in the business's own zone — a blockage
        // from ten at night to two in the morning is two days to its owner.
        days: new Set(
          wanted.map((span) => instantToZoned(span.startAt, business.timeZone).date),
        ).size,
        calendars: 1,
        appointments: await namedFor(repositories, stranded),
      };
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
      const business = await loadManagedBusiness(repositories, actor, businessId);
      // Read before it goes: lifting a blockage frees every day it covered.
      const lifted = await repositories.blocks.listGroup(businessId, groupId);
      const removed = await repositories.blocks.deleteGroup(businessId, groupId);
      for (const block of lifted) {
        await markSpanForRecheck(repositories, block, business.timeZone);
      }
      return removed;
    });
  },

  /**
   * What a blockage is called, changed.
   *
   * The words are the only part of a blockage anybody can get wrong and want
   * back — the days and hours can be undone by removing it and saying it
   * again, but a typo in "מילואים" was permanent. The reason belongs to the
   * decision, so all of its days change together.
   *
   * Whoever may make one may rename one: a worker keeps their own calendar.
   */
  async renameBlockGroup(
    actor: Actor,
    businessId: BusinessId,
    groupId: string,
    reason: string,
  ): Promise<number> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      const [first] = await repositories.blocks.listGroup(businessId, groupId);
      if (first === undefined) throw notFound("Block", groupId);
      await requireResourceAccess(repositories, actor, businessId, first.resourceId);
      return repositories.blocks.renameGroup(businessId, groupId, reason.trim());
    });
  },

  /** What a blockage covers, for a screen about to describe or undo it. */
  async blockGroup(
    actor: Actor,
    businessId: BusinessId,
    groupId: string,
  ): Promise<readonly Block[]> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadManagedBusiness(repositories, actor, businessId);
      return repositories.blocks.listGroup(businessId, groupId);
    });
  },

  async deleteBlock(
    actor: Actor,
    businessId: BusinessId,
    blockId: BlockId,
  ): Promise<void> {
    await unitOfWork.run(actor, async ({ repositories }) => {
      const business = await loadManagedBusiness(repositories, actor, businessId);
      // Read before it goes: lifting a blockage frees the hours it covered,
      // and afterwards there is nothing left to say which ones those were.
      const lifted = await repositories.blocks.findById(blockId);
      await repositories.blocks.delete(blockId);
      if (lifted !== null) {
        await markSpanForRecheck(repositories, lifted, business.timeZone);
      }
    });
  },

  /**
   * Somebody the Business can book in, found by their number or created as one.
   *
   * A Business taking a booking over the telephone knows a number and a name,
   * and nothing else. If that number has signed in before, this is their
   * existing account and the only thing added is the relationship — never the
   * role, so a colleague who rings up for a haircut does not get demoted to
   * CUSTOMER by being booked one. If it has not, the User is created here
   * exactly as an invitation creates one: the row is real from this moment and
   * waiting when they first sign in.
   *
   * Staff rather than management, because a WORKER filling their own diary has
   * to be able to write down who the appointment is for.
   */
  async addCustomer(
    actor: Actor,
    businessId: BusinessId,
    input: { phone: string; givenName: string; familyName: string | null },
  ): Promise<Customer> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await requireStaff(repositories, actor, businessId);

      const existing = await repositories.users.findByPhone(input.phone);
      if (existing?.deletedAt != null) {
        throw validationFailed("That number belongs to a closed account");
      }

      // One call, whether or not the number is known: finding the User,
      // creating one, and adding the relationship are a single step in the
      // database, because a not-yet-registered person cannot be inserted
      // through app_user's RLS from here (ADR 0016).
      return repositories.memberships.addCustomer(businessId, input);
    });
  },

  /** The Business's customers: Users seen through a Membership with that role. */
  async customers(actor: Actor, businessId: BusinessId) {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadManagedBusiness(repositories, actor, businessId);
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
      await loadManagedBusiness(repositories, actor, businessId);
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
      await loadManagedBusiness(repositories, actor, businessId);
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

/**
 * One query, not one per person. A transaction holds a single connection, so
 * asking per id made a day's names cost a round trip each — and a business's
 * customer list cost one per customer it had ever had.
 */
const loadCustomers = async (
  repositories: Parameters<typeof loadManagedBusiness>[0],
  ids: readonly User["id"][],
): Promise<Map<User["id"], User>> => {
  const users = await repositories.users.findByIds([...new Set(ids)]);
  return users.reduce(
    (found, user) => found.set(user.id, user),
    new Map<User["id"], User>(),
  );
};
