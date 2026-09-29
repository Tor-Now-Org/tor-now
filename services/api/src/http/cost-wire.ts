import type { ReferenceBusiness, RunningCost } from "@tor-now/domain";
import type { CalculatorBasis, MonthCosts } from "../application/cost-service.ts";

/**
 * The Cost tab's responses (ADR 0023). Costs travel in micro-shekels, prices
 * and limits in agorot, days as YYYY-MM-DD — the interface rounds only when it
 * shows a figure.
 */

export const referenceBusinessOut = (saved: ReferenceBusiness) => ({
  id: saved.id,
  name: saved.name,
  use: saved.use,
  savedOn: saved.savedOn,
});

export const runningCostOut = (cost: RunningCost) => ({
  id: cost.id,
  name: cost.name,
  amounts: cost.amounts.map((amount) => ({
    effectiveFrom: amount.effectiveFrom,
    amountMinor: amount.amount,
    source: amount.source,
  })),
});

export const monthCostsOut = (month: MonthCosts) => ({
  month: month.span.first.slice(0, 7),
  through: month.span.through,
  current: month.span.current,
  platform: {
    signIn: month.platform.signIn,
    running: month.platform.running.map((line) => ({
      id: line.id,
      name: line.name,
      amountMinor: line.amount,
      since: line.since,
      source: line.source,
    })),
    total: month.platform.total,
    perPaying: month.platform.perPaying,
  },
  plans: month.stats.plans,
  prices: month.plans.map((plan) => ({ plan: plan.plan, priceMinor: plan.price, allowance: plan.allowance })),
  paying: month.stats.paying,
  trials: month.stats.trials,
  notPaying: month.stats.notPaying,
  unpriced: month.unpriced,
  overLimit: month.overLimit,
});

export const calculatorOut = (basis: CalculatorBasis) => ({
  rates: basis.rates,
  plans: basis.plans.map((plan) => ({ plan: plan.plan, priceMinor: plan.price, allowance: plan.allowance })),
  share: basis.share,
  actualAverage: basis.actualAverage,
  mostExpensive: basis.mostExpensive,
  saved: basis.saved.map(referenceBusinessOut),
});
