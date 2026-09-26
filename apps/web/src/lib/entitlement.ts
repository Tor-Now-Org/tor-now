import type { BusinessDto, FeatureName, PlanDto } from "@/lib/api/types.ts";

/**
 * What a Business's plan lets its staff do, read the way every screen needs
 * it (ADR 0019). A Business that came without an Entitlement — an API older
 * than plans — is read as holding everything, so a deploy that has not caught
 * up never locks anybody out.
 */
export const includes = (business: Pick<BusinessDto, "entitlement">, feature: FeatureName): boolean =>
  business.entitlement === undefined || business.entitlement.features.includes(feature);

/** Whether another calendar would go past the Allowance, given how many are on offer. */
export const calendarsFull = (
  business: Pick<BusinessDto, "entitlement">,
  onOffer: number,
): boolean => business.entitlement !== undefined && onOffer >= business.entitlement.resourceAllowance;

/** The cheapest current Plan that includes a Feature — the one a lock points to. */
export const cheapestWith = (plans: readonly PlanDto[], feature: FeatureName): PlanDto | null =>
  [...plans]
    .filter((plan) => plan.features.includes(feature))
    .sort((a, b) => a.priceMinor - b.priceMinor)[0] ?? null;

/** The cheapest current Plan with room for more calendars than these. */
export const cheapestRoomierThan = (plans: readonly PlanDto[], allowance: number): PlanDto | null =>
  [...plans]
    .filter((plan) => plan.resourceAllowance > allowance)
    .sort((a, b) => a.priceMinor - b.priceMinor)[0] ?? null;
