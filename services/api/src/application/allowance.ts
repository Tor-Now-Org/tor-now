import {
  isOnOffer,
  resourcesBeyondAllowance,
  validationFailed,
  type BusinessId,
  type Entitlement,
  type Instant,
  type Resource,
  type ResourceId,
} from "@tor-now/domain";
import type { Repositories } from "../ports/repositories.ts";

/**
 * The Resource Allowance as Scheduling carries it out (ADR 0019). Billing says
 * how many calendars a Business may keep on offer; pausing the ones beyond it,
 * and bringing them back, happens here.
 */

const pausedOf = (resources: readonly Resource[]): Resource[] =>
  resources.filter((resource) => resource.active && resource.pausedAt !== null);

/**
 * Keeps on offer exactly the calendars chosen and pauses every other one, once
 * an administrator and the owner have agreed which stay. Refuses a choice the
 * Allowance could not hold, or one that leaves nothing bookable.
 */
export const keepOnly = async (
  repositories: Repositories,
  input: {
    businessId: BusinessId;
    keep: readonly ResourceId[];
    entitlement: Entitlement;
    at: Instant;
  },
): Promise<readonly Resource[]> => {
  const resources = await repositories.resources.listForBusiness(input.businessId);
  const onOffer = resources.filter(isOnOffer);
  const keep = [...new Set(input.keep)];
  if (keep.length === 0) throw validationFailed("At least one calendar has to stay");
  if (keep.length > input.entitlement.resourceAllowance) {
    throw validationFailed("More calendars chosen than the plan allows", {
      resourceAllowance: input.entitlement.resourceAllowance,
    });
  }
  for (const id of keep) {
    if (!onOffer.some((resource) => resource.id === id)) {
      throw validationFailed("Only a calendar on offer can be kept", { resourceId: id });
    }
  }
  const toPause = onOffer.filter((resource) => !keep.includes(resource.id)).map((resource) => resource.id);
  await repositories.resources.setPaused(toPause, input.at);
  return repositories.resources.listForBusiness(input.businessId);
};

/**
 * Brings paused calendars back, oldest first, for as much room as the
 * Allowance now leaves — which is what an upgrade does to them.
 */
export const resumeWithinAllowance = async (
  repositories: Repositories,
  businessId: BusinessId,
  entitlement: Entitlement,
): Promise<readonly ResourceId[]> => {
  const resources = await repositories.resources.listForBusiness(businessId);
  const room = entitlement.resourceAllowance - resources.filter(isOnOffer).length;
  if (room <= 0) return [];
  const back = pausedOf(resources)
    .slice(0, room)
    .map((resource) => resource.id);
  await repositories.resources.setPaused(back, null);
  return back;
};

/** Calendars on offer beyond the Allowance: what the administrator is asked to settle. */
export const overAllowance = (resources: readonly Resource[], entitlement: Entitlement): number =>
  resourcesBeyondAllowance(entitlement, resources.filter(isOnOffer).length);
