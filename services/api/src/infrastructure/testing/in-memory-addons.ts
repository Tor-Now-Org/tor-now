import { asId, compareLocalDate, DomainError, notFound, type AddonHolding, type AddonOffer, type DaysOwedEntry } from "@tor-now/domain";
import type {
  AddonHoldingRepository,
  AddonOfferRepository,
  DaysOwedRepository,
  NewAddonHolding,
} from "../../ports/repositories.ts";
import type { Store } from "./in-memory-store.ts";

/**
 * Add-ons and the days owed, held in memory as their tables hold them: one
 * sale per Feature, at most two on sale, one hold running per Business and
 * Feature — and the owner's doors taking the price from the sale.
 */

const MAX_ON_SALE = 2;

export const inMemoryAddonOffers = (store: Store): AddonOfferRepository => ({
  async list() {
    return [...store.addonOffers].sort((a, b) => a.feature.localeCompare(b.feature));
  },

  async put(offer) {
    const next = [...store.addonOffers.filter((candidate) => candidate.feature !== offer.feature), offer];
    // addon_offer_within_limit
    if (next.filter((candidate) => candidate.stoppedOn === null).length > MAX_ON_SALE) {
      throw new DomainError("CONFLICT", "No more than two Add-ons are on sale at once");
    }
    store.addonOffers = next;
    return offer;
  },
});

export const inMemoryAddonHoldings = (store: Store): AddonHoldingRepository => {
  const find = (id: string): AddonHolding => {
    const holding = store.addonHoldings.find((candidate) => candidate.id === id);
    if (holding === undefined) throw notFound("AddonHolding", id);
    return holding;
  };
  const replace = (id: string, change: (holding: AddonHolding) => AddonHolding): AddonHolding => {
    const updated = change(find(id));
    store.addonHoldings = store.addonHoldings.map((candidate) => (candidate.id === id ? updated : candidate));
    return updated;
  };
  const insert = (holding: NewAddonHolding): AddonHolding => {
    // addon_holding_one_running
    if (store.addonHoldings.some((h) => h.businessId === holding.businessId && h.feature === holding.feature && h.ending === null)) {
      throw new Error("duplicate key value violates unique constraint \"addon_holding_one_running\"");
    }
    const added: AddonHolding = {
      ...holding,
      id: asId(store.nextId("addonholding")),
      nextPrice: null,
      endsOn: null,
      ending: null,
    };
    store.addonHoldings = [...store.addonHoldings, added];
    return added;
  };
  const onSale = (feature: AddonOffer["feature"]): AddonOffer => {
    const offer = store.addonOffers.find((candidate) => candidate.feature === feature && candidate.stoppedOn === null);
    if (offer === undefined) throw new DomainError("CONFLICT", "This Add-on is not on sale");
    return offer;
  };

  return {
    async listForBusiness(businessId) {
      return store.addonHoldings.filter((holding) => holding.businessId === businessId);
    },

    async listRunning(onOrAfter) {
      return store.addonHoldings.filter(
        (holding) => holding.endsOn === null || compareLocalDate(holding.endsOn, onOrAfter) >= 0,
      );
    },

    async add(holding) {
      return insert(holding);
    },

    // app.owner_adds_addon: the price is the sale's, never the caller's.
    async addAsOwner(holding) {
      return insert({ ...holding, price: onSale(holding.feature).price });
    },

    async end(id, ending) {
      return replace(id, (holding) => ({ ...holding, ...ending }));
    },

    // app.owner_ends_addon
    async endAsOwner(businessId, id, ending) {
      const holding = find(id);
      const endable =
        holding.businessId === businessId &&
        (holding.ending === null || (ending.ending === "INCLUDED" && holding.ending === "CANCELLED"));
      if (!endable) throw new DomainError("CONFLICT", "This Add-on is not running");
      return replace(id, (current) => ({ ...current, ...ending }));
    },

    async resume(id) {
      return replace(id, (holding) => ({ ...holding, endsOn: null, ending: null }));
    },

    // app.owner_resumes_addon
    async resumeAsOwner(businessId, id) {
      const holding = find(id);
      if (holding.businessId !== businessId || holding.ending !== "CANCELLED") {
        throw new DomainError("CONFLICT", "This Add-on is not cancelled");
      }
      return replace(id, (current) => ({ ...current, endsOn: null, ending: null }));
    },

    async setPrices(changes) {
      for (const change of changes) {
        replace(change.id, (holding) => ({ ...holding, price: change.price, nextPrice: change.nextPrice }));
      }
    },
  };
};

export const inMemoryDaysOwed = (store: Store): DaysOwedRepository => ({
  async add(owed) {
    const added: DaysOwedEntry = { ...owed, id: asId(store.nextId("owed")), paymentId: null };
    store.daysOwed = [...store.daysOwed, added];
    return added;
  },

  async listOwed(businessId) {
    return store.daysOwed.filter((owed) => owed.businessId === businessId && owed.paymentId === null);
  },

  async settle(businessId, paymentId) {
    store.daysOwed = store.daysOwed.map((owed) =>
      owed.businessId === businessId && owed.paymentId === null ? { ...owed, paymentId } : owed,
    );
  },
});
