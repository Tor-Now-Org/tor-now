import { forbidden, notFound, unauthenticated, type BusinessId, type UserId } from "@tor-now/domain";
import type { Repositories } from "../ports/repositories.ts";
import type { Actor } from "../ports/unit-of-work.ts";

/**
 * ADR 0007 enforces isolation twice, deliberately. Row Level Security is the
 * authority and would already have hidden these rows; these checks exist so a
 * caller gets "you do not own this business" instead of an empty result, which
 * is the difference between a usable error and a mystery.
 */

export const requireUser = (actor: Actor): UserId => {
  if (actor.kind === "ANONYMOUS") throw unauthenticated();
  if (actor.kind === "SYSTEM") {
    throw forbidden("Scheduled work cannot act as a user");
  }
  return actor.userId;
};

/** ADR 0010: administrator actions run over a connection with no RLS backstop. */
export const requireAdministrator = (actor: Actor): UserId => {
  if (actor.kind !== "ADMINISTRATOR") {
    throw forbidden("This action is limited to platform administrators");
  }
  return actor.userId;
};

export const requireOwnership = async (
  repositories: Repositories,
  actor: Actor,
  businessId: BusinessId,
): Promise<void> => {
  // An administrator may act on a Business on its owner's behalf (ADR 0010),
  // and every such action is audited.
  if (actor.kind === "ADMINISTRATOR") return;

  const userId = requireUser(actor);
  const membership = await repositories.memberships.find(userId, businessId);
  if (membership === null || membership.role !== "OWNER") {
    throw forbidden("You do not manage this business");
  }
};

export const loadOwnedBusiness = async (
  repositories: Repositories,
  actor: Actor,
  businessId: BusinessId,
) => {
  await requireOwnership(repositories, actor, businessId);
  const business = await repositories.businesses.findById(businessId);
  if (business === null) throw notFound("Business", businessId);
  return business;
};

/** A Resource must belong to the Business the caller was authorized against. */
export const loadOwnedResource = async (
  repositories: Repositories,
  businessId: BusinessId,
  resourceId: string,
) => {
  const resource = await repositories.resources.findById(resourceId as never);
  if (resource === null || resource.businessId !== businessId) {
    throw notFound("Resource", resourceId);
  }
  return resource;
};
