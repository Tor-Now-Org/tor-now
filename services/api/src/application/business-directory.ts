import {
  BILLING_FLAGS,
  BILLING_STATUSES,
  compareLocalDate,
  FEATURES,
  PLANS,
  standingOf,
  type BillingFlag,
  type BillingStatus,
  type Feature,
  type FeatureSource,
  type LocalDate,
  type Plan,
  type PlanVersion,
  type PlanVersionId,
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
  /** One edition of a Plan — who is still on Solo v1, say. */
  readonly edition: PlanVersionId | null;
  /** All of these must hold. */
  readonly flags: readonly BillingFlag[];
  /** A Feature the Business has — from anywhere, or from one place. */
  readonly feature: Feature | null;
  readonly featureSource: FeatureFrom;
};

/** Where a Feature comes from, as the filter asks it: anywhere, or one source. */
export const FEATURE_FROM = ["ANY", "PLAN", "ADDON", "GRANT", "PREVIEW"] as const;
export type FeatureFrom = (typeof FEATURE_FROM)[number];

export const NO_FILTER: DirectoryFilter = Object.freeze({
  query: null,
  statuses: [],
  plan: null,
  edition: null,
  flags: [],
  feature: null,
  featureSource: "ANY",
});

export type DirectoryRow = DirectoryEntry & {
  readonly planVersion: PlanVersion;
  readonly standing: Standing;
  /** Where the Business has each Feature from. */
  readonly features: readonly FeatureSource[];
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
  /** Every edition some matching Business is on, Plan by Plan, oldest first. */
  readonly editions: readonly { readonly id: PlanVersionId; readonly plan: Plan; readonly number: number; readonly count: number }[];
  readonly flags: Readonly<Record<BillingFlag, number>>;
  /** How many have each Feature, from anywhere. */
  readonly features: Readonly<Record<Feature, number>>;
  /** For the Feature chosen, how many have it from each place. */
  readonly featureSources: Readonly<Record<FeatureFrom, number>>;
};

export const directoryRow = (
  entry: DirectoryEntry,
  planVersion: PlanVersion,
  today: LocalDate,
  features: readonly FeatureSource[] = [],
): DirectoryRow => ({
  ...entry,
  planVersion,
  features,
  standing: standingOf({
    subscription: entry.subscription,
    businessActive: entry.business.active,
    resourcesOnOffer: entry.resourcesOnOffer,
    resourceAllowance: planVersion.terms.resourceAllowance,
    today,
  }),
});

type Group = "query" | "statuses" | "plan" | "edition" | "flags" | "feature";

const hasFeature = (row: DirectoryRow, feature: Feature, from: FeatureFrom): boolean => {
  const source = row.features.find((candidate) => candidate.feature === feature)?.source ?? "NONE";
  return source !== "NONE" && (from === "ANY" || source === from);
};

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
    (except === "edition" || filter.edition === null || row.planVersion.id === filter.edition) &&
    (except === "flags" || filter.flags.every((flag) => row.standing.flags.includes(flag))) &&
    (except === "feature" || filter.feature === null || hasFeature(row, filter.feature, filter.featureSource))
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

const editionsIn = (rows: readonly DirectoryRow[]): DirectoryCounts["editions"] => {
  const counted = new Map<PlanVersionId, { id: PlanVersionId; plan: Plan; number: number; count: number }>();
  for (const { planVersion } of rows) {
    const seen = counted.get(planVersion.id);
    counted.set(planVersion.id, {
      id: planVersion.id,
      plan: planVersion.plan,
      number: planVersion.number,
      count: (seen?.count ?? 0) + 1,
    });
  }
  return [...counted.values()].sort((a, b) => a.plan.localeCompare(b.plan) || a.number - b.number);
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
      editions: editionsIn(without("edition")),
      flags: tally(BILLING_FLAGS, without("flags"), (row, flag) => row.standing.flags.includes(flag)),
      features: tally(FEATURES, without("feature"), (row, feature) => hasFeature(row, feature, "ANY")),
      featureSources: tally(FEATURE_FROM, without("feature"), (row, from) =>
        filter.feature === null ? false : hasFeature(row, filter.feature, from),
      ),
    },
  };
};
