import {
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
 */
const isOpenNow = async (
  repositories: Repositories,
  business: Business,
  now: ReturnType<Clock["now"]>,
): Promise<boolean> => {
  const resources = await repositories.resources.listForBusiness(business.id);
  const zoned = instantToZoned(now, business.timeZone);

  const openPerResource = await Promise.all(
    resources
      .filter((resource) => resource.active)
      .map(async (resource) => {
        const [hours, override] = await Promise.all([
          repositories.workingHours.listForResource(resource.id),
          repositories.dateOverrides.findByDate(resource.id, zoned.date),
        ]);
        const open = openIntervalsOn(zoned.date, hours, override === null ? [] : [override]);
        return open.some((range) => containsPoint(range, zoned.time));
      }),
  );
  return openPerResource.some(Boolean);
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

      const now = clock.now();
      return Promise.all(
        businesses.map(async (business) => ({
          business,
          openNow: await isOpenNow(repositories, business, now),
        })),
      );
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
