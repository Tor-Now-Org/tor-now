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
  /** What a person is called. Always present; every screen renders it. */
  readonly givenName: string;
  /** Optional, because sign-in asks for a first name and stops there. */
  readonly familyName: string | null;
  readonly birthDate: LocalDate | null;
  /** ADR 0008: deletion hides the row rather than removing it. */
  readonly deletedAt: Instant | null;
  /**
   * ADR 0008's erasure path. Deletion hides a person; anonymisation removes
   * them, keeping the row so appointments, statistics and the audit trail stay
   * whole. It cannot be undone, which is the point.
   */
  readonly anonymisedAt: Instant | null;
  /** ADR 0010: set only by another administrator, and audited. */
  readonly isAdministrator: boolean;
  readonly createdAt: Instant;
};

/**
 * The name to show. Joining happens here rather than in each interface, so
 * "דנה כהן" and "דנה" are formatted the same way everywhere.
 */
export const displayName = (
  user: Pick<User, "givenName" | "familyName">,
): string =>
  user.familyName === null ? user.givenName : `${user.givenName} ${user.familyName}`;

/** How an owner's customer list is ordered: by family name where there is one. */
export const compareByName = (
  left: Pick<User, "givenName" | "familyName">,
  right: Pick<User, "givenName" | "familyName">,
): number =>
  (left.familyName ?? left.givenName).localeCompare(
    right.familyName ?? right.givenName,
    "he",
  ) || left.givenName.localeCompare(right.givenName, "he");

export const isDeleted = (user: Pick<User, "deletedAt">): boolean =>
  user.deletedAt !== null;

export const isAnonymised = (user: Pick<User, "anonymisedAt">): boolean =>
  user.anonymisedAt !== null;

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
  /** Set by the Business to stop this customer booking there. Null means active. */
  readonly blockedAt: Instant | null;
};

export const isBlocked = (membership: Pick<Membership, "blockedAt">): boolean =>
  membership.blockedAt !== null;

/** A User seen through a Membership with the customer role. */
export type Customer = {
  readonly user: User;
  readonly membership: Membership;
};

/**
 * The name given to someone who has verified a number but not yet said who
 * they are. Sign-in creates the row first and asks second, so this is what
 * stands in between — and what `needsName` looks for.
 */
export const UNNAMED = "אורח";

/**
 * True while a User still owes the system a name.
 *
 * Sign-up asks for both halves and will not finish without them, but the row
 * exists from the moment the code is checked — so someone who closes the sheet
 * on the name step leaves an account behind with nothing but a phone number.
 * They are a returning user on their next visit and would never be asked again,
 * which is exactly the gap this closes: the question is asked of anyone who has
 * not answered it, not only of a row created a moment ago.
 */
export const needsName = (user: {
  readonly givenName: string;
  readonly familyName: string | null;
}): boolean => user.givenName.trim() === UNNAMED || user.familyName === null;
