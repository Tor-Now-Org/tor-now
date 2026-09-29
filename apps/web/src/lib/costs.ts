import {
  microShekels,
  money,
  type CalculatorPlan,
  type CalculatorRates,
  type MicroShekels,
} from "@tor-now/domain";
import type { CalculatorBasisDto, CalculatorUseDto, CostSourceName, MessageSourceName } from "./api/cost-types.ts";
import { LOCALE } from "./format.ts";
import type { Language } from "./i18n/dictionaries.ts";

/**
 * What the Cost screens show (ADR 0023): costs to the agora, margins to the
 * percent, and the calculator's inputs from what the API sends.
 */

const MICRO_PER_SHEKEL = 1_000_000;
const MICRO_PER_AGORA = 10_000;

/** A cost to the agora: "₪18.21". Micro-shekels are rounded only here. */
export const formatCost = (micro: number, language: Language): string =>
  new Intl.NumberFormat(LOCALE[language], {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.round(micro / MICRO_PER_AGORA) / 100);

/** An amount in agorot: whole shekels without decimals ("₪120"), anything else to the agora ("₪92.50"). */
export const formatAgorot = (minor: number, language: Language): string =>
  new Intl.NumberFormat(LOCALE[language], {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);

/**
 * A margin as a whole percent, in the language's own form — so a margin below
 * zero reads "-18%" in a right-to-left sentence too — and "—" when there is none.
 */
export const formatMargin = (ratio: number | null, language: Language): string =>
  ratio === null
    ? "—"
    : new Intl.NumberFormat(LOCALE[language], { style: "percent", maximumFractionDigits: 0 }).format(ratio);

/** How healthy a margin is: below 40% it asks for a look, below zero it is losing money. */
export const MARGIN_WATCH = 0.4;
export type MarginTone = "positive" | "caution" | "critical" | "muted";
export const marginTone = (ratio: number | null): MarginTone =>
  ratio === null ? "muted" : ratio < 0 ? "critical" : ratio < MARGIN_WATCH ? "caution" : "positive";

/** A share of a whole, as a whole percent; zero of nothing is zero. */
export const percentOf = (part: number, whole: number): number => (whole === 0 ? 0 : Math.round((part / whole) * 100));

/**
 * Shekels as an administrator types them, to the agora: "92.5" or "92.50" is
 * 9,250 agorot. Read digit by digit — 4.26 × 100 in floating point is not 426.
 */
export const agorotOf = (typed: string): number | null => {
  const match = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(typed.trim());
  if (match === null) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
};

/** Agorot back in the form they are typed: "92.50". */
export const shekelsText = (minor: number): string => (minor / 100).toFixed(2);

/** A whole count as typed; null for anything else. */
export const countOf = (typed: string): number | null => {
  const trimmed = typed.trim();
  return /^\d{1,7}$/.test(trimmed) ? Number(trimmed) : null;
};

/** The order causes are shown in, and the colour each is drawn in. */
export const SOURCE_ORDER: readonly CostSourceName[] = ["BOOKING", "REMINDERS", "WAITING_LIST", "BILLING"];
export const SOURCE_TONE: Readonly<Partial<Record<CostSourceName, string>>> = {
  BOOKING: "var(--accent)",
  REMINDERS: "var(--positive)",
  WAITING_LIST: "var(--caution)",
  BILLING: "var(--faint)",
};
export const toneOf = (source: CostSourceName): string => SOURCE_TONE[source] ?? "var(--muted)";

/** Every cause with a cost, in the order they are shown, others after. */
export const orderedSources = (bySource: Partial<Record<CostSourceName, number>>): CostSourceName[] => {
  const present = Object.keys(bySource) as CostSourceName[];
  return [...SOURCE_ORDER.filter((source) => present.includes(source)), ...present.filter((source) => !SOURCE_ORDER.includes(source))];
};

/** The calculator's rates, Plans and share, as the domain's calculation takes them. */
export const calculatorInputs = (
  basis: CalculatorBasisDto,
): { rates: CalculatorRates; plans: CalculatorPlan[]; share: MicroShekels | null } => ({
  rates: {
    whatsapp: basis.rates.whatsapp === null ? null : microShekels(basis.rates.whatsapp),
    smsPart: basis.rates.smsPart === null ? null : microShekels(basis.rates.smsPart),
    partsPerSms: basis.rates.partsPerSms,
  },
  plans: basis.plans.map((plan) => ({ plan: plan.plan, price: money(plan.priceMinor), allowance: plan.allowance })),
  share: basis.share === null ? null : microShekels(basis.share),
});

export const MESSAGE_SOURCES: readonly MessageSourceName[] = ["BOOKING", "REMINDERS", "WAITING_LIST", "BILLING"];

/** Whether two uses are the same numbers — whether anything was changed. */
export const sameUse = (a: CalculatorUseDto, b: CalculatorUseDto): boolean =>
  a.calendars === b.calendars &&
  MESSAGE_SOURCES.every((source) => a[source].whatsapp === b[source].whatsapp && a[source].sms === b[source].sms);

/** One number changed, leaving the rest. */
export const withCount = (
  use: CalculatorUseDto,
  source: MessageSourceName,
  unit: "whatsapp" | "sms",
  value: number,
): CalculatorUseDto => ({ ...use, [source]: { ...use[source], [unit]: value } });

export const MICRO = { perShekel: MICRO_PER_SHEKEL, perAgora: MICRO_PER_AGORA } as const;
