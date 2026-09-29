import type { BusinessId, ReferenceBusinessId } from "../model/ids.ts";
import type { Money } from "../model/money.ts";
import { validationFailed } from "../shared/errors.ts";
import type { LocalDate } from "../time/local-date.ts";
import { MICRO_SHEKELS_PER_AGORA, microShekels, type CostUnit, type MicroShekels } from "./cost.ts";
import type { Plan } from "./plan.ts";
import { BUSINESS_MESSAGE_SOURCES, sourceCost, type BusinessMessageSource, type UsageCost } from "./usage-cost.ts";

/**
 * The Cost Calculator: what a Business costs from what it sends, in the units a
 * provider bills — WhatsApp messages, and SMS priced by their measured number
 * of parts. Pure, so the administrator's screen and the API compute alike.
 */

export type MessageCount = { readonly whatsapp: number; readonly sms: number };

/** A month of one Business's messages, by cause, and how many calendars it keeps. */
export type CalculatorUse = { readonly calendars: number } & Readonly<Record<BusinessMessageSource, MessageCount>>;

export type CalculatorRates = {
  /** Per WhatsApp utility message; null when no rate is in force. */
  readonly whatsapp: MicroShekels | null;
  /** Per SMS part; null when no rate is in force. */
  readonly smsPart: MicroShekels | null;
  /** Measured from the SMS sent: a Hebrew message is 70 characters a part. */
  readonly partsPerSms: number;
};

export type CalculatorPlan = { readonly plan: Plan; readonly price: Money; readonly allowance: number };

export type PlanMargin = {
  readonly plan: Plan;
  readonly price: Money;
  readonly allowance: number;
  /** Whether a Business with these calendars can be on the Plan at all. */
  readonly fits: boolean;
  readonly margin: number;
  readonly marginAfterShare: number | null;
};

export type CalculatorResult = {
  readonly bySource: Readonly<Record<BusinessMessageSource, MicroShekels>>;
  readonly total: MicroShekels;
  readonly smsMessages: number;
  readonly smsCost: MicroShekels;
  readonly margins: readonly PlanMargin[];
  /** Units with no rate in force: their messages are counted at nothing, and said so. */
  readonly missingRates: readonly CostUnit[];
};

/** Parts per SMS when none has been sent to measure from: a Hebrew message is usually two. */
export const DEFAULT_PARTS_PER_SMS = 2;
export const MAX_MESSAGES = 1_000_000;
export const MAX_CALENDARS = 100;

const smsPrice = (rates: CalculatorRates): number => (rates.smsPart ?? 0) * rates.partsPerSms;

export const calculate = (input: {
  readonly use: CalculatorUse;
  readonly rates: CalculatorRates;
  readonly plans: readonly CalculatorPlan[];
  /** The Platform Cost per paying Business; null with none paying. */
  readonly share: MicroShekels | null;
}): CalculatorResult => {
  const { use, rates } = input;
  const costOf = (count: MessageCount): number => count.whatsapp * (rates.whatsapp ?? 0) + count.sms * smsPrice(rates);
  const bySource = Object.fromEntries(
    BUSINESS_MESSAGE_SOURCES.map((source) => [source, microShekels(Math.round(costOf(use[source])))]),
  ) as Record<BusinessMessageSource, MicroShekels>;
  const total = BUSINESS_MESSAGE_SOURCES.reduce((sum, source) => sum + bySource[source], 0);
  const smsMessages = BUSINESS_MESSAGE_SOURCES.reduce((sum, source) => sum + use[source].sms, 0);
  const margin = (price: Money, cost: number): number => {
    const revenue = price * MICRO_SHEKELS_PER_AGORA;
    return revenue === 0 ? 0 : (revenue - cost) / revenue;
  };
  return {
    bySource,
    total: microShekels(total),
    smsMessages,
    smsCost: microShekels(Math.round(smsMessages * smsPrice(rates))),
    margins: input.plans.map((plan) => ({
      plan: plan.plan,
      price: plan.price,
      allowance: plan.allowance,
      fits: use.calendars <= plan.allowance,
      margin: margin(plan.price, total),
      marginAfterShare: input.share === null ? null : margin(plan.price, total + input.share),
    })),
    missingRates: [
      ...(rates.whatsapp === null ? (["WHATSAPP_UTILITY"] as const) : []),
      ...(rates.smsPart === null ? (["SMS_SEGMENT"] as const) : []),
    ],
  };
};

