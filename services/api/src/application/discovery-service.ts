import {
  notFound,
  type Business,
  type BusinessId,
  type Resource,
  type Service,
} from "@tor-now/domain";
import { SEARCH } from "../config.ts";
import type { Actor, UnitOfWork } from "../ports/unit-of-work.ts";

/**
 * ADR 0011: search is the platform's front door. A Business is discoverable the
 * moment it registers, and carries no type field — categorisation was dropped
 * rather than introduced as free text.
 */

export type BusinessProfile = {
  readonly business: Business;
  readonly services: readonly Service[];
  readonly resources: readonly Resource[];
};

export const discoveryService = ({ unitOfWork }: { unitOfWork: UnitOfWork }) => ({
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
  async profile(actor: Actor, businessId: BusinessId): Promise<BusinessProfile> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      const business = await repositories.businesses.findById(businessId);
      if (business === null) throw notFound("Business", businessId);

      const [services, resources] = await Promise.all([
        repositories.services.listForBusiness(businessId, false),
        repositories.resources.listForBusiness(businessId),
      ]);

      return {
        business,
        services,
        resources: resources.filter((resource) => resource.active),
      };
    });
  },
});
