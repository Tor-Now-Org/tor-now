import type { BusinessDto } from "./api/types.ts";

/**
 * What this person may do here.
 *
 * The API is the authority and refuses the rest — these decide what to *offer*,
 * which is a different job: a worker should not meet a button that exists to be
 * refused. Gathered here rather than spelled out per screen so that the answer
 * to "who may close the shop" lives in one place and reads the same everywhere
 * (ADR 0016).
 */

/** Absent means an API deployed before roles existed, where staff were owners. */
const roleOf = (business: BusinessDto) => business.role ?? "OWNER";

/** Runs the business day to day: everything but ADR 0016's three owner-only acts. */
export const manages = (business: BusinessDto): boolean => {
  const role = roleOf(business);
  return role === "OWNER" || role === "MANAGER";
};

/**
 * Closing the shop, or putting it on different hours, across every calendar.
 *
 * A worker keeps their own calendar — blocking their own time is theirs — but
 * "we are shut next week" is the business speaking, and it calls off other
 * people's appointments to say it.
 */
export const canCloseBusiness = manages;
