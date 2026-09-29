import type { CostUnitName, FeatureName, PlanName } from "./types.ts";

/**
 * The Cost tab and Fair Use on the wire (ADR 0023). Costs are micro-shekels,
 * prices and limits agorot, days YYYY-MM-DD; nothing is rounded until shown.
 */

export type CostSourceName = "BOOKING" | "SIGN_IN" | "BILLING" | FeatureName;
export type MessageSourceName = "BOOKING" | "REMINDERS" | "WAITING_LIST" | "BILLING";
export type FairUseSourceName = "BOOKING" | "REMINDERS" | "WAITING_LIST";

export type MessageCountDto = { whatsapp: number; sms: number };
export type CalculatorUseDto = { calendars: number } & Record<MessageSourceName, MessageCountDto>;

export type BusinessCostDto = { businessId: string; name: string; cost: number };

export type PlanCostDto = {
  plan: PlanName;
  paying: number;
  revenue: number;
  cost: number;
  averageCost: number | null;
  margin: number | null;
  marginAfterShare: number | null;
  bySource: Partial<Record<CostSourceName, number>>;
  priciest: BusinessCostDto | null;
};

export type GroupCostDto = { count: number; cost: number; averageCost: number | null };

export type RunningCostLineDto = { id: string; name: string; amountMinor: number; since: string; source: string };

export type UnpricedUsageDto = { unit: CostUnitName; units: number; messages: number; from: string };

export type MonthCostsDto = {
  /** YYYY-MM. */
  month: string;
  through: string;
  current: boolean;
  platform: {
    signIn: { codes: number; cost: number; unpricedUnits: number };
    running: RunningCostLineDto[];
    total: number;
    perPaying: number | null;
  };
  plans: PlanCostDto[];
  /** Each Plan's current price, to read the figures against. */
  prices: { plan: PlanName; priceMinor: number; allowance: number }[];
  paying: number;
  trials: GroupCostDto;
  notPaying: GroupCostDto;
  unpriced: UnpricedUsageDto[];
  /** Businesses over a Fair Use Limit this month, worked out now. */
  overLimit: string[];
};

export type ReferenceBusinessDto = { id: string; name: string; use: CalculatorUseDto; savedOn: string };

export type MeasuredExampleDto = {
  use: CalculatorUseDto;
  over: number;
  business: { id: string; name: string } | null;
};

export type CalculatorBasisDto = {
  rates: { whatsapp: number | null; smsPart: number | null; partsPerSms: number };
  plans: { plan: PlanName; priceMinor: number; allowance: number }[];
  share: number | null;
  actualAverage: MeasuredExampleDto | null;
  mostExpensive: MeasuredExampleDto | null;
  saved: ReferenceBusinessDto[];
};

export type RunningCostAmountDto = { effectiveFrom: string; amountMinor: number; source: string };
export type RunningCostDto = { id: string; name: string; amounts: RunningCostAmountDto[] };

export type OverBusinessDto = BusinessCostDto & { plan: PlanName; whatsapp: number; smsMessages: number };

export type SourceFairUseDto = {
  source: FairUseSourceName;
  limit: number;
  top: BusinessCostDto | null;
  over: OverBusinessDto[];
};

export type SignInReadingDto = { today: number; cost: number; limit: number; over: boolean; averagePerDay: number };

export type FairUseDto = {
  month: string;
  through: string;
  limits: { perBusiness: Record<FairUseSourceName, number>; signInPerDay: number };
  signIn: SignInReadingDto;
  sources: SourceFairUseDto[];
};

export type FairUseAlertsDto = {
  businessesOver: number;
  sourcesOver: FairUseSourceName[];
  signIn: { today: number; limit: number; over: boolean };
};

export type FairUseReadingDto = { source: FairUseSourceName; limit: number; cost: number; over: boolean };

export type BusinessUsageDto = {
  month: string;
  through: string;
  readings: FairUseReadingDto[];
  whatsapp: number;
  smsMessages: number;
  total: number;
  unpricedUnits: number;
  monthlyPriceMinor: number;
};
