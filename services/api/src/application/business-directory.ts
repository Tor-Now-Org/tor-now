import {
  BILLING_FLAGS,
  BILLING_STATUSES,
  compareLocalDate,
  PLANS,
  standingOf,
  type BillingFlag,
  type BillingStatus,
  type LocalDate,
  type Plan,
  type PlanVersion,
  type Standing,
} from "@tor-now/domain";
import type { DirectoryEntry } from "../ports/repositories.ts";

/**
 * The administrator's list of Businesses: filtered, counted and sorted in one
 * place, on the server, over every Business — never over whichever page the
 * interface happens to have loaded.
 */

export type DirectoryFilter = {
  /** Matched against the Business's name and its owner's name and phone. */
  readonly query: string | null;
  /** Any of these; none means every status. */
  readonly statuses: readonly BillingStatus[];
  readonly plan: Plan | null;
  /** All of these must hold. */
  readonly flags: readonly BillingFlag[];
};

export const NO_FILTER: DirectoryFilter = Object.freeze({
  query: null,
  statuses: [],
  plan: null,
  flags: [],
});

export type DirectoryRow = DirectoryEntry & {
  readonly planVersion: PlanVersion;
  readonly standing: Standing;
};

/**
 * How many Businesses each option would show. Each group is counted with every
 * other group's filter applied but not its own, so an option's number is what
 * choosing it gives — the way a shop's filters count.
 */
export type DirectoryCounts = {
  readonly total: number;
  readonly statuses: Readonly<Record<BillingStatus, number>>;
  readonly plans: Readonly<Record<Plan, number>>;
  readonly flags: Readonly<Record<BillingFlag, number>>;
};

export const directoryRow = (
  entry: DirectoryEntry,
  planVersion: PlanVersion,
  today: LocalDate,
): DirectoryRow => ({
  ...entry,
  planVersion,
  standing: standingOf({
    subscription: entry.subscription,
    businessActive: entry.business.active,
    resourcesOnOffer: entry.resourcesOnOffer,
    resourceAllowance: planVersion.terms.resourceAllowance,
    today,
  }),
});

type Group = "query" | "statuses" | "plan" | "flags";

const passes = (row: DirectoryRow, filter: DirectoryFilter, except?: Group): boolean => {
  const needle = filter.query?.trim().toLowerCase() ?? "";
  return (
    (except === "query" ||
      needle === "" ||
      row.business.name.toLowerCase().includes(needle) ||
      (row.owner?.name.toLowerCase().includes(needle) ?? false) ||
      (row.owner?.phone.includes(needle) ?? false)) &&
    (except === "statuses" ||
      filter.statuses.length === 0 ||
      filter.statuses.includes(row.standing.status)) &&
    (except === "plan" || filter.plan === null || row.planVersion.plan === filter.plan) &&
    (except === "flags" || filter.flags.every((flag) => row.standing.flags.includes(flag)))
  );
};

const tally = <K extends string>(
  keys: readonly K[],
  rows: readonly DirectoryRow[],
  has: (row: DirectoryRow, key: K) => boolean,
): Record<K, number> =>
  Object.fromEntries(
    keys.map((key) => [key, rows.filter((row) => has(row, key)).length]),
  ) as Record<K, number>;

/** Soonest date first, so whatever turns next is on top; undated last, then by name. */
const bySoonest = (a: DirectoryRow, b: DirectoryRow): number => {
  const [x, y] = [a.standing.nextDate, b.standing.nextDate];
  if (x !== y) {
    if (x === null) return 1;
    if (y === null) return -1;
    const order = compareLocalDate(x, y);
    if (order !== 0) return order;
  }
  return a.business.name.localeCompare(b.business.name);
};

export const filterDirectory = (
  rows: readonly DirectoryRow[],
  filter: DirectoryFilter,
): { readonly rows: readonly DirectoryRow[]; readonly counts: DirectoryCounts } => {
  const without = (group: Group) => rows.filter((row) => passes(row, filter, group));
  const matching = rows.filter((row) => passes(row, filter)).sort(bySoonest);
  return {
    rows: matching,
    counts: {
      total: rows.length,
      statuses: tally(BILLING_STATUSES, without("statuses"), (row, status) => row.standing.status === status),
      plans: tally(PLANS, without("plan"), (row, plan) => row.planVersion.plan === plan),
      flags: tally(BILLING_FLAGS, without("flags"), (row, flag) => row.standing.flags.includes(flag)),
    },
  };
};
