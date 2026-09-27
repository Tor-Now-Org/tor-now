import { asId, compareLocalDate, displayName, instant, notFound } from "@tor-now/domain";
import type { GrantEntry, GrantRepository, UnitRateRepository } from "../../ports/repositories.ts";
import type { Store } from "./in-memory-store.ts";

/**
 * The Catalogue's hand-kept tables held in memory: Unit Rates, one per unit and
 * day as the table's unique key has it, and Grants with who gave them.
 */

const nameOf = (store: Store, userId: string): string | null => {
  const user = store.users.find((candidate) => candidate.id === userId);
  return user === undefined ? null : displayName(user);
};

export const inMemoryUnitRates = (store: Store): UnitRateRepository => ({
  async list() {
    return [...store.unitRates].sort(
      (a, b) => a.unit.localeCompare(b.unit) || a.effectiveFrom.localeCompare(b.effectiveFrom),
    );
  },

  async set(rate, checkedBy) {
    const entry = { ...rate, checkedBy: nameOf(store, checkedBy), enteredAt: instant(Date.now()) };
    store.unitRates = [
      ...store.unitRates.filter(
        (existing) => !(existing.unit === rate.unit && existing.effectiveFrom === rate.effectiveFrom),
      ),
      entry,
    ];
    return entry;
  },
});

export const inMemoryGrants = (store: Store): GrantRepository => {
  const entryOf = (grant: Store["grants"][number]): GrantEntry => ({
    ...grant,
    grantedByName: nameOf(store, grant.grantedBy),
  });

  return {
    async create(grant) {
      const created = { ...grant, id: asId<"Grant">(store.nextId("grant")), createdAt: instant(Date.now()) };
      store.grants = [...store.grants, created];
      return entryOf(created);
    },

    async findById(id) {
      const grant = store.grants.find((candidate) => candidate.id === id);
      return grant === undefined ? null : entryOf(grant);
    },

    async listForBusiness(businessId) {
      return store.grants
        .filter((grant) => grant.businessId === businessId)
        .sort((a, b) => compareLocalDate(b.endsOn, a.endsOn) || b.createdAt - a.createdAt)
        .map(entryOf);
    },

    async listRunning(onOrAfter) {
      return store.grants.filter((grant) => compareLocalDate(grant.endsOn, onOrAfter) >= 0).map(entryOf);
    },

    async update(id, changes) {
      const grant = store.grants.find((candidate) => candidate.id === id);
      if (grant === undefined) throw notFound("Grant", id);
      const updated = { ...grant, ...changes };
      store.grants = store.grants.map((candidate) => (candidate.id === id ? updated : candidate));
      return entryOf(updated);
    },
  };
};
