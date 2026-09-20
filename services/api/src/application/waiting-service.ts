import {
  formatInstant,
  forbidden,
  notFound,
  addDays,
  datesBetween,
  dayOfWeekOf,
  openingFor,
  parseInstant,
  parseLocalDate,
  timeZone,
  todayIn,
  validationFailed,
  wantedPartsOfDay,
  type BusinessId,
  type Clock,
  type Instant,
  type LocalDate,
  type ResourceId,
  type ServiceId,
  type SlotGenerationStrategy,
  type TimeZone,
  type WaitingEntryId,
} from "@tor-now/domain";
import { addMinutesToInstant } from "@tor-now/domain";
import { WAITING_LIST } from "../config.ts";
import { TEMPLATES } from "../ports/notifier.ts";
import type { Repositories, WaitingEntry } from "../ports/repositories.ts";
import { actorUserId, system, type Actor, type UnitOfWork } from "../ports/unit-of-work.ts";
import { availabilityFor } from "./availability-service.ts";

/**
 * ADR 0018. A Waiting Entry is a standing question — this customer, this
 * Service, on this date, in these parts of the day, on these calendars — and
 * it holds no time.
 *
 * Which means the interesting half of this service is not the joining but the
 * answering, and the answering deliberately knows nothing about scheduling: it
 * asks the ordinary availability code what the day is offering now, and then
 * asks the domain whether any of it is in a part somebody wanted. Minimum
 * Notice, the Booking Horizon, Buffers, Blocks and Date Overrides are all
 * obeyed here by inheritance rather than by being restated.
 */

export type WaitingWish = {
  readonly businessId: BusinessId;
  readonly serviceId: ServiceId;
  readonly resourceIds: readonly ResourceId[];
  readonly onDate: string;
  readonly parts: readonly string[];
};

/** A waiting entry as its own customer reads it, with the names filled in. */
export type MyWaiting = {
  readonly id: WaitingEntryId;
  readonly businessId: BusinessId;
  readonly businessName: string;
  readonly serviceId: ServiceId;
  readonly serviceName: string;
  readonly resourceNames: readonly string[];
  readonly onDate: LocalDate;
  readonly parts: readonly string[];
};

export type PublishReport = {
  readonly looked: number;
  readonly told: number;
};

/**
 * Leave a mark saying a calendar's day is worth looking at again.
 *
 * Called from inside whatever transaction changed the schedule, which is the
 * whole point: the mark and the change commit together, so a cancellation that
 * rolls back cannot leave a promise to tell people about it.
 *
 * Time frees in more ways than a cancellation — an Appointment moved away, a
 * Block lifted, a Date Override widened, a working day made longer — and every
 * one of them comes through here rather than each growing its own idea of who
 * to notify.
 */
export const markForRecheck = async (
  repositories: Repositories,
  resourceId: ResourceId,
  onDate: LocalDate,
): Promise<void> => {
  await repositories.waitingRechecks.mark(resourceId, onDate);
};

/**
 * The same, for something that happened at an instant rather than on a date —
 * an Appointment, which knows when it starts and not which local day that is.
 */
export const markInstantForRecheck = async (
  repositories: Repositories,
  resourceId: ResourceId,
  at: Instant,
  zone: TimeZone,
): Promise<void> => {
  await markForRecheck(repositories, resourceId, todayIn(at, zone));
};

/**
 * Every local day a stretch of time touches.
 *
 * A blockage can be a fortnight, and lifting one frees every day of it — so
 * marking only the day it starts on would leave thirteen days nobody looks at
 * again.
 */
export const markSpanForRecheck = async (
  repositories: Repositories,
  span: { resourceId: ResourceId; startAt: Instant; endAt: Instant },
  zone: TimeZone,
): Promise<void> => {
  const first = todayIn(span.startAt, zone);
  // The end is exclusive: a block ending at midnight belongs to the day before.
  const last = todayIn(addMinutesToInstant(span.endAt, -1), zone);
  for (const date of datesBetween(first, last < first ? first : last)) {
    await markForRecheck(repositories, span.resourceId, date);
  }
};

