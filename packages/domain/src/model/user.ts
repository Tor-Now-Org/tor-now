import type { Instant } from "../time/instant.ts";
import type { BusinessId, MembershipId, UserId } from "./ids.ts";
import type { LocalDate } from "../time/local-date.ts";

/**
 * A person with an identity on the platform, identified by a verified phone
 * number (ADR 0004). A User holds no relationship to any Business on their
 * own; that is what a Membership is for.
 */
export type User = {
  readonly id: UserId;
  readonly phone: string;
  readonly name: string;
  readonly birthDate: LocalDate | null;
  /** ADR 0008: deletion hides the row rather than removing it. */
  readonly deletedAt: Instant | null;
  /** ADR 0010: set only by another administrator, and audited. */
  readonly isAdministrator: boolean;
  readonly createdAt: Instant;
};

export const isDeleted = (user: Pick<User, "deletedAt">): boolean =>
  user.deletedAt !== null;

/**
 * The relationship between one User and one Business, carrying the role held
 * there. Authorization is the existence of a Membership, not a property of the
 * User — the same person may own one Business and be a customer of another.
 */
export const MEMBERSHIP_ROLES = ["OWNER", "CUSTOMER"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export type Membership = {
  readonly id: MembershipId;
  readonly userId: UserId;
  readonly businessId: BusinessId;
  readonly role: MembershipRole;
  readonly createdAt: Instant;
};

/** A User seen through a Membership with the customer role. */
export type Customer = {
  readonly user: User;
  readonly membership: Membership;
};
