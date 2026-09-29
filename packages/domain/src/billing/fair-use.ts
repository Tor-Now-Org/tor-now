import { money, type Money } from "../model/money.ts";
import { validationFailed } from "../shared/errors.ts";
import { MICRO_SHEKELS_PER_AGORA, type MicroShekels } from "./cost.ts";
import { sourceCost, type UsageCost } from "./usage-cost.ts";

/**
 * Fair Use Limits (docs/billing/CONTEXT.md): internal ceilings, well above
 * what a busy Business spends, that only ever alert. Whether one is crossed is
 * read from the usage when an administrator looks — never stored, so there is
 * nothing to clear, and a new month or a changed limit needs nothing done.
 */

/** The causes that cost money a Business could run up: a limit each, per Business, per month. */
export const FAIR_USE_SOURCES = ["BOOKING", "REMINDERS", "WAITING_LIST"] as const;
export type FairUseSource = (typeof FAIR_USE_SOURCES)[number];

export type FairUseLimits = {
  /** Per Business, per calendar month, in agorot. */
  readonly perBusiness: Readonly<Record<FairUseSource, Money>>;
  /** Sign-in codes across the whole platform, per day in Israel. */
  readonly signInPerDay: number;
};

/** ₪100,000: far above any Business, and a guard against a slipped decimal point. */
export const MAX_BUSINESS_LIMIT_MINOR = 10_000_000;
export const MAX_SIGN_IN_PER_DAY = 1_000_000;

export const isFairUseSource = (value: string): value is FairUseSource =>
  (FAIR_USE_SOURCES as readonly string[]).includes(value);

export const checkBusinessLimit = (amountMinor: number): Money => {
  if (!Number.isInteger(amountMinor) || amountMinor < 1 || amountMinor > MAX_BUSINESS_LIMIT_MINOR) {
    throw validationFailed("A limit is a whole number of agorot, above zero and at most ₪100,000", {
      field: "amountMinor",
    });
  }
  return money(amountMinor);
};

export const checkSignInLimit = (codesPerDay: number): number => {
  if (!Number.isInteger(codesPerDay) || codesPerDay < 1 || codesPerDay > MAX_SIGN_IN_PER_DAY) {
    throw validationFailed("A daily limit is a whole number of codes, at least one", { field: "codesPerDay" });
  }
  return codesPerDay;
};

const limitInMicro = (limit: Money): number => limit * MICRO_SHEKELS_PER_AGORA;

/** One cause against its limit. Over means strictly more than the limit. */
export type FairUseReading = {
  readonly source: FairUseSource;
  readonly limit: Money;
  readonly cost: MicroShekels;
  readonly over: boolean;
};

export const readingsOf = (usage: UsageCost, limits: FairUseLimits): readonly FairUseReading[] =>
  FAIR_USE_SOURCES.map((source) => {
    const cost = sourceCost(usage, source).cost;
    const limit = limits.perBusiness[source];
    return { source, limit, cost, over: cost > limitInMicro(limit) };
  });

/** The causes a Business is over this month, in FAIR_USE_SOURCES order. */
export const overLimits = (usage: UsageCost, limits: FairUseLimits): readonly FairUseSource[] =>
  readingsOf(usage, limits)
    .filter((reading) => reading.over)
    .map((reading) => reading.source);

export const signInOver = (codesToday: number, limits: FairUseLimits): boolean => codesToday > limits.signInPerDay;
