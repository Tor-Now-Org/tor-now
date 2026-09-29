import type { RunningCostId } from "../model/ids.ts";
import { money, type Money } from "../model/money.ts";
import { validationFailed } from "../shared/errors.ts";
import { addDays, compareLocalDate, type LocalDate } from "../time/local-date.ts";
import { MAX_RATE_DAYS_AHEAD, MICRO_SHEKELS_PER_AGORA, microShekels, RATE_SOURCE_LENGTH, type MicroShekels } from "./cost.ts";
import type { UsageCost } from "./usage-cost.ts";

/**
 * Platform Costs (docs/billing/CONTEXT.md): what the platform pays that no
 * Business caused. Sign-in codes are measured, from Usage Records; running
 * costs — hosting, the website, a phone number — are entered by hand, each a
 * monthly amount from a day with where the figure came from, like a Unit Rate.
 * A change is a new amount from a day; what was there stays.
 */

export type RunningCostAmount = {
  readonly effectiveFrom: LocalDate;
  /** A month's worth, in agorot. Zero from a day means it stopped. */
  readonly amount: Money;
  /** The invoice, the plan's page: where the figure came from. */
  readonly source: string;
};

export type RunningCost = {
  readonly id: RunningCostId;
  readonly name: string;
  /** Oldest first. */
  readonly amounts: readonly RunningCostAmount[];
};

export const RUNNING_COST_NAME = { min: 2, max: 60 } as const;
/** ₪100,000 a month: far above any bill, and a guard against a slipped decimal point. */
export const MAX_RUNNING_COST_MINOR = 10_000_000;

/** A name for a new running cost: required, and not one already in the list. */
export const checkRunningCostName = (name: string, existing: readonly string[]): string => {
  const trimmed = name.trim();
  if (trimmed.length < RUNNING_COST_NAME.min || trimmed.length > RUNNING_COST_NAME.max) {
    throw validationFailed("A running cost needs a name of 2 to 60 characters", { field: "name" });
  }
  if (existing.some((other) => other.trim().toLocaleLowerCase() === trimmed.toLocaleLowerCase())) {
    throw validationFailed("A running cost with this name is already listed", { field: "name" });
  }
  return trimmed;
};

/**
 * An amount as an administrator enters it: whole agorot, zero to stop it, from
 * a day no further ahead than a Unit Rate may be, and with its evidence.
 */
export const checkRunningCostAmount = (input: RunningCostAmount, today: LocalDate): RunningCostAmount => {
  if (!Number.isInteger(input.amount) || input.amount < 0 || input.amount > MAX_RUNNING_COST_MINOR) {
    throw validationFailed("A monthly amount is whole agorot, from zero to ₪100,000", { field: "amountMinor" });
  }
  if (compareLocalDate(input.effectiveFrom, addDays(today, MAX_RATE_DAYS_AHEAD)) > 0) {
    throw validationFailed("An amount starts at most a year ahead", { field: "effectiveFrom" });
  }
  const source = input.source.trim();
  if (source.length < RATE_SOURCE_LENGTH.min || source.length > RATE_SOURCE_LENGTH.max) {
    throw validationFailed("An amount says where its figure came from", { field: "source" });
  }
  return { effectiveFrom: input.effectiveFrom, amount: money(input.amount), source };
};

/** The amount in force on a day: the latest that had started, or none yet. */
export const amountOn = (cost: RunningCost, day: LocalDate): RunningCostAmount | null =>
  cost.amounts.reduce<RunningCostAmount | null>(
    (latest, amount) =>
      compareLocalDate(amount.effectiveFrom, day) <= 0 &&
      (latest === null || compareLocalDate(amount.effectiveFrom, latest.effectiveFrom) > 0)
        ? amount
        : latest,
    null,
  );

/** A running cost as a month counts it: the amount in force on the span's last day. */
export type RunningCostLine = {
  readonly id: RunningCostId;
  readonly name: string;
  readonly amount: Money;
  readonly since: LocalDate;
  readonly source: string;
};

export type PlatformCost = {
  readonly signIn: {
    readonly codes: number;
    readonly cost: MicroShekels;
    readonly unpricedUnits: number;
  };
  /** Only those with an amount above zero on the day. */
  readonly running: readonly RunningCostLine[];
  readonly total: MicroShekels;
  /** The total over the paying Businesses: what every price has to cover. Null with none paying. */
  readonly perPaying: MicroShekels | null;
};

export const runningOn = (costs: readonly RunningCost[], day: LocalDate): readonly RunningCostLine[] =>
  costs.flatMap((cost) => {
    const amount = amountOn(cost, day);
    return amount === null || amount.amount === 0
      ? []
      : [{ id: cost.id, name: cost.name, amount: amount.amount, since: amount.effectiveFrom, source: amount.source }];
  });

/**
 * A span's Platform Cost. Sign-in codes are what was sent in the span; each
 * running cost counts a whole month at the amount in force on `day`, the
 * span's last day — the way the bill for it arrives.
 */
export const platformCost = (input: {
  readonly usage: UsageCost;
  readonly running: readonly RunningCost[];
  readonly day: LocalDate;
  readonly paying: number;
}): PlatformCost => {
  const running = runningOn(input.running, input.day);
  const signIn = input.usage.bySource.SIGN_IN;
  const signInCost = signIn?.cost ?? microShekels(0);
  const total = microShekels(
    signInCost + running.reduce((sum, line) => sum + line.amount * MICRO_SHEKELS_PER_AGORA, 0),
  );
  return {
    signIn: {
      codes: (signIn?.whatsapp ?? 0) + (signIn?.smsMessages ?? 0),
      cost: signInCost,
      unpricedUnits: signIn?.unpricedUnits ?? 0,
    },
    running,
    total,
    perPaying: input.paying === 0 ? null : microShekels(Math.round(total / input.paying)),
  };
};
