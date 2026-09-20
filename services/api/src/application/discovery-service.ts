import {
  compareLocalDate,
  containsPoint,
  END_OF_DAY,
  inferCategories,
  instantToZoned,
  MIDNIGHT,
  notFound,
  openIntervalsOn,
  zonedToInstant,
  type Business,
  type BusinessCategory,
  type BusinessId,
  type BusinessPhoto,
  type Clock,
  type LocalDate,
  type Resource,
  type Service,
  type SlotGenerationStrategy,
  type TimeZone,
} from "@tor-now/domain";
import { SEARCH } from "../config.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { Actor, UnitOfWork } from "../ports/unit-of-work.ts";
import { availabilityFor, type DaySlots } from "./availability-service.ts";

/**
 * ADR 0011: search is the platform's front door. A Business is discoverable the
 * moment it registers. ADR 0017 gave it a Category from a closed list, which a
 * search can filter by, or infer from what was typed.
 */

export type BusinessProfile = {
  readonly business: Business;
  readonly services: readonly Service[];
  readonly resources: readonly Resource[];
  /**
   * The times the screen draws first, for the first Service on the first
   * Resource. Present only when a date range is asked for.
   *
   * It is here because the booking screen cannot ask for availability until it
   * knows a Service id, and it learns that from this response — so fetching
   * them separately means two round trips in sequence, and the database is far
   * enough away that the customer feels every one of them. Changing the
   * Service or the day still asks the availability endpoint directly.
   */
  readonly availability?: readonly DaySlots[];
  /** The cover first, then the rest, in slot order. */
  readonly photos: readonly BusinessPhoto[];
};

/** Midnight to midnight in the Business's own zone, not the server's. */
const dayBoundsIn = (date: LocalDate, zone: TimeZone) => ({
  start: zonedToInstant(date, MIDNIGHT, zone),
  end: zonedToInstant(date, END_OF_DAY, zone),
});

export type SearchResult = { readonly business: Business; readonly openNow: boolean };

/**
 * Open, for this purpose, means "some active Resource has it": ADR 0002 has no
 * business-wide hours, only per-Resource ones, and a customer deciding whether
 * to walk in cares whether anyone at all can see them right now.
 *
 * Answered for the whole page at once, in three reads rather than three per
 * result. Asked per result it was one read for the calendars and two more for
 * every calendar they had — a page of twenty shops spent well over a hundred
 * sequential round trips to draw twenty open/closed pills.
 */
const openNowPerBusiness = async (
  repositories: Repositories,
  businesses: readonly Business[],
  now: ReturnType<Clock["now"]>,
): Promise<Map<BusinessId, boolean>> => {
  const open = new Map<BusinessId, boolean>(
    businesses.map((business) => [business.id, false]),
  );
  if (businesses.length === 0) return open;

  const resources = await repositories.resources.listForBusinesses(
    businesses.map((business) => business.id),
  );
  const active = resources.filter((resource) => resource.active);
  if (active.length === 0) return open;

  // "Today" is not one date across the page: each Business keeps its own zone,
  // so two results can be on either side of midnight. The reads cover the span
  // those dates make, and each Business is then judged against its own.
  const sorted = businesses
    .map((business) => instantToZoned(now, business.timeZone).date)
    .sort(compareLocalDate);
  const firstDate = sorted[0];
  const lastDate = sorted[sorted.length - 1];
  /* istanbul ignore next -- both hold while there is a business, checked above */
  if (firstDate === undefined || lastDate === undefined) return open;

  const activeIds = active.map((resource) => resource.id);
  const [hours, overrides] = await Promise.all([
    repositories.workingHours.listForResources(activeIds),
    repositories.dateOverrides.listForResources(activeIds, firstDate, lastDate),
  ]);

  const hoursOf = groupBy(activeIds, hours, (row) => row.resourceId);
  const overridesOf = groupBy(activeIds, overrides, (row) => row.resourceId);
  const calendarsOf = groupBy(
    businesses.map((business) => business.id),
    active,
    (row) => row.businessId,
  );

  for (const business of businesses) {
    const zoned = instantToZoned(now, business.timeZone);
    open.set(
      business.id,
      (calendarsOf.get(business.id) ?? []).some((resource) => {
        // `openIntervalsOn` picks the override for this date out of what it is
        // given, which is what lets one read cover a span of them.
        const intervals = openIntervalsOn(
          zoned.date,
          hoursOf.get(resource.id) ?? [],
          overridesOf.get(resource.id) ?? [],
        );
        return intervals.some((range) => containsPoint(range, zoned.time));
      }),
    );
  }
  return open;
};

