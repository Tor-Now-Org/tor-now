import {
  notFound,
  type Business,
  type BusinessId,
  type LocalDate,
  type Resource,
  type Service,
} from "@tor-now/domain";
import { SEARCH } from "../config.ts";
import type { Actor, UnitOfWork } from "../ports/unit-of-work.ts";
import type { AvailabilityQuery, DaySlots } from "./availability-service.ts";

/** Just the part of the availability service this one needs. */
type AvailabilityReader = (
  actor: Actor,
  query: AvailabilityQuery,
) => Promise<readonly DaySlots[]>;

/**
 * ADR 0011: search is the platform's front door. A Business is discoverable the
 * moment it registers, and carries no type field — categorisation was dropped
 * rather than introduced as free text.
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
};

export const discoveryService = ({
  unitOfWork,
  availability,
}: {
  unitOfWork: UnitOfWork;
  availability: { forRange: AvailabilityReader };
}) => ({
  /** Below the minimum length, trigram ranking is noise; say nothing instead. */
  async search(actor: Actor, query: string): Promise<readonly Business[]> {
    const trimmed = query.trim();
    if (trimmed.length < SEARCH.minimumQueryLength) return [];

    return unitOfWork.run(actor, async ({ repositories }) => {
      const results = await repositories.businesses.search(trimmed);
      return results
        .filter((result) => result.score >= SEARCH.similarityThreshold)
        .map((result) => result.business);
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

      const [services, resources] = await Promise.all([
        repositories.services.listForBusiness(businessId, false),
        repositories.resources.listForBusiness(businessId),
      ]);

      const bookable = resources.filter((resource) => resource.active);
      const profile = { business, services, resources: bookable };

      const service = services[0];
      const resource = bookable[0];
      if (range === undefined || service === undefined || resource === undefined) {
        return profile;
      }

      return {
        ...profile,
        availability: await availability.forRange(actor, {
          businessId,
          serviceId: service.id,
          resourceId: resource.id,
          from: range.from,
          to: range.to,
        }),
      };
    });
  },
});
