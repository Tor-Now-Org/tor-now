import {
  addDays,
  compareLocalDate,
  costStats,
  costsOf,
  isPaying,
  monthStartOf,
  nextMonthStartOf,
  platformCost,
  validationFailed,
  instant,
  localTime,
  money,
  notFound,
  priceOn,
  runsOn,
  standingOf,
  timeZone,
  todayIn,
  usageOrNothing,
  zonedToInstant,
  type Clock,
  type CostedBusiness,
  type CostStats,
  type PlatformCost,
  type Instant,
  type LocalDate,
  type PlanVersion,
  type UnitRate,
  type UsageCosts,
} from "@tor-now/domain";
import type { DirectoryEntry, Repositories } from "../ports/repositories.ts";

/**
 * Reading what usage cost (ADR 0023): always from the Usage Records and Unit
 * Rates as they are now, never from anything stored about the result. Every
 * cost screen, Fair Use reading and measured example goes through here.
 */

/** Costs belong to the platform, not a Business, so their day is Israel's. */
export const PLATFORM_ZONE = timeZone("Asia/Jerusalem");

export const platformToday = (clock: Clock): LocalDate => todayIn(clock.now(), PLATFORM_ZONE);

/** Midnight in Israel at the start of a day: where "today" starts for sign-in codes. */
export const platformDayStart = (day: LocalDate): Instant => zonedToInstant(day, localTime(0), PLATFORM_ZONE);

export type PricedSpan = UsageCosts & { readonly rates: readonly UnitRate[] };

/** Usage from `from` up to `to` (not past now), priced by the rates in force on each UTC day. */
export const pricedBetween = async (
  repositories: Repositories,
  from: Instant,
  to: Instant,
  now: Instant,
): Promise<PricedSpan> => {
  const end = instant(Math.min(to, now));
  const [lines, rates] = await Promise.all([
    end <= from ? Promise.resolve([]) : repositories.usageRecords.summarise(from, end),
    repositories.unitRates.list(),
  ]);
  return { ...costsOf(lines, rates), rates };
};

/**
 * Israel's days from `first` to `last`, both included, not past now. A month
 * starts at midnight in Israel, as everything else here does; each day's usage
 * is still priced by the rate of the UTC day it fell on (ADR 0022).
 */
export const pricedDays = (
  repositories: Repositories,
  first: LocalDate,
  last: LocalDate,
  now: Instant,
): Promise<PricedSpan> =>
  pricedBetween(repositories, platformDayStart(first), platformDayStart(addDays(last, 1)), now);

/** Every Business with its Plan edition, keyed by id, and how many calendars each offers. */
export const businessesWithPlans = async (
  repositories: Repositories,
): Promise<readonly { readonly entry: DirectoryEntry; readonly version: PlanVersion }[]> => {
  const [entries, versions] = await Promise.all([
    repositories.subscriptions.directory(),
    repositories.planVersions.listAll(),
  ]);
  const byId = new Map(versions.map((version) => [version.id, version]));
  return entries.map((entry) => {
    const version = byId.get(entry.subscription.planVersionId);
    if (version === undefined) throw notFound("PlanVersion", entry.subscription.planVersionId);
    return { entry, version };
  });
};

/** A costed Business, and how many calendars it offers — what the calculator's examples need. */
export type CostedRow = CostedBusiness & { readonly calendars: number };

/**
 * Every Business as a span's figures count it: where it stood on the span's
 * last day, what it pays a month then — its Plan's price and every Add-on
 * running that day — and what it cost.
 */
export const costedBusinesses = async (
  repositories: Repositories,
  costs: UsageCosts,
  day: LocalDate,
): Promise<readonly CostedRow[]> => {
  const [businesses, holdings] = await Promise.all([
    businessesWithPlans(repositories),
    // A day early: each Business's own today decides, as the daily run does.
    repositories.addonHoldings.listRunning(addDays(day, -1)),
  ]);
  return businesses.map(({ entry, version }) => {
    const addons = holdings
      .filter((holding) => holding.businessId === entry.business.id && runsOn(holding, day))
      .reduce((sum, holding) => sum + priceOn(holding, day), 0);
    const standing = standingOf({
      subscription: entry.subscription,
      businessActive: entry.business.active,
      resourcesOnOffer: entry.resourcesOnOffer,
      resourceAllowance: version.terms.resourceAllowance,
      today: day,
    });
    return {
      businessId: entry.business.id,
      name: entry.business.name,
      plan: version.plan,
      status: standing.status,
      monthlyPrice: money(version.terms.price + addons),
      usage: usageOrNothing(costs.businesses.get(entry.business.id)),
      calendars: entry.resourcesOnOffer,
    };
  });
};

/** A calendar month as the figures read it: from its first day to its last, or to today while it runs. */
export type MonthSpan = { readonly first: LocalDate; readonly through: LocalDate; readonly current: boolean };

/** The month a day is in, or the current one; a month still to come has nothing to read. */
export const monthSpan = (first: LocalDate | null, today: LocalDate): MonthSpan => {
  const thisMonth = monthStartOf(today);
  const start = first === null ? thisMonth : monthStartOf(first);
  if (compareLocalDate(start, thisMonth) > 0) {
    throw validationFailed("A month that has not started has no costs yet", { field: "month" });
  }
  const current = start === thisMonth;
  return { first: start, through: current ? today : addDays(nextMonthStartOf(start), -1), current };
};

/** A month's figures: every Business costed, the Platform Cost, and each Plan's four figures. */
export type MonthFigures = {
  readonly span: MonthSpan;
  readonly priced: PricedSpan;
  readonly businesses: readonly CostedRow[];
  readonly platform: PlatformCost;
  readonly stats: CostStats;
};

export const monthFigures = async (
  repositories: Repositories,
  span: MonthSpan,
  now: Instant,
): Promise<MonthFigures> => {
  const [priced, running] = await Promise.all([
    pricedDays(repositories, span.first, span.through, now),
    repositories.runningCosts.list(),
  ]);
  const businesses = await costedBusinesses(repositories, priced, span.through);
  const platform = platformCost({
    usage: priced.platform,
    running,
    day: span.through,
    paying: businesses.filter((business) => isPaying(business.status)).length,
  });
  return { span, priced, businesses, platform, stats: costStats(businesses, platform.perPaying) };
};