const checkCount = (value: number, field: string): number => {
  if (!Number.isInteger(value) || value < 0 || value > MAX_MESSAGES) {
    throw validationFailed("A count of messages is a whole number from zero to a million", { field });
  }
  return value;
};

/** Whole numbers only: a month's messages, and at least one calendar. */
export const checkCalculatorUse = (use: CalculatorUse): CalculatorUse => {
  if (!Number.isInteger(use.calendars) || use.calendars < 1 || use.calendars > MAX_CALENDARS) {
    throw validationFailed("Calendars are a whole number from 1 to 100", { field: "calendars" });
  }
  return {
    calendars: use.calendars,
    ...(Object.fromEntries(
      BUSINESS_MESSAGE_SOURCES.map((source) => [
        source,
        {
          whatsapp: checkCount(use[source].whatsapp, `${source}.whatsapp`),
          sms: checkCount(use[source].sms, `${source}.sms`),
        },
      ]),
    ) as Record<BusinessMessageSource, MessageCount>),
  };
};

/** A Business saved as an example to price from, and shared by every administrator. */
export type ReferenceBusiness = {
  readonly id: ReferenceBusinessId;
  readonly name: string;
  readonly use: CalculatorUse;
  readonly savedOn: LocalDate;
};

export const REFERENCE_NAME = { min: 2, max: 30 } as const;
export const MAX_REFERENCE_BUSINESSES = 8;

/** Required, fits on a chip, and not another saved one's name. */
export const checkReferenceName = (
  name: string,
  others: readonly { readonly id: ReferenceBusinessId; readonly name: string }[],
  exceptId: ReferenceBusinessId | null = null,
): string => {
  const trimmed = name.trim();
  if (trimmed.length < REFERENCE_NAME.min || trimmed.length > REFERENCE_NAME.max) {
    throw validationFailed("A name is 2 to 30 characters", { field: "name" });
  }
  const taken = others.some(
    (other) => other.id !== exceptId && other.name.trim().toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
  );
  if (taken) throw validationFailed("Another saved Business has this name", { field: "name" });
  return trimmed;
};

export const checkReferenceRoom = (saved: number): void => {
  if (saved >= MAX_REFERENCE_BUSINESSES) {
    throw validationFailed("At most 8 Businesses can be saved; delete one first", { field: "name" });
  }
};

/** One Business's month of messages, as the calculator counts them. */
export const useOf = (usage: UsageCost, calendars: number): CalculatorUse => ({
  calendars: Math.max(1, calendars),
  ...(Object.fromEntries(
    BUSINESS_MESSAGE_SOURCES.map((source) => {
      const cost = sourceCost(usage, source);
      return [source, { whatsapp: cost.whatsapp, sms: cost.smsMessages }];
    }),
  ) as Record<BusinessMessageSource, MessageCount>),
});

/** The average of several, rounded to whole messages and calendars. Null with none. */
export const averageUse = (uses: readonly CalculatorUse[]): CalculatorUse | null => {
  if (uses.length === 0) return null;
  const mean = (pick: (use: CalculatorUse) => number): number =>
    Math.round(uses.reduce((sum, use) => sum + pick(use), 0) / uses.length);
  return {
    calendars: Math.max(1, mean((use) => use.calendars)),
    ...(Object.fromEntries(
      BUSINESS_MESSAGE_SOURCES.map((source) => [
        source,
        { whatsapp: mean((use) => use[source].whatsapp), sms: mean((use) => use[source].sms) },
      ]),
    ) as Record<BusinessMessageSource, MessageCount>),
  };
};

/** Parts per SMS as measured, to one decimal; the default when no SMS went out. */
export const partsPerSmsOf = (usage: readonly UsageCost[]): number => {
  const messages = usage.reduce((sum, one) => sum + one.smsMessages, 0);
  const parts = usage.reduce((sum, one) => sum + one.smsParts, 0);
  return messages === 0 ? DEFAULT_PARTS_PER_SMS : Math.round((parts / messages) * 10) / 10;
};

/** The measured example of the Business that cost the most in the span. */
export type MeasuredExample = {
  readonly use: CalculatorUse;
  /** How many paying Businesses the average is over, or the one Business it is. */
  readonly over: number;
  readonly business: { readonly id: BusinessId; readonly name: string } | null;
};
