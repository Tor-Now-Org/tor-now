import {
  addDays,
  checkBusinessLimit,
  checkSignInLimit,
  FAIR_USE_SOURCES,
  notFound,
  overLimits,
  readingsOf,
  signInOver,
  sourceCost,
  type BusinessId,
  type Clock,
  type FairUseLimits,
  type FairUseReading,
  type FairUseSource,
  type Instant,
  type LocalDate,
  type MicroShekels,
  type Money,
  type Plan,
  type UsageCost,
} from "@tor-now/domain";
import type { Repositories } from "../ports/repositories.ts";
import type { Actor, UnitOfWork } from "../ports/unit-of-work.ts";
import { requireAdministrator } from "./authorization.ts";
import {
  costedBusinesses,
  monthSpan,
  platformDayStart,
  platformToday,
  pricedBetween,
  pricedDays,
  type CostedRow,
  type MonthSpan,
} from "./cost-reading.ts";

/**
 * Fair Use (ADR 0023): limits that only alert, and who is over one — worked
 * out from this month's usage every time an administrator looks. Nothing about
 * a Business being over is stored, so there is no status to clear and a new
 * month starts clean on its own. No job runs any of this.
 */

export type OverBusiness = {
  readonly businessId: BusinessId;
  readonly name: string;
  readonly plan: Plan;
  readonly cost: MicroShekels;
  readonly whatsapp: number;
  readonly smsMessages: number;
};

export type SourceFairUse = {
  readonly source: FairUseSource;
  readonly limit: Money;
  /** The Business that spent the most on this cause this month; null when none spent anything. */
  readonly top: { readonly businessId: BusinessId; readonly name: string; readonly cost: MicroShekels } | null;
  /** Everyone over the limit, the most first. */
  readonly over: readonly OverBusiness[];
};

export type SignInReading = {
  readonly today: number;
  readonly cost: MicroShekels;
  readonly limit: number;
  readonly over: boolean;
  /** Codes per day over the thirty days before today, to one decimal. */
  readonly averagePerDay: number;
};

export type FairUseView = {
  readonly span: MonthSpan;
  readonly limits: FairUseLimits;
  readonly signIn: SignInReading;
  readonly sources: readonly SourceFairUse[];
};

/** What the banner on the Businesses tab says, and nothing more. */
export type FairUseAlerts = {
  readonly businessesOver: number;
  readonly sourcesOver: readonly FairUseSource[];
  readonly signIn: { readonly today: number; readonly limit: number; readonly over: boolean };
};

export type BusinessUsage = {
  readonly span: MonthSpan;
  readonly readings: readonly FairUseReading[];
  readonly whatsapp: number;
  readonly smsMessages: number;
  readonly total: MicroShekels;
  readonly unpricedUnits: number;
  /** What it pays a month, to compare the cost with. */
  readonly monthlyPrice: Money;
};

/** The days the average of sign-in codes is taken over. */
export const SIGN_IN_AVERAGE_DAYS = 30;

const codesIn = (usage: UsageCost): number => {
  const signIn = sourceCost(usage, "SIGN_IN");
  return signIn.whatsapp + signIn.smsMessages;
};

const signInReading = async (
  repositories: Repositories,
  limits: FairUseLimits,
  today: LocalDate,
  now: Instant,
): Promise<SignInReading> => {
  const startOfToday = platformDayStart(today);
  const [todays, before] = await Promise.all([
    pricedBetween(repositories, startOfToday, now, now),
    pricedBetween(repositories, platformDayStart(addDays(today, -SIGN_IN_AVERAGE_DAYS)), startOfToday, now),
  ]);
  const codes = codesIn(todays.platform);
  return {
    today: codes,
    cost: sourceCost(todays.platform, "SIGN_IN").cost,
    limit: limits.signInPerDay,
    over: signInOver(codes, limits),
    averagePerDay: Math.round((codesIn(before.platform) / SIGN_IN_AVERAGE_DAYS) * 10) / 10,
  };
};

