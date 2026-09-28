import {
  compareLocalDate,
  endIncluded,
  isOnSale,
  type AddonHolding,
  type AddonOffer,
  type BusinessId,
  type Feature,
  type Instant,
  type LocalDate,
  type Plan,
  type TrialAddons,
} from "@tor-now/domain";
import type { Repositories } from "../ports/repositories.ts";
import { tell } from "./notices.ts";

/**
 * What every part of Billing needs to know about Add-ons (ADR 0021), in one
 * place: what a Trial includes, and what happens to an Add-on once the Plan
 * held gives its Feature anyway.
 */

/** A Trial includes every Add-on on sale until its last day; null once anything is paid. */
export const trialAddonsOf = (trialEndsOn: LocalDate | null, offers: readonly AddonOffer[]): TrialAddons | null =>
  trialEndsOn === null ? null : { features: offers.filter(isOnSale).map((offer) => offer.feature), endsOn: trialEndsOn };

/** Whether a hold still gives its Feature on or after a day — running, or cancelled but not yet ended. */
export const stillHeld = (holding: AddonHolding, today: LocalDate): boolean =>
  holding.ending === null || (holding.ending === "CANCELLED" && holding.endsOn !== null && compareLocalDate(holding.endsOn, today) >= 0);

/**
 * Ends every Add-on a Business holds that its Plan now includes, and tells the
 * owner: they stop paying for what the Plan gives. The owner's own move goes
 * through the owner's door; anything the Catalogue or an administrator did
 * writes directly.
 */
export const endIncludedAddons = async (
  repositories: Repositories,
  input: {
    businessId: BusinessId;
    plan: Plan;
    features: readonly Feature[];
    asOwner: boolean;
    today: LocalDate;
    at: Instant;
  },
): Promise<readonly Feature[]> => {
  const { businessId, today } = input;
  const holdings = (await repositories.addonHoldings.listForBusiness(businessId)).filter(
    (holding) => input.features.includes(holding.feature) && stillHeld(holding, today),
  );
  for (const holding of holdings) {
    const ending = endIncluded(today);
    if (input.asOwner) await repositories.addonHoldings.endAsOwner(businessId, holding.id, ending);
    else await repositories.addonHoldings.end(holding.id, ending);
    await tell(repositories, {
      businessId,
      facts: { kind: "ADDON_INCLUDED", feature: holding.feature, plan: input.plan },
      at: input.at,
    });
  }
  return holdings.map((holding) => holding.feature);
};

/**
 * Once every Plan includes a Feature, nobody can buy it on its own any more:
 * its sale stops. Those who held it were moved off it by `endIncludedAddons`.
 */
export const stopSaleOnceEveryPlanHas = async (
  repositories: Repositories,
  feature: Feature,
  today: LocalDate,
): Promise<void> => {
  const [current, offers] = await Promise.all([repositories.planVersions.listCurrent(), repositories.addonOffers.list()]);
  const offer = offers.find((candidate) => candidate.feature === feature && isOnSale(candidate));
  if (offer === undefined || !current.every((edition) => edition.terms.features.includes(feature))) return;
  await repositories.addonOffers.put({ ...offer, stoppedOn: today });
};
