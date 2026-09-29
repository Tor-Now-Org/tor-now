import { asId, notFound, validationFailed, type RunningCost } from "@tor-now/domain";
import type {
  FairUseLimitRepository,
  ReferenceBusinessRepository,
  RunningCostRepository,
} from "../../ports/repositories.ts";
import type { Store } from "./in-memory-store.ts";

/**
 * What Businesses and the platform cost, held in memory with the same rules
 * the costs migration puts in the database: unique names in any case, eight
 * saved Businesses at most, one amount per cost and day.
 */

const sameName = (a: string, b: string): boolean => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

export const inMemoryFairUseLimits = (store: Store): FairUseLimitRepository => ({
  async get() {
    return store.fairUseLimits;
  },
  async setBusinessLimit(source, amount) {
    store.fairUseLimits = {
      ...store.fairUseLimits,
      perBusiness: { ...store.fairUseLimits.perBusiness, [source]: amount },
    };
    return store.fairUseLimits;
  },
  async setSignInLimit(codesPerDay) {
    store.fairUseLimits = { ...store.fairUseLimits, signInPerDay: codesPerDay };
    return store.fairUseLimits;
  },
});

const NAME_TAKEN = "Another saved Business has this name";

export const inMemoryReferenceBusinesses = (store: Store): ReferenceBusinessRepository => {
  const byId = (id: string) => {
    const found = store.referenceBusinesses.find((candidate) => candidate.id === id);
    if (found === undefined) throw notFound("ReferenceBusiness", id);
    return found;
  };
  return {
    async list() {
      return store.referenceBusinesses;
    },
    async create(input) {
      if (store.referenceBusinesses.some((other) => sameName(other.name, input.name))) {
        throw validationFailed(NAME_TAKEN, { field: "name" });
      }
      if (store.referenceBusinesses.length >= 8) {
        throw validationFailed("At most 8 Businesses can be saved; delete one first", { field: "name" });
      }
      const created = { id: asId<"ReferenceBusiness">(store.nextId("reference")), name: input.name, use: input.use, savedOn: input.savedOn };
      store.referenceBusinesses = [...store.referenceBusinesses, created];
      return created;
    },
    async update(id, input) {
      const updated = { ...byId(id), use: input.use, savedOn: input.savedOn };
      store.referenceBusinesses = store.referenceBusinesses.map((one) => (one.id === id ? updated : one));
      return updated;
    },
    async rename(id, name) {
      const existing = byId(id);
      if (store.referenceBusinesses.some((other) => other.id !== id && sameName(other.name, name))) {
        throw validationFailed(NAME_TAKEN, { field: "name" });
      }
      const renamed = { ...existing, name };
      store.referenceBusinesses = store.referenceBusinesses.map((one) => (one.id === id ? renamed : one));
      return renamed;
    },
    async delete(id) {
      byId(id);
      store.referenceBusinesses = store.referenceBusinesses.filter((one) => one.id !== id);
    },
  };
};

export const inMemoryRunningCosts = (store: Store): RunningCostRepository => {
  const byId = (id: string): RunningCost => {
    const found = store.runningCosts.find((candidate) => candidate.id === id);
    if (found === undefined) throw notFound("RunningCost", id);
    return found;
  };
  const withAmount = (cost: RunningCost, amount: RunningCost["amounts"][number]): RunningCost => ({
    ...cost,
    amounts: [...cost.amounts.filter((one) => one.effectiveFrom !== amount.effectiveFrom), amount].sort((a, b) =>
      a.effectiveFrom.localeCompare(b.effectiveFrom),
    ),
  });
  return {
    async list() {
      return store.runningCosts;
    },
    async create(name, amount) {
      if (store.runningCosts.some((other) => sameName(other.name, name))) {
        throw validationFailed("A running cost with this name is already listed", { field: "name" });
      }
      const created = withAmount({ id: asId<"RunningCost">(store.nextId("running")), name, amounts: [] }, amount);
      store.runningCosts = [...store.runningCosts, created];
      return created;
    },
    async setAmount(id, amount) {
      const updated = withAmount(byId(id), amount);
      store.runningCosts = store.runningCosts.map((one) => (one.id === id ? updated : one));
      return updated;
    },
  };
};