/**
 * Every date inside the Booking Horizon that falls on one weekday.
 *
 * A recurring rule is not a day, it is every occurrence of a day — so making
 * Tuesdays longer hands hours back on every Tuesday a customer can still book.
 * Bounded by the Horizon, because a date beyond it cannot be booked and so
 * cannot be waited for either.
 */
export const markWeekdayForRecheck = async (
  repositories: Repositories,
  resourceId: ResourceId,
  weekday: number,
  business: { timeZone: TimeZone; bookingHorizonDays: number },
  now: Instant,
): Promise<void> => {
  const from = todayIn(now, business.timeZone);
  const to = addDays(from, business.bookingHorizonDays);
  for (const date of datesBetween(from, to)) {
    if (dayOfWeekOf(date) !== weekday) continue;
    await markForRecheck(repositories, resourceId, date);
  }
};

const UTC = timeZone("UTC");
const A_DAY_IN_MINUTES = 24 * 60;

export const waitingService = (dependencies: {
  unitOfWork: UnitOfWork;
  clock: Clock;
  strategy: SlotGenerationStrategy;
}) => {
  const { unitOfWork, clock, strategy } = dependencies;

  return {
    /**
     * Put somebody down for a day, or rewrite what they asked for.
     *
     * Asking twice is the same ask, so this is an upsert rather than a
     * creation: a second tap is not an error, and changing one's mind about
     * which hours suit replaces the question instead of raising a second one.
     */
    async join(actor: Actor, wish: WaitingWish): Promise<WaitingEntry> {
      const customerId = actorUserId(actor);
      if (customerId === null) throw forbidden("Only a signed-in customer may wait");

      return unitOfWork.run(actor, async ({ repositories }) => {
        const business = await repositories.businesses.findById(wish.businessId);
        if (business === null) throw notFound("Business", wish.businessId);

        const service = await repositories.services.findById(wish.serviceId);
        if (service === null || service.businessId !== wish.businessId) {
          throw notFound("Service", wish.serviceId);
        }

        // Every named calendar has to belong to this Business. Without it an
        // entry could be answered by a mark from somewhere else entirely.
        const theirs = await repositories.resources.listForBusiness(wish.businessId);
        const named = [...new Set(wish.resourceIds)];
        if (named.length === 0) {
          throw validationFailed("Waiting for a time needs at least one calendar");
        }
        for (const resourceId of named) {
          if (!theirs.some((resource) => resource.id === resourceId)) {
            throw notFound("Resource", resourceId);
          }
        }

        const onDate = parseLocalDate(wish.onDate);
        if (onDate < todayIn(clock.now(), business.timeZone)) {
          throw validationFailed("That day has already gone by");
        }

        return repositories.waitingEntries.put({
          businessId: wish.businessId,
          customerId,
          serviceId: wish.serviceId,
          resourceIds: named,
          onDate,
          parts: wantedPartsOfDay(wish.parts),
        });
      });
    },

    async withdraw(actor: Actor, entryId: WaitingEntryId): Promise<void> {
      const customerId = actorUserId(actor);
      if (customerId === null) throw forbidden("Only a signed-in customer may withdraw");

      await unitOfWork.run(actor, async ({ repositories }) => {
        const entry = await repositories.waitingEntries.findById(entryId);
        if (entry === null) throw notFound("WaitingEntry", entryId);
        // Somebody else's standing question is not this person's to end.
        if (entry.customerId !== customerId) {
          throw forbidden("That is not yours to withdraw");
        }
        await repositories.waitingEntries.close([entryId], clock.now());
      });
    },

    /**
     * What this customer is still waiting for.
     *
     * From today onward: an entry for a day that has gone by is not waiting
     * for anything, which is why a single date needs no expiry sweep.
     */
    async mine(actor: Actor): Promise<readonly MyWaiting[]> {
      const customerId = actorUserId(actor);
      if (customerId === null) throw forbidden("Only a signed-in customer has a list");

      return unitOfWork.run(actor, async ({ repositories }) => {
        // A day earlier than any zone could make it, because the entries may
        // span businesses in different ones. Each is then judged against its
        // own Business's today, below.
        const open = await repositories.waitingEntries.openForCustomer(
          customerId,
          todayIn(addMinutesToInstant(clock.now(), -A_DAY_IN_MINUTES), UTC),
        );

        const mine: MyWaiting[] = [];
        for (const entry of open) {
          const business = await repositories.businesses.findById(entry.businessId);
          const service = await repositories.services.findById(entry.serviceId);
          if (business === null || service === null) continue;
          if (entry.onDate < todayIn(clock.now(), business.timeZone)) continue;

          const resources = await repositories.resources.listForBusiness(entry.businessId);
          mine.push({
            id: entry.id,
            businessId: entry.businessId,
            businessName: business.name,
            serviceId: entry.serviceId,
            serviceName: service.name,
            resourceNames: entry.resourceIds.flatMap((id) => {
              const resource = resources.find((one) => one.id === id);
              return resource === undefined ? [] : [resource.name];
            }),
            onDate: entry.onDate,
            parts: entry.parts,
          });
        }
        return mine;
      });
    },

    /**
     * Look again at every calendar day something changed on, and tell whoever
     * was waiting for what it is now offering.
     *
     * Safe to run at any time and as often as anyone likes: the outbox rows
     * and the stamps that say they were written go into the same transaction,
     * so a second run has nothing new to say. The mark is cleared whether or
     * not anybody was waiting — the work was to look.
     */
    async publishOpenings(): Promise<PublishReport> {
      const now = clock.now();
      const notifiedBefore = addMinutesToInstant(now, -WAITING_LIST.cooldownMinutes);

      return unitOfWork.run(system(), async (session) => {
        const { repositories } = session;
        const marks = await repositories.waitingRechecks.oldest(WAITING_LIST.marksPerRun);
        let told = 0;

        for (const mark of marks) {
          const waiting = await repositories.waitingEntries.toTell(
            mark.resourceId,
            mark.onDate,
            notifiedBefore,
          );
          if (waiting.length === 0) continue;

          const resource = await repositories.resources.findById(mark.resourceId);
          if (resource === null) continue;

          const answered: WaitingEntryId[] = [];
          for (const one of waiting) {
            // The ordinary availability question, per entry: what a day
            // offers depends on how long the Service takes, so two people
            // waiting on one calendar are not asking the same thing.
            const [day] = await availabilityFor(
              repositories,
              { clock, strategy },
              {
                businessId: one.entry.businessId,
                serviceId: one.entry.serviceId,
                resourceId: mark.resourceId,
                from: mark.onDate,
                to: mark.onDate,
              },
            );
            if (day === undefined) continue;

            const opening = openingFor(
              { resourceIds: one.entry.resourceIds, parts: one.entry.parts },
              day.slots.map((slot) => ({
                startAt: parseInstant(slot.startAt),
                endAt: parseInstant(slot.endAt),
              })),
              timeZone(one.businessTimeZone),
            );
            if (opening === null) continue;

            await session.outbox.enqueue({
              recipientPhone: one.customerPhone,
              template: TEMPLATES.waitingListOpening,
              payload: {
                businessName: one.businessName,
                businessPhone: one.businessPhone,
                serviceName: one.serviceName,
                customerName: one.customerName,
                startAt: formatInstant(opening.startAt),
                partOfDay: opening.part,
                resourceName: resource.name,
                onDate: mark.onDate,
              },
            });
            answered.push(one.entry.id);
            told += 1;
          }

          await repositories.waitingEntries.markNotified(answered, now);
        }

        // Cleared whether or not anybody was told: the work was to look, and a
        // mark left behind would be looked at again forever.
        await repositories.waitingRechecks.clear(marks);
        return { looked: marks.length, told };
      });
    },
  };
};