const sourceView = (source: FairUseSource, rows: readonly CostedRow[], limits: FairUseLimits): SourceFairUse => {
  const spent = rows
    .map((row) => ({ row, cost: sourceCost(row.usage, source) }))
    .filter((one) => one.cost.cost > 0)
    .sort((a, b) => b.cost.cost - a.cost.cost);
  const top = spent[0];
  return {
    source,
    limit: limits.perBusiness[source],
    top: top === undefined ? null : { businessId: top.row.businessId, name: top.row.name, cost: top.cost.cost },
    over: spent
      .filter((one) => overLimits(one.row.usage, limits).includes(source))
      .map(({ row, cost }) => ({
        businessId: row.businessId,
        name: row.name,
        plan: row.plan,
        cost: cost.cost,
        whatsapp: cost.whatsapp,
        smsMessages: cost.smsMessages,
      })),
  };
};

export const fairUseService = ({ unitOfWork, clock }: { unitOfWork: UnitOfWork; clock: Clock }) => {
  /** This month so far: every Business costed, and the limits as they are now. */
  const thisMonth = async (repositories: Repositories, today: LocalDate) => {
    const span = monthSpan(null, today);
    const [priced, limits] = await Promise.all([
      pricedDays(repositories, span.first, span.through, clock.now()),
      repositories.fairUseLimits.get(),
    ]);
    return { span, limits, rows: await costedBusinesses(repositories, priced, today) };
  };

  const view = async (repositories: Repositories): Promise<FairUseView> => {
    const today = platformToday(clock);
    const { span, limits, rows } = await thisMonth(repositories, today);
    return {
      span,
      limits,
      signIn: await signInReading(repositories, limits, today, clock.now()),
      sources: FAIR_USE_SOURCES.map((source) => sourceView(source, rows, limits)),
    };
  };

  return {
    async fairUse(actor: Actor): Promise<FairUseView> {
      requireAdministrator(actor);
      return unitOfWork.run(actor, ({ repositories }) => view(repositories));
    },

    async alerts(actor: Actor): Promise<FairUseAlerts> {
      requireAdministrator(actor);
      return unitOfWork.run(actor, async ({ repositories }) => {
        const { sources, signIn } = await view(repositories);
        const over = new Set(sources.flatMap((source) => source.over.map((business) => business.businessId)));
        return {
          businessesOver: over.size,
          sourcesOver: sources.filter((source) => source.over.length > 0).map((source) => source.source),
          signIn: { today: signIn.today, limit: signIn.limit, over: signIn.over },
        };
      });
    },

    async setBusinessLimit(actor: Actor, source: FairUseSource, amountMinor: number): Promise<FairUseView> {
      requireAdministrator(actor);
      const amount = checkBusinessLimit(amountMinor);
      return unitOfWork.run(actor, async ({ repositories }) => {
        await repositories.fairUseLimits.setBusinessLimit(source, amount);
        return view(repositories);
      });
    },

    async setSignInLimit(actor: Actor, codesPerDay: number): Promise<FairUseView> {
      requireAdministrator(actor);
      const codes = checkSignInLimit(codesPerDay);
      return unitOfWork.run(actor, async ({ repositories }) => {
        await repositories.fairUseLimits.setSignInLimit(codes);
        return view(repositories);
      });
    },

    /** One Business's month so far, against every limit. */
    async businessUsage(actor: Actor, businessId: BusinessId): Promise<BusinessUsage> {
      requireAdministrator(actor);
      return unitOfWork.run(actor, async ({ repositories }) => {
        const { span, limits, rows } = await thisMonth(repositories, platformToday(clock));
        const row = rows.find((candidate) => candidate.businessId === businessId);
        if (row === undefined) throw notFound("Business", businessId);
        return {
          span,
          readings: readingsOf(row.usage, limits),
          whatsapp: row.usage.whatsapp,
          smsMessages: row.usage.smsMessages,
          total: row.usage.total,
          unpricedUnits: row.usage.unpricedUnits,
          monthlyPrice: row.monthlyPrice,
        };
      });
    },
  };
};
