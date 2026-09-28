import { asId, compareLocalDate, displayName, instant, notFound, PLANS, type PlanVersion, type PlanVersionId } from "@tor-now/domain";
import type {
  GrantEntry,
  GrantRepository,
  PlanEdition,
  PlanVersionRepository,
  UnitRateRepository,
} from "../../ports/repositories.ts";
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

/** An edition as everything but the Catalogue editor reads it. */
const versionOf = ({ id, plan, number, terms }: PlanEdition): PlanVersion => ({ id, plan, number, terms });

/**
 * The edition new Businesses join, as app.is_current_version says it: the
 * highest-numbered of its Plan that was not withdrawn.
 */
export const isCurrentEdition = (store: Store, id: PlanVersionId): boolean => {
  const edition = store.planVersions.find((candidate) => candidate.id === id);
  return (
    edition !== undefined &&
    edition.withdrawnAt === null &&
    !store.planVersions.some(
      (other) => other.plan === edition.plan && other.withdrawnAt === null && other.number > edition.number,
    )
  );
};

export const inMemoryPlanVersions = (store: Store): PlanVersionRepository => {
  const byNumber = (a: PlanEdition, b: PlanEdition) => a.plan.localeCompare(b.plan) || a.number - b.number;
  const replace = (id: PlanVersionId, change: (edition: PlanEdition) => PlanEdition): PlanEdition => {
    const edition = store.planVersions.find((candidate) => candidate.id === id);
    if (edition === undefined) throw notFound("PlanVersion", id);
    const updated = change(edition);
    store.planVersions = store.planVersions.map((candidate) => (candidate.id === id ? updated : candidate));
    return updated;
  };

  return {
    async findById(id) {
      const edition = store.planVersions.find((candidate) => candidate.id === id);
      return edition === undefined ? null : versionOf(edition);
    },
    async listCurrent() {
      return PLANS.flatMap((plan) =>
        store.planVersions.filter((edition) => edition.plan === plan && isCurrentEdition(store, edition.id)).map(versionOf),
      );
    },
    async listAll() {
      return [...store.planVersions].sort(byNumber).map(versionOf);
    },
    async listEditions() {
      return [...store.planVersions].sort(byNumber);
    },
    async publish(edition) {
      if (store.planVersions.some((other) => other.plan === edition.plan && other.number === edition.number)) {
        throw new Error(`${edition.plan} already has edition ${edition.number}`);
      }
      const published: PlanEdition = {
        id: asId(store.nextId("planversion")),
        plan: edition.plan,
        number: edition.number,
        terms: edition.terms,
        publishedAt: instant(Date.now()),
        withdrawnAt: null,
        firstMoveOn: edition.firstMoveOn,
      };
      store.planVersions = [...store.planVersions, published];
      return published;
    },
    async setTerms(id, terms) {
      return versionOf(replace(id, (edition) => ({ ...edition, terms })));
    },
    async withdraw(id, at) {
      replace(id, (edition) => ({ ...edition, withdrawnAt: at }));
    },
  };
};
