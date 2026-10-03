import type { BusinessDto } from "./api/types.ts";
import { includes } from "./entitlement.ts";

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

/** The staff role to name on screen. A CUSTOMER never reaches the manage app; shown as the least of the staff roles. */
export const staffRole = (business: BusinessDto): "OWNER" | "MANAGER" | "WORKER" => {
  const role = roleOf(business);
  return role === "CUSTOMER" ? "WORKER" : role;
};

/** The bottom bar's tabs, in the order it shows them. */
export const SECTIONS = ["day", "schedule", "business", "customers", "statistics"] as const;
export type Section = (typeof SECTIONS)[number];

/** Statistics is the plan's to give (ADR 0019) and the OWNER's alone to read. */
export const readsStatistics = (business: BusinessDto): boolean =>
  roleOf(business) === "OWNER" && includes(business, "STATISTICS");

/**
 * Where the plan gives Statistics, the customer list is a panel of the
 * Business tab, so the bar keeps four tabs. Elsewhere it is a tab of its own.
 */
export const customersInBusiness = (business: BusinessDto): boolean =>
  manages(business) && includes(business, "STATISTICS");

/** What the bottom bar offers this person here; any other tab opens the calendar instead. */
export const sectionsFor = (business: BusinessDto): Section[] => [
  "day",
  "schedule",
  ...(manages(business) ? (["business"] as const) : []),
  ...(manages(business) && !customersInBusiness(business) ? (["customers"] as const) : []),
  ...(readsStatistics(business) ? (["statistics"] as const) : []),
];
