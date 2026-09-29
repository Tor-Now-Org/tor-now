import {
  addDays,
  averageUse,
  checkCalculatorUse,
  checkReferenceName,
  checkReferenceRoom,
  checkRunningCostAmount,
  checkRunningCostName,
  isPaying,
  overLimits,
  partsPerSmsOf,
  rateOn,
  useOf,
  type BusinessId,
  type CalculatorPlan,
  type CalculatorRates,
  type CalculatorUse,
  type Clock,
  type CostStats,
  type Instant,
  type LocalDate,
  type MeasuredExample,
  type MicroShekels,
  type PlanVersion,
  type PlatformCost,
  type ReferenceBusiness,
  type ReferenceBusinessId,
  type RunningCost,
  type RunningCostAmount,
  type RunningCostId,
  type UnpricedUsage,
} from "@tor-now/domain";
import type { Repositories } from "../ports/repositories.ts";
import type { Actor, UnitOfWork } from "../ports/unit-of-work.ts";
import { requireAdministrator } from "./authorization.ts";
import { costedBusinesses, monthFigures, monthSpan, platformToday, pricedDays, type MonthSpan } from "./cost-reading.ts";

/**
 * The Catalogue's Cost tab (ADR 0023): what each Plan and the platform cost in
 * a month, the Cost Calculator with its measured and saved examples, and the
 * running costs an administrator enters. Reads work everything out from the
 * Usage Records; writes are audited by the repositories' decorator.
 */

export type MonthCosts = {
  readonly span: MonthSpan;
  readonly platform: PlatformCost;
  readonly stats: CostStats;
  readonly unpriced: readonly UnpricedUsage[];
  /** Businesses over a Fair Use Limit in the month, worked out now. */
  readonly overLimit: readonly BusinessId[];
  /** Each Plan's current price and allowance, to read the figures against. */
  readonly plans: readonly CalculatorPlan[];
};

/** What the calculator starts from: today's rates and prices, and every example. */
export type CalculatorBasis = {
  readonly rates: CalculatorRates;
  readonly plans: readonly CalculatorPlan[];
  /** This month's Platform Cost per paying Business; null with none paying. */
  readonly share: MicroShekels | null;
  /** The last 30 days, per paying Business. Null with none paying. */
  readonly actualAverage: MeasuredExample | null;
  /** The paying Business that cost the most in the last 30 days. Null when none cost anything. */
  readonly mostExpensive: MeasuredExample | null;
  readonly saved: readonly ReferenceBusiness[];
};

/** A Plan as its current edition prices it. */
const currentPlan = (version: PlanVersion): CalculatorPlan => ({
  plan: version.plan,
  price: version.terms.price,
  allowance: version.terms.resourceAllowance,
});

/** How far back the measured examples look. */
export const MEASURED_DAYS = 30;

const measuredExamples = async (repositories: Repositories, today: LocalDate, now: Instant) => {
  const priced = await pricedDays(repositories, addDays(today, -(MEASURED_DAYS - 1)), today, now);
  const paying = (await costedBusinesses(repositories, priced, today)).filter((row) => isPaying(row.status));
  const average = averageUse(paying.map((row) => useOf(row.usage, row.calendars)));
  const top = paying.reduce<(typeof paying)[number] | null>(
    (best, row) => (row.usage.total > 0 && (best === null || row.usage.total > best.usage.total) ? row : best),
    null,
  );
  return {
    priced,
    actualAverage: average === null ? null : { use: average, over: paying.length, business: null },
    mostExpensive:
      top === null ? null : { use: useOf(top.usage, top.calendars), over: 1, business: { id: top.businessId, name: top.name } },
  };
};

