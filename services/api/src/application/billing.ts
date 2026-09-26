import {
  entitlementFor,
  isOnOffer,
  notFound,
  standingOf,
  subscriptionStateOn,
  todayIn,
  type BusinessId,
  type Clock,
  type Entitlement,
  type LocalDate,
  type Plan,
  type PlanVersion,
  type Standing,
  type Subscription,
  type SubscriptionState,
} from "@tor-now/domain";
import type { Repositories } from "../ports/repositories.ts";

/**
 * Billing as the rest of the application reads it. Shared because the owner's
 * panel, the administrator's and every Feature check each need the same
 * Subscription joined to the same Plan Version, worked out the same way.
 */

export type SubscriptionView = {
  readonly subscription: Subscription;
  readonly planVersion: PlanVersion;
  /** The edition a scheduled move goes to, when one is pending. */
  readonly scheduledVersion: PlanVersion | null;
  readonly state: SubscriptionState;
  /** The same typed status and flags the administrator's directory shows. */
  readonly standing: Standing;
};

const requireVersion = async (
  repositories: Repositories,
  id: PlanVersion["id"],
): Promise<PlanVersion> => {
  const version = await repositories.planVersions.findById(id);
  if (version === null) throw notFound("PlanVersion", id);
  return version;
};

export const subscriptionView = async (
  repositories: Repositories,
  businessId: BusinessId,
  today: LocalDate,
): Promise<SubscriptionView> => {
  const [subscription, business, resources] = await Promise.all([
    repositories.subscriptions.findByBusiness(businessId),
    repositories.businesses.findById(businessId),
    repositories.resources.listForBusiness(businessId),
  ]);
  if (subscription === null || business === null) throw notFound("Subscription", businessId);
  const [planVersion, scheduledVersion] = await Promise.all([
    requireVersion(repositories, subscription.planVersionId),
    subscription.scheduledMove === null
      ? Promise.resolve(null)
      : requireVersion(repositories, subscription.scheduledMove.planVersionId),
  ]);
  return {
    subscription,
    planVersion,
    scheduledVersion,
    state: subscriptionStateOn(subscription, today),
    standing: standingOf({
      subscription,
      businessActive: business.active,
      resourcesOnOffer: resources.filter(isOnOffer).length,
      resourceAllowance: planVersion.terms.resourceAllowance,
      today,
    }),
  };
};

/** The edition of a Plan that new Businesses join. */
export const currentVersionOf = async (
  repositories: Repositories,
  plan: Plan,
): Promise<PlanVersion> => {
  const current = (await repositories.planVersions.listCurrent()).find(
    (version) => version.plan === plan,
  );
  if (current === undefined) throw notFound("PlanVersion", plan);
  return current;
};

/**
 * What a Business may do today (ADR 0019). Readable by anyone acting on the
 * Business — owner, worker or customer — because every Feature check needs it.
 */
export const entitlementOf = async (
  repositories: Repositories,
  businessId: BusinessId,
  today: LocalDate,
): Promise<Entitlement> => {
  const basis = await repositories.subscriptions.entitlementBasis(businessId);
  if (basis === null) throw notFound("Subscription", businessId);
  const [version, previews] = await Promise.all([
    requireVersion(repositories, basis.planVersionId),
    repositories.previews.list(),
  ]);
  return entitlementFor({ terms: version.terms, grants: basis.grants, previews, today });
};

/** The Entitlement as of the Business's own today — what every Feature check asks. */
export const entitlementToday = async (
  repositories: Repositories,
  businessId: BusinessId,
  clock: Clock,
): Promise<Entitlement> => {
  const business = await repositories.businesses.findById(businessId);
  if (business === null) throw notFound("Business", businessId);
  return entitlementOf(repositories, businessId, todayIn(clock.now(), business.timeZone));
};

/**
 * Entitlements for a job that walks many Businesses: each worked out once per
 * run, however many of its rows the job meets.
 */
export const entitlementsFor = (repositories: Repositories, clock: Clock) => {
  const known = new Map<BusinessId, Promise<Entitlement>>();
  return (businessId: BusinessId): Promise<Entitlement> => {
    const cached = known.get(businessId);
    if (cached !== undefined) return cached;
    const loading = entitlementToday(repositories, businessId, clock);
    known.set(businessId, loading);
    return loading;
  };
};
