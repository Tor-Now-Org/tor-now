import type { BusinessId } from "../model/ids.ts";
import { compareLocalDate, type LocalDate } from "../time/local-date.ts";
import { costOf, microShekels, rateOn, type CostSource, type CostUnit, type MicroShekels, type UnitRate } from "./cost.ts";

/**
 * What usage cost, worked out when it is read (ADR 0022): the day's usage
 * priced by the Unit Rate in force on that day. Nothing here is stored — the
 * month's figures, the Fair Use readings and the calculator's measured
 * examples are all this, over a different span.
 */

/** The causes a Business's own messages have: the calculator's rows. */
export const BUSINESS_MESSAGE_SOURCES = ["BOOKING", "REMINDERS", "WAITING_LIST", "BILLING"] as const satisfies readonly CostSource[];
export type BusinessMessageSource = (typeof BUSINESS_MESSAGE_SOURCES)[number];

/**
 * Usage added up per Business, cause, unit and UTC day. `quantity` is what a
 * provider bills — SMS parts for an SMS — and `messages` how many were sent, so
 * an SMS's average number of parts can be measured rather than assumed.
 */
export type UsageDay = {
  /** Null for usage no Business caused: sign-in codes. */
  readonly businessId: BusinessId | null;
  readonly source: CostSource;
  readonly unit: CostUnit;
  readonly day: LocalDate;
  readonly quantity: number;
  readonly messages: number;
};

/** One cause's usage and what it cost. */
export type SourceCost = {
  readonly cost: MicroShekels;
  readonly whatsapp: number;
  readonly smsMessages: number;
  readonly smsParts: number;
  /** Units on days no rate covered: never counted as free, only apart. */
  readonly unpricedUnits: number;
};

export type UsageCost = {
  readonly bySource: Readonly<Partial<Record<CostSource, SourceCost>>>;
  readonly total: MicroShekels;
  readonly whatsapp: number;
  readonly smsMessages: number;
  readonly smsParts: number;
  readonly unpricedUnits: number;
};

/** Usage of a unit no rate covered: how much, and from which day. */
export type UnpricedUsage = {
  readonly unit: CostUnit;
  readonly units: number;
  readonly messages: number;
  readonly from: LocalDate;
};

export const NO_SOURCE_COST: SourceCost = Object.freeze({
  cost: microShekels(0),
  whatsapp: 0,
  smsMessages: 0,
  smsParts: 0,
  unpricedUnits: 0,
});

export const NO_USAGE_COST: UsageCost = Object.freeze({
  bySource: Object.freeze({}),
  total: microShekels(0),
  whatsapp: 0,
  smsMessages: 0,
  smsParts: 0,
  unpricedUnits: 0,
});

const isSms = (unit: CostUnit): boolean => unit === "SMS_SEGMENT";

const addToSource = (sum: SourceCost, line: UsageDay, cost: MicroShekels | null): SourceCost => ({
  cost: microShekels(sum.cost + (cost ?? 0)),
  whatsapp: sum.whatsapp + (isSms(line.unit) ? 0 : line.messages),
  smsMessages: sum.smsMessages + (isSms(line.unit) ? line.messages : 0),
  smsParts: sum.smsParts + (isSms(line.unit) ? line.quantity : 0),
  unpricedUnits: sum.unpricedUnits + (cost === null ? line.quantity : 0),
});

/** Adds one day's line to a running total, priced by the rate in force that day. */
const addLine = (sum: UsageCost, line: UsageDay, rates: readonly UnitRate[]): UsageCost => {
  const rate = rateOn(rates, line.unit, line.day);
  const cost = rate === null ? null : costOf(rate.perUnit, line.quantity);
  const source = addToSource(sum.bySource[line.source] ?? NO_SOURCE_COST, line, cost);
  return {
    bySource: { ...sum.bySource, [line.source]: source },
    total: microShekels(sum.total + (cost ?? 0)),
    whatsapp: sum.whatsapp + (isSms(line.unit) ? 0 : line.messages),
    smsMessages: sum.smsMessages + (isSms(line.unit) ? line.messages : 0),
    smsParts: sum.smsParts + (isSms(line.unit) ? line.quantity : 0),
    unpricedUnits: sum.unpricedUnits + (cost === null ? line.quantity : 0),
  };
};

/** What some usage cost, by cause. */
export const costOfUsage = (lines: readonly UsageDay[], rates: readonly UnitRate[]): UsageCost =>
  lines.reduce((sum, line) => addLine(sum, line, rates), NO_USAGE_COST);

export type UsageCosts = {
  /** Every Business that used anything in the span. */
  readonly businesses: ReadonlyMap<BusinessId, UsageCost>;
  /** What no Business caused: sign-in codes. */
  readonly platform: UsageCost;
  /** Per unit, what no rate covered and from which day. */
  readonly unpriced: readonly UnpricedUsage[];
};

const unpricedOf = (lines: readonly UsageDay[], rates: readonly UnitRate[]): readonly UnpricedUsage[] => {
  const byUnit = new Map<CostUnit, UnpricedUsage>();
  for (const line of lines) {
    if (rateOn(rates, line.unit, line.day) !== null) continue;
    const seen = byUnit.get(line.unit);
    byUnit.set(line.unit, {
      unit: line.unit,
      units: (seen?.units ?? 0) + line.quantity,
      messages: (seen?.messages ?? 0) + line.messages,
      from: seen === undefined || compareLocalDate(line.day, seen.from) < 0 ? line.day : seen.from,
    });
  }
  return [...byUnit.values()].sort((a, b) => a.unit.localeCompare(b.unit));
};

/** A span's usage, priced and split between the Businesses that caused it and the platform. */
export const costsOf = (lines: readonly UsageDay[], rates: readonly UnitRate[]): UsageCosts => {
  const byBusiness = new Map<BusinessId, UsageDay[]>();
  const platform: UsageDay[] = [];
  for (const line of lines) {
    if (line.businessId === null) {
      platform.push(line);
    } else {
      byBusiness.set(line.businessId, [...(byBusiness.get(line.businessId) ?? []), line]);
    }
  }
  return {
    businesses: new Map([...byBusiness].map(([id, own]) => [id, costOfUsage(own, rates)])),
    platform: costOfUsage(platform, rates),
    unpriced: unpricedOf(lines, rates),
  };
};

/** One cause's cost, zero when it caused nothing. */
export const sourceCost = (usage: UsageCost, source: CostSource): SourceCost =>
  usage.bySource[source] ?? NO_SOURCE_COST;
