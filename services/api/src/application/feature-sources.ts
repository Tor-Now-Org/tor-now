import {
  addDays,
  featureSources,
  notFound,
  timeZone,
  todayIn,
  type BusinessId,
  type FeatureSource,
  type Instant,
} from "@tor-now/domain";
import type { DirectoryEntry, Repositories } from "../ports/repositories.ts";
import { trialAddonsOf } from "./addons.ts";

/**
 * Where every Business has each Feature from — its edition, an Add-on, a
 * Grant, a Preview, or nowhere — worked out in one pass over the platform, each
 * against the Business's own today. The Features tab counts from it, and the
 * Businesses list filters by it, so the two can never disagree.
 */
export const sourcesByBusiness = async (
  repositories: Repositories,
  entries: readonly DirectoryEntry[],
  now: Instant,
): Promise<ReadonlyMap<BusinessId, readonly FeatureSource[]>> => {
  // A day early: each Business's own today decides which still run.
  const dayEarly = addDays(todayIn(now, timeZone("UTC")), -1);
  const [versions, grants, previews, addons, offers] = await Promise.all([
    repositories.planVersions.listAll(),
    repositories.grants.listRunning(dayEarly),
    repositories.previews.list(),
    repositories.addonHoldings.listRunning(dayEarly),
    repositories.addonOffers.list(),
  ]);
  const editionOf = new Map(versions.map((version) => [version.id, version]));
  return new Map(
    entries.map((entry) => {
      const edition = editionOf.get(entry.subscription.planVersionId);
      if (edition === undefined) throw notFound("PlanVersion", entry.subscription.planVersionId);
      return [
        entry.business.id,
        featureSources({
          terms: edition.terms,
          grants: grants.filter((grant) => grant.businessId === entry.business.id),
          previews,
          addons: addons.filter((holding) => holding.businessId === entry.business.id),
          trialAddons: trialAddonsOf(entry.subscription.paidThrough === null ? entry.subscription.trialEndsOn : null, offers),
          today: todayIn(now, entry.business.timeZone),
        }),
      ] as const;
    }),
  );
};
