import { validationFailed } from "../shared/errors.ts";

/**
 * A named capability a Subscription either grants or does not (ADR 0019).
 *
 * The list is closed and lives in code, because a Feature cannot be sold before
 * it is built: an administrator places, prices and withdraws Features through
 * the Catalogue, but cannot invent one. Billing knows each only by this name —
 * what "WAITING_LIST" means is Scheduling's business.
 *
 * Everything without which a Business cannot take a booking is not here and
 * never will be: that is the product, not a Feature of it.
 */
export const FEATURES = [
  "REMINDERS",
  "CUSTOMER_HISTORY",
  "TEAM_ROLES",
  "WAITING_LIST",
] as const;

export type Feature = (typeof FEATURES)[number];

const KNOWN: ReadonlySet<string> = new Set(FEATURES);

export const isFeature = (value: string): value is Feature => KNOWN.has(value);

export const parseFeature = (value: string): Feature => {
  if (!isFeature(value)) throw validationFailed(`Unknown feature "${value}"`);
  return value;
};
