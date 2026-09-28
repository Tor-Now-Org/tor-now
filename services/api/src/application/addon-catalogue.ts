import {
  checkAddonSale,
  checkPriceChange,
  compareLocalDate,
  isOnSale,
  notFound,
  PLANS,
  planTerms,
  priceDrop,
  priceOn,
  priceRise,
  riseCancelled,
  validationFailed,
  type AddonHolding,
  type AddonOffer,
  type BusinessId,
  type Clock,
  type Feature,
  type LocalDate,
  type Plan,
  type Subscription,
} from "@tor-now/domain";
import type { Repositories } from "../ports/repositories.ts";
import type { Actor, UnitOfWork } from "../ports/unit-of-work.ts";
import { stillHeld } from "./addons.ts";
import { requireAdministrator } from "./authorization.ts";
import { catalogueToday, featureViews } from "./feature-catalogue.ts";
import { announce, tell } from "./notices.ts";
import { planChanger } from "./plan-catalogue.ts";

/**
 * The Catalogue's side of Add-ons (ADR 0021): putting a Feature on sale on its
 * own, pricing it, stopping it — and "which plans", placing a Feature from its
 * own card by exactly the rule a Plan's editor follows.
 *
 * A lower price gives, so it reaches everyone at once. A higher one takes, so
 * it reaches each holder at their first renewal thirty days on, told now on
 * WhatsApp too — cancellable until the first of them pays it.
 */

const onSaleOf = async (repositories: Repositories, feature: Feature): Promise<AddonOffer> => {
  const offer = (await repositories.addonOffers.list()).find((candidate) => candidate.feature === feature);
  if (offer === undefined || !isOnSale(offer)) throw notFound("AddonOffer", feature);
  return offer;
};

/** Holds of an Add-on still giving it, each with a rise that has reached it already folded in. */
const heldNow = async (repositories: Repositories, feature: Feature, today: LocalDate): Promise<readonly AddonHolding[]> =>
  (await repositories.addonHoldings.listRunning(today))
    .filter((holding) => holding.feature === feature && stillHeld(holding, today))
    .map((holding) =>
      holding.nextPrice !== null && compareLocalDate(holding.nextPrice.effectiveOn, today) <= 0
        ? { ...holding, price: priceOn(holding, today), nextPrice: null }
        : holding,
    );

/** What a holder pays in the end, a rise on its way included. */
const endPrice = (holding: Pick<AddonHolding, "price" | "nextPrice">) => holding.nextPrice?.price ?? holding.price;

