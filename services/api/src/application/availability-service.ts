import {
  availableSlotsOn,
  datesBetween,
  END_OF_DAY,
  formatInstant,
  MIDNIGHT,
  notFound,
  todayIn,
  zonedToInstant,
  type BusinessId,
  type Clock,
  type DayAvailability,
  type LocalDate,
  type ResourceId,
  type ServiceId,
  type SlotGenerationStrategy,
  type TimeZone,
} from "@tor-now/domain";
import type { Repositories } from "../ports/repositories.ts";
import type { Actor, UnitOfWork } from "../ports/unit-of-work.ts";

/**
 * ADR 0003: availability is fetched on demand — when a Service or date is
 * chosen, when the customer returns from verification, and again at
 * confirmation. Nothing polls and nothing subscribes; correctness rests on the
 * exclusion constraint and on re-validation at confirmation.
 *
 * ADR 0007: only free start times cross the wire, so neither customer
 * identities nor a Business's booking volume are exposed by this endpoint.
 */

export type DaySlots = {
  readonly date: LocalDate;
  readonly slots: readonly { startAt: string; endAt: string }[];
  readonly emptyReason: DayAvailability["emptyReason"];
};

export type AvailabilityQuery = {
  readonly businessId: BusinessId;
  readonly serviceId: ServiceId;
  readonly resourceId: ResourceId;
  readonly from: LocalDate;
  readonly to: LocalDate;
};

/**
 * Loading a day at a time would issue one query per date. The schedule layers
 * are loaded once for the whole span and resolved per date in memory, which is
 * what makes a two-week calendar a constant number of round trips.
 */
export const availabilityService = (dependencies: {
  unitOfWork: UnitOfWork;
  clock: Clock;
  strategy?: SlotGenerationStrategy;
}) => ({
  async forRange(actor: Actor, query: AvailabilityQuery): Promise<readonly DaySlots[]> {
    return dependencies.unitOfWork.run(actor, async ({ repositories }) => {
      const context = await loadContext(repositories, query);
      const now = dependencies.clock.now();

      const dates = datesBetween(query.from, query.to);
      const spanStart = context.dayBounds(dates[0] ?? query.from).start;
      const spanEnd = context.dayBounds(dates[dates.length - 1] ?? query.to).end;

      // One group, not two: none of these four depends on another, and each
      // extra group is another round trip the customer waits through.
      const [blocks, occupied, workingHours, overrides] = await Promise.all([
        repositories.blocks.blockedBetween(query.resourceId, spanStart, spanEnd),
        repositories.appointments.occupiedBetween(query.resourceId, spanStart, spanEnd),
        repositories.workingHours.listForResource(query.resourceId),
        repositories.dateOverrides.listForResource(query.resourceId, query.from, query.to),
      ]);

      return dates.map((date) => {
        const availability = availableSlotsOn(
          {
            business: context.business,
            resource: context.resource,
            service: context.service,
            date,
            workingHours,
            overrides,
            blocks,
            occupied,
            now,
          },
          dependencies.strategy,
        );
        return {
          date,
          emptyReason: availability.emptyReason,
          slots: availability.slots.map((slot) => ({
            startAt: formatInstant(slot.startAt),
            endAt: formatInstant(slot.endAt),
          })),
        };
      });
    });
  },

  /** The first date, in the Business's own timezone, a calendar should open on. */
  today(zone: TimeZone): LocalDate {
    return todayIn(dependencies.clock.now(), zone);
  },
});

export const loadContext = async (
  repositories: Repositories,
  query: Pick<AvailabilityQuery, "businessId" | "serviceId" | "resourceId">,
) => {
  const [business, service, resource] = await Promise.all([
    repositories.businesses.findById(query.businessId),
    repositories.services.findById(query.serviceId),
    repositories.resources.findById(query.resourceId),
  ]);

  if (business === null) throw notFound("Business", query.businessId);
  if (service === null || service.businessId !== business.id) {
    throw notFound("Service", query.serviceId);
  }
  if (resource === null || resource.businessId !== business.id) {
    throw notFound("Resource", query.resourceId);
  }

  return {
    business,
    service,
    resource,
    dayBounds: (date: LocalDate) => dayBoundsIn(date, business.timeZone),
  };
};

/** Midnight to midnight in the Business's own zone, not the server's. */
const dayBoundsIn = (date: LocalDate, zone: TimeZone) => ({
  start: zonedToInstant(date, MIDNIGHT, zone),
  end: zonedToInstant(date, END_OF_DAY, zone),
});
