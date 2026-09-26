import type { BusinessId } from "../model/ids.ts";
import { validationFailed } from "../shared/errors.ts";
import type { Instant } from "../time/instant.ts";
import { compareLocalDate, type LocalDate } from "../time/local-date.ts";
import type { Feature } from "./feature.ts";

/**
 * What the platform pays for on a Business's behalf, kept as two separate
 * facts (docs/billing/CONTEXT.md). A Usage Record says what happened — a
 * message sent, in so many billable units. A Unit Rate says what one unit cost
 * from a given day, and where that figure came from. The cost is worked out
 * from the two when it is read, never stored: a rate checked by hand later,
 * or corrected backwards, prices everything it covers without rewriting a row.
 */

/**
 * A message costs a few agorot and a fraction; `Money` holds whole agorot. So a
 * cost is held in millionths of a shekel, and rounded only when shown.
 */
export type MicroShekels = number & { readonly __brand: "MicroShekels" };

export const MICRO_SHEKELS_PER_AGORA = 10_000;

export const microShekels = (value: number): MicroShekels => {
  if (!Number.isInteger(value) || value < 0) {
    throw validationFailed(`A cost is a whole, non-negative number of micro-shekels, got ${value}`);
  }
  return value as MicroShekels;
};

export const toAgorot = (amount: MicroShekels): number =>
  Math.round(amount / MICRO_SHEKELS_PER_AGORA);

/** What a provider bills by. */
export const COST_UNITS = ["WHATSAPP_UTILITY", "WHATSAPP_AUTHENTICATION", "SMS_SEGMENT"] as const;
export type CostUnit = (typeof COST_UNITS)[number];

/**
 * What caused a usage: a Feature, or one of the two things every Business has —
 * the messages that make a booking a booking, and signing in.
 */
export type CostSource = "BOOKING" | "SIGN_IN" | Feature;

/** One billable thing that happened. Holds no price. */
export type UsageRecord = {
  /** Null for usage no Business caused, such as signing a person in. */
  readonly businessId: BusinessId | null;
  readonly source: CostSource;
  readonly unit: CostUnit;
  readonly quantity: number;
  readonly occurredAt: Instant;
};

/**
 * What one unit cost from `effectiveFrom` until the next rate for the same
 * unit, and the evidence for the figure. Entered by hand, never guessed.
 */
export type UnitRate = {
  readonly unit: CostUnit;
  readonly effectiveFrom: LocalDate;
  readonly perUnit: MicroShekels;
  /** Where the figure was checked: a rate card's address, an invoice. */
  readonly source: string;
};

export const costOf = (perUnit: MicroShekels, quantity: number): MicroShekels => {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw validationFailed(`A cost is for at least one whole unit, got ${quantity}`);
  }
  return microShekels(perUnit * quantity);
};

/** The rate in force for a unit on a day: the latest one that had started. */
export const rateOn = (
  rates: readonly UnitRate[],
  unit: CostUnit,
  day: LocalDate,
): UnitRate | null =>
  rates
    .filter((rate) => rate.unit === unit && compareLocalDate(rate.effectiveFrom, day) <= 0)
    .reduce<UnitRate | null>(
      (latest, rate) =>
        latest === null || compareLocalDate(rate.effectiveFrom, latest.effectiveFrom) > 0 ? rate : latest,
      null,
    );

/** Usage of one unit on one day, as it is added up for pricing. */
export type DailyUsage = {
  readonly unit: CostUnit;
  readonly day: LocalDate;
  readonly quantity: number;
};

/**
 * Prices usage by the rate in force on each day. What no rate covers is
 * counted apart as unpriced, so a figure never looks complete when it is not —
 * and never reads as free.
 */
export const priceUsage = (
  usage: readonly DailyUsage[],
  rates: readonly UnitRate[],
): { readonly priced: MicroShekels; readonly unpricedQuantity: number } =>
  usage.reduce(
    (total, line) => {
      const rate = rateOn(rates, line.unit, line.day);
      return rate === null
        ? { ...total, unpricedQuantity: total.unpricedQuantity + line.quantity }
        : { ...total, priced: microShekels(total.priced + costOf(rate.perUnit, line.quantity)) };
    },
    { priced: microShekels(0), unpricedQuantity: 0 },
  );

const GSM_SINGLE = 160;
const GSM_PART = 153;
const UNICODE_SINGLE = 70;
const UNICODE_PART = 67;

/**
 * Characters outside the GSM 03.38 basic set push a whole message into UCS-2,
 * which is every Hebrew message — the difference between one segment and three.
 */
const GSM_BASIC =
  /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà]*$/;

/** How many SMS segments a text is billed as. */
export const smsSegments = (text: string): number => {
  const unicode = !GSM_BASIC.test(text);
  const length = [...text].length;
  const [single, part] = unicode ? [UNICODE_SINGLE, UNICODE_PART] : [GSM_SINGLE, GSM_PART];
  return length <= single ? 1 : Math.ceil(length / part);
};