export const addonCatalogueService = ({ unitOfWork, clock }: { unitOfWork: UnitOfWork; clock: Clock }) => {
  const today = () => catalogueToday(clock);
  const views = (repositories: Repositories) => featureViews(repositories, clock);

  return {
    /** On sale on its own, told to every Business whose Plan lacks it. */
    async sell(actor: Actor, feature: Feature, priceMinor: number) {
      requireAdministrator(actor);
      return unitOfWork.run(actor, async ({ repositories }) => {
        const [current, offers, previews, entries] = await Promise.all([
          repositories.planVersions.listCurrent(),
          repositories.addonOffers.list(),
          repositories.previews.list(),
          repositories.subscriptions.directory(),
        ]);
        const price = checkAddonSale({
          feature,
          price: priceMinor,
          offers,
          editions: current,
          previewing: previews.filter((preview) => compareLocalDate(today(), preview.endsOn) <= 0).map((p) => p.feature),
          today: today(),
        });
        await repositories.addonOffers.put({ feature, price, since: today(), stoppedOn: null, rise: null });
        const versions = new Map((await repositories.planVersions.listAll()).map((version) => [version.id, version]));
        for (const entry of entries) {
          if (versions.get(entry.subscription.planVersionId)?.terms.features.includes(feature) !== false) continue;
          await tell(repositories, {
            businessId: entry.business.id,
            facts: { kind: "ADDON_OFFERED", feature, priceMinor: price },
            at: clock.now(),
          });
        }
        return views(repositories);
      });
    },

    async changePrice(actor: Actor, feature: Feature, priceMinor: number) {
      requireAdministrator(actor);
      return unitOfWork.run(actor, async (session) => {
        const { repositories } = session;
        const offer = await onSaleOf(repositories, feature);
        const to = checkPriceChange({ offer, to: priceMinor, today: today() });
        const holdings = await heldNow(repositories, feature, today());

        if (to > offer.price) {
          const subscriptions = new Map<BusinessId, Subscription>(
            (await repositories.subscriptions.directory()).map((entry) => [entry.business.id, entry.subscription]),
          );
          const risen = priceRise({ offer, to, holdings, subscriptions, today: today() });
          await repositories.addonOffers.put(risen.offer);
          await repositories.addonHoldings.setPrices(
            risen.holdings.map((change) => {
              const holding = holdings.find((candidate) => candidate.id === change.id);
              if (holding === undefined) throw notFound("AddonHolding", change.id);
              return { id: change.id, price: holding.price, nextPrice: change.nextPrice };
            }),
          );
          for (const change of risen.holdings) {
            const holding = holdings.find((candidate) => candidate.id === change.id);
            if (holding === undefined) continue;
            await announce(session, {
              businessId: holding.businessId,
              facts: {
                kind: "ADDON_PRICE_RISING",
                feature,
                priceFrom: holding.price,
                priceTo: change.nextPrice.price,
                effectiveOn: change.nextPrice.effectiveOn,
              },
              at: clock.now(),
            });
          }
          return views(repositories);
        }

        const dropped = priceDrop({ offer, to, holdings });
        await repositories.addonOffers.put(dropped.offer);
        await repositories.addonHoldings.setPrices(dropped.holdings);
        for (const change of dropped.holdings) {
          const holding = holdings.find((candidate) => candidate.id === change.id);
          if (holding === undefined || endPrice(change) >= endPrice(holding)) continue;
          await tell(repositories, {
            businessId: holding.businessId,
            facts: { kind: "ADDON_PRICE_LOWERED", feature, priceFrom: endPrice(holding), priceTo: endPrice(change) },
            at: clock.now(),
          });
        }
        return views(repositories);
      });
    },

    /** A rise withdrawn before anyone paid it: the old price again, for everyone. */
    async cancelRise(actor: Actor, feature: Feature) {
      requireAdministrator(actor);
      return unitOfWork.run(actor, async (session) => {
        const { repositories } = session;
        const offer = await onSaleOf(repositories, feature);
        const restored = riseCancelled({ offer, today: today() });
        const rising = (await heldNow(repositories, feature, today())).filter((holding) => holding.nextPrice !== null);
        await repositories.addonOffers.put(restored);
        await repositories.addonHoldings.setPrices(rising.map((holding) => ({ id: holding.id, price: holding.price, nextPrice: null })));
        for (const holding of rising) {
          await announce(session, {
            businessId: holding.businessId,
            facts: { kind: "ADDON_RISE_CANCELLED", feature, priceMinor: holding.price },
            at: clock.now(),
          });
        }
        return views(repositories);
      });
    },

    /** Nobody new adds it; those who hold it keep it, at their price, until they cancel. */
    async stop(actor: Actor, feature: Feature) {
      requireAdministrator(actor);
      return unitOfWork.run(actor, async ({ repositories }) => {
        const offer = await onSaleOf(repositories, feature);
        await repositories.addonOffers.put({ ...offer, stoppedOn: today() });
        return views(repositories);
      });
    },

    /**
     * Which Plans include a Feature, from its own card. Each Plan whose answer
     * changes is changed by the Plan editor's own rule: including it gives, and
     * applies to every edition now; leaving it out takes, and is a new edition
     * with thirty days' Notice. All of it, or none of it.
     */
    async setPlans(actor: Actor, feature: Feature, include: readonly Plan[]) {
      requireAdministrator(actor);
      const wanted = new Set(include);
      if ([...wanted].some((plan) => !PLANS.includes(plan))) throw validationFailed("Unknown plan", { field: "plans" });
      return unitOfWork.run(actor, async (session) => {
        const { repositories } = session;
        const previews = await repositories.previews.list();
        if (previews.some((preview) => preview.feature === feature && compareLocalDate(today(), preview.endsOn) <= 0)) {
          throw validationFailed("A Feature in Preview is placed when the Preview ends", { field: "feature" });
        }
        const changing = (await repositories.planVersions.listCurrent()).filter(
          (edition) => edition.terms.features.includes(feature) !== wanted.has(edition.plan),
        );
        if (changing.length === 0) throw validationFailed("Nothing about where it is sold changed", { field: "plans" });
        const { apply } = planChanger(clock);
        for (const edition of changing) {
          const features = wanted.has(edition.plan)
            ? [...edition.terms.features, feature]
            : edition.terms.features.filter((candidate) => candidate !== feature);
          await apply(session, edition.plan, planTerms({ ...edition.terms, features }));
        }
        return views(repositories);
      });
    },
  };
};
