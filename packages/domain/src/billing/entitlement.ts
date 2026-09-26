import type { BusinessId, GrantId, UserId } from "../model/ids.ts";
import { DomainError } from "../shared/errors.ts";
import { compareLocalDate, type LocalDate } from "../time/local-date.ts";
import { FEATURES, type Feature } from "./feature.ts";
import type { PlanTerms } from "./plan.ts";

/**
 * One Feature given to one Business beyond what its Plan Version includes, for
 * a stated reason and until a stated date. Never permanent: anything meant to
 * last becomes a Plan Version (ADR 0021).
 */
export type Grant = {
  readonly id: GrantId;
  readonly businessId: BusinessId;
  readonly feature: Feature;
  readonly reason: string;
  /** The last day it applies, inclusive. */
  readonly endsOn: LocalDate;
  readonly grantedBy: UserId;
};

/**
 * A newly launched Feature offered on every Plan for a stated period, labelled
 * as not yet placed (ADR 0020).
 */
export type Preview = {
  readonly feature: Feature;
  /** The last day it applies, inclusive. */
  readonly endsOn: LocalDate;
};

/**
 * What a Subscription grants at a given moment: the one thing Billing tells
 * Scheduling beyond Deactivation (ADR 0019).
 */
export type Entitlement = {
  readonly features: readonly Feature[];
  readonly resourceAllowance: number;
};

const runsThrough = (endsOn: LocalDate, today: LocalDate): boolean =>
  compareLocalDate(today, endsOn) <= 0;

/** All an Entitlement needs of a Grant; its reason stays with the owner. */
export type GrantTerm = Pick<Grant, "feature" | "endsOn">;

/**
 * The Plan Version's terms, plus the Business's own Grants and every Preview
 * still running. The Grants passed in are assumed to be this Business's.
 */
export const entitlementFor = (input: {
  terms: PlanTerms;
  grants: readonly GrantTerm[];
  previews: readonly Preview[];
  today: LocalDate;
}): Entitlement => {
  const held = new Set<Feature>([
    ...input.terms.features,
    ...input.grants.filter((grant) => runsThrough(grant.endsOn, input.today)).map((grant) => grant.feature),
    ...input.previews
      .filter((preview) => runsThrough(preview.endsOn, input.today))
      .map((preview) => preview.feature),
  ]);
  return {
    features: FEATURES.filter((feature) => held.has(feature)),
    resourceAllowance: input.terms.resourceAllowance,
  };
};

export const hasFeature = (entitlement: Entitlement, feature: Feature): boolean =>
  entitlement.features.includes(feature);

/**
 * The one check every Feature makes, at the moment something new is started
 * with it. Losing an Entitlement stops new use; it never touches what exists.
 */
export const requireFeature = (entitlement: Entitlement, feature: Feature): void => {
  if (!hasFeature(entitlement, feature)) {
    throw new DomainError("NOT_ENTITLED", `The plan does not include ${feature}`, { feature });
  }
};

/** Refuses a calendar that would put the Business past its Resource Allowance. */
export const requireRoomForResource = (entitlement: Entitlement, onOffer: number): void => {
  if (onOffer >= entitlement.resourceAllowance) {
    throw new DomainError(
      "NOT_ENTITLED",
      `The plan allows ${entitlement.resourceAllowance} calendars`,
      { resourceAllowance: entitlement.resourceAllowance },
    );
  }
};

/** How many calendars on offer sit beyond the Allowance — the admin's list. */
export const resourcesBeyondAllowance = (entitlement: Entitlement, onOffer: number): number =>
  Math.max(0, onOffer - entitlement.resourceAllowance);
