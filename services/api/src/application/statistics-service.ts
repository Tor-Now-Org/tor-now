import {
  addDays,
  compareLocalDate,
  displayName,
  monthlyStatistics,
  monthStartOf,
  MIDNIGHT,
  nextMonthStartOf,
  parseLocalDate,
  requireFeature,
  todayIn,
  trendStartOf,
  validationFailed,
  zonedToInstant,
  type BusinessId,
  type Clock,
  type MonthlyStatistics,
  type ResourceId,
} from "@tor-now/domain";
import type { Actor, UnitOfWork } from "../ports/unit-of-work.ts";
import { loadOwnedBusiness, loadOwnedResource } from "./authorization.ts";
import { entitlementToday } from "./billing.ts";

export type StatisticsPage = MonthlyStatistics & {
  /** Names for the customers the page lists, by id. */
  readonly customerNames: Readonly<Record<string, string>>;
};

/**
 * A Business's month in numbers. Its OWNER's alone, and only while the plan
 * includes Statistics; a manager or a worker is refused like anyone else.
 */
export const statisticsService = ({
  unitOfWork,
  clock,
}: {
  unitOfWork: UnitOfWork;
  clock: Clock;
}) => ({
  async month(
    actor: Actor,
    businessId: BusinessId,
    firstOfMonth: string,
    resourceId: string | null,
  ): Promise<StatisticsPage> {
    const month = parseLocalDate(firstOfMonth);
    return unitOfWork.run(actor, async ({ repositories }) => {
      const business = await loadOwnedBusiness(repositories, actor, businessId);
      requireFeature(await entitlementToday(repositories, businessId, clock), "STATISTICS");
      if (resourceId !== null) await loadOwnedResource(repositories, businessId, resourceId);

      const { timeZone } = business;
      const now = clock.now();
      const firstMonth = monthStartOf(todayIn(business.createdAt, timeZone));
      const currentMonth = monthStartOf(todayIn(now, timeZone));
      if (compareLocalDate(month, firstMonth) < 0 || compareLocalDate(month, currentMonth) > 0) {
        throw validationFailed("Statistics run from the month the business opened to this one");
      }

      const firstDay = trendStartOf(month, firstMonth);
      const afterLast = nextMonthStartOf(month);
      const from = zonedToInstant(firstDay, MIDNIGHT, timeZone);
      const to = zonedToInstant(afterLast, MIDNIGHT, timeZone);

      // ponytail: calendars as they stand today — a withdrawn one's
      // appointments still count in the totals, but it has no row of its own.
      const calendars = (await repositories.resources.listForBusiness(businessId)).filter(
        (resource) => resource.active,
      );
      const ids = calendars.map((resource) => resource.id);
      const [appointments, hours, overrides, blocks, firstVisits] = await Promise.all([
        repositories.appointments.listForBusinessBetween(businessId, from, to),
        repositories.workingHours.listForResources(ids),
        repositories.dateOverrides.listForResources(ids, firstDay, addDays(afterLast, -1)),
        repositories.blocks.listForResourcesBetween(ids, from, to),
        repositories.appointments.firstVisitsBetween(businessId, from, to, now),
      ]);

      const statistics = monthlyStatistics({
        month,
        firstMonth,
        timeZone,
        now,
        appointments,
        calendars: calendars.map((resource) => ({
          id: resource.id,
          name: resource.name,
          workingHours: hours.filter((one) => one.resourceId === resource.id),
          overrides: overrides.filter((one) => one.resourceId === resource.id),
          blocks: blocks.filter((one) => one.resourceId === resource.id),
        })),
        firstVisits,
        resourceId: resourceId as ResourceId | null,
      });

      const listed = [
        ...statistics.customers.top.map((entry) => entry.customerId),
        ...statistics.repeatMisses.map((entry) => entry.customerId),
      ];
      const people = listed.length === 0 ? [] : await repositories.users.findByIds([...new Set(listed)]);
      return {
        ...statistics,
        customerNames: Object.fromEntries(people.map((person) => [person.id, displayName(person)])),
      };
    });
  },
});