/**
 * Rows read for many owners at once, back into one list each — seeded from the
 * keys asked about, so something with no rows reads as empty rather than absent.
 */
const groupBy = <K, T>(
  keys: readonly K[],
  rows: readonly T[],
  keyOf: (row: T) => K,
): Map<K, T[]> => {
  const grouped = new Map<K, T[]>(keys.map((key) => [key, []]));
  for (const row of rows) grouped.get(keyOf(row))?.push(row);
  return grouped;
};

export const discoveryService = ({
  unitOfWork,
  clock,
  strategy,
}: {
  unitOfWork: UnitOfWork;
  clock: Clock;
  strategy?: SlotGenerationStrategy;
}) => ({
  /**
   * Below the minimum length, trigram ranking is noise, so the text is dropped —
   * and with no Category either there is no question to answer.
   */
  async search(
    actor: Actor,
    query: string,
    options: {
      category?: BusinessCategory | undefined;
      near?: { latitude: number; longitude: number } | undefined;
    } = {},
  ): Promise<readonly SearchResult[]> {
    const trimmed = query.trim();
    const text = trimmed.length < SEARCH.minimumQueryLength ? "" : trimmed;
    // Nothing typed and no Category is the map's browse: every Business, nearest first.
    const category = options.category ?? null;

    return unitOfWork.run(actor, async ({ repositories }) => {
      const results = await repositories.businesses.search({
        text,
        category,
        inferred: text === "" ? [] : inferCategories(text),
        near: options.near ?? null,
      });
      const businesses = results
        // A browse has nothing to be similar to; everything in the Category counts.
        .filter((result) => text === "" || result.score >= SEARCH.similarityThreshold)
        .map((result) => result.business);

      // One pass for the page, not one per result.
      const openNow = await openNowPerBusiness(repositories, businesses, clock.now());
      return businesses.map((business) => ({
        business,
        openNow: openNow.get(business.id) ?? false,
      }));
    });
  },

  /**
   * Everything a customer needs to choose a time: the Business, what it offers,
   * and which calendars it offers them on. Availability is a separate call,
   * because it depends on a Service the customer has not chosen yet.
   */
  async profile(
    actor: Actor,
    businessId: BusinessId,
    range?: { from: LocalDate; to: LocalDate },
  ): Promise<BusinessProfile> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      const business = await repositories.businesses.findById(businessId);
      if (business === null) throw notFound("Business", businessId);

      const [services, resources, photos] = await Promise.all([
        repositories.services.listForBusiness(businessId, false),
        repositories.resources.listForBusiness(businessId),
        repositories.businessPhotos.listForBusiness(businessId),
      ]);

      const bookable = resources.filter((resource) => resource.active);
      const profile = { business, services, resources: bookable, photos };

      const service = services[0];
      const resource = bookable[0];
      if (range === undefined || service === undefined || resource === undefined) {
        return profile;
      }

      return {
        ...profile,
        // In this transaction, on this connection, and with the three entities
        // it would otherwise re-read handed straight to it.
        availability: await availabilityFor(
          repositories,
          { clock, ...(strategy === undefined ? {} : { strategy }) },
          {
            businessId,
            serviceId: service.id,
            resourceId: resource.id,
            from: range.from,
            to: range.to,
          },
          {
            business,
            service,
            resource,
            dayBounds: (date) => dayBoundsIn(date, business.timeZone),
          },
        ),
      };
    });
  },
});