export const costService = ({ unitOfWork, clock }: { unitOfWork: UnitOfWork; clock: Clock }) => {
  /** Every saved Business after a change, for the screen to show at once. */
  const savedAfter = (actor: Actor, work: (repositories: Repositories) => Promise<unknown>) =>
    unitOfWork.run(actor, async ({ repositories }) => {
      await work(repositories);
      return repositories.referenceBusinesses.list();
    });

  const costsAfter = (actor: Actor, work: (repositories: Repositories) => Promise<unknown>) =>
    unitOfWork.run(actor, async ({ repositories }) => {
      await work(repositories);
      return repositories.runningCosts.list();
    });

  return {
    async month(actor: Actor, first: LocalDate | null): Promise<MonthCosts> {
      requireAdministrator(actor);
      const span = monthSpan(first, platformToday(clock));
      return unitOfWork.run(actor, async ({ repositories }) => {
        const [figures, limits, current] = await Promise.all([
          monthFigures(repositories, span, clock.now()),
          repositories.fairUseLimits.get(),
          repositories.planVersions.listCurrent(),
        ]);
        return {
          span,
          plans: current.map(currentPlan),
          platform: figures.platform,
          stats: figures.stats,
          unpriced: figures.priced.unpriced,
          overLimit: figures.businesses
            .filter((row) => overLimits(row.usage, limits).length > 0)
            .map((row) => row.businessId),
        };
      });
    },

    async calculator(actor: Actor): Promise<CalculatorBasis> {
      requireAdministrator(actor);
      const today = platformToday(clock);
      return unitOfWork.run(actor, async ({ repositories }) => {
        const [examples, figures, current, saved] = await Promise.all([
          measuredExamples(repositories, today, clock.now()),
          monthFigures(repositories, monthSpan(null, today), clock.now()),
          repositories.planVersions.listCurrent(),
          repositories.referenceBusinesses.list(),
        ]);
        const { priced } = examples;
        return {
          rates: {
            whatsapp: rateOn(priced.rates, "WHATSAPP_UTILITY", today)?.perUnit ?? null,
            smsPart: rateOn(priced.rates, "SMS_SEGMENT", today)?.perUnit ?? null,
            partsPerSms: partsPerSmsOf([...priced.businesses.values(), priced.platform]),
          },
          plans: current.map(currentPlan),
          share: figures.platform.perPaying,
          actualAverage: examples.actualAverage,
          mostExpensive: examples.mostExpensive,
          saved,
        };
      });
    },

    async saveReference(actor: Actor, input: { name: string; use: CalculatorUse }): Promise<readonly ReferenceBusiness[]> {
      const administratorId = requireAdministrator(actor);
      const use = checkCalculatorUse(input.use);
      return savedAfter(actor, async (repositories) => {
        const saved = await repositories.referenceBusinesses.list();
        const name = checkReferenceName(input.name, saved);
        checkReferenceRoom(saved.length);
        await repositories.referenceBusinesses.create({ name, use, savedOn: platformToday(clock), savedBy: administratorId });
      });
    },

    async updateReference(actor: Actor, id: ReferenceBusinessId, input: { use: CalculatorUse }) {
      const administratorId = requireAdministrator(actor);
      const use = checkCalculatorUse(input.use);
      return savedAfter(actor, (repositories) =>
        repositories.referenceBusinesses.update(id, { use, savedOn: platformToday(clock), savedBy: administratorId }),
      );
    },

    async renameReference(actor: Actor, id: ReferenceBusinessId, input: { name: string }) {
      requireAdministrator(actor);
      return savedAfter(actor, async (repositories) => {
        const name = checkReferenceName(input.name, await repositories.referenceBusinesses.list(), id);
        await repositories.referenceBusinesses.rename(id, name);
      });
    },

    async deleteReference(actor: Actor, id: ReferenceBusinessId) {
      requireAdministrator(actor);
      return savedAfter(actor, (repositories) => repositories.referenceBusinesses.delete(id));
    },

    async runningCosts(actor: Actor): Promise<readonly RunningCost[]> {
      requireAdministrator(actor);
      return unitOfWork.run(actor, ({ repositories }) => repositories.runningCosts.list());
    },

    async addRunningCost(actor: Actor, input: { name: string; amount: RunningCostAmount }) {
      const administratorId = requireAdministrator(actor);
      const amount = checkRunningCostAmount(input.amount, platformToday(clock));
      return costsAfter(actor, async (repositories) => {
        const existing = (await repositories.runningCosts.list()).map((cost) => cost.name);
        await repositories.runningCosts.create(checkRunningCostName(input.name, existing), amount, administratorId);
      });
    },

    async setRunningCostAmount(actor: Actor, id: RunningCostId, input: RunningCostAmount) {
      const administratorId = requireAdministrator(actor);
      const amount = checkRunningCostAmount(input, platformToday(clock));
      return costsAfter(actor, (repositories) => repositories.runningCosts.setAmount(id, amount, administratorId));
    },
  };
};
