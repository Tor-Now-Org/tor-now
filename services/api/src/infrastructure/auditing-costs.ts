import { AUDIT_ACTIONS } from "../ports/audit.ts";
import type {
  FairUseLimitRepository,
  ReferenceBusinessRepository,
  RunningCostRepository,
} from "../ports/repositories.ts";
import { record, type Context } from "./audit-record.ts";

/**
 * The audit trail of what Businesses and the platform cost (ADR 0023): every
 * limit changed, every saved Business kept, changed or deleted, every running
 * cost's amount — before and after, by whom.
 */

export const auditedFairUseLimits = (inner: FairUseLimitRepository, context: Context): FairUseLimitRepository => ({
  ...inner,
  async setBusinessLimit(source, amount) {
    const before = await inner.get();
    const after = await inner.setBusinessLimit(source, amount);
    await record(context, AUDIT_ACTIONS.fairUseLimitSet, "FairUseLimit", source, before, after);
    return after;
  },
  async setSignInLimit(codesPerDay) {
    const before = await inner.get();
    const after = await inner.setSignInLimit(codesPerDay);
    await record(context, AUDIT_ACTIONS.fairUseLimitSet, "FairUseLimit", "SIGN_IN", before, after);
    return after;
  },
});

export const auditedReferenceBusinesses = (
  inner: ReferenceBusinessRepository,
  context: Context,
): ReferenceBusinessRepository => {
  const before = async (id: string) => (await inner.list()).find((one) => one.id === id) ?? null;
  return {
    ...inner,
    async create(input) {
      const created = await inner.create(input);
      await record(context, AUDIT_ACTIONS.referenceBusinessSaved, "ReferenceBusiness", created.id, null, created);
      return created;
    },
    async update(id, input) {
      const previous = await before(id);
      const after = await inner.update(id, input);
      await record(context, AUDIT_ACTIONS.referenceBusinessUpdated, "ReferenceBusiness", id, previous, after);
      return after;
    },
    async rename(id, name) {
      const previous = await before(id);
      const after = await inner.rename(id, name);
      await record(context, AUDIT_ACTIONS.referenceBusinessRenamed, "ReferenceBusiness", id, previous, after);
      return after;
    },
    async delete(id) {
      const previous = await before(id);
      await inner.delete(id);
      await record(context, AUDIT_ACTIONS.referenceBusinessDeleted, "ReferenceBusiness", id, previous, null);
    },
  };
};

export const auditedRunningCosts = (inner: RunningCostRepository, context: Context): RunningCostRepository => ({
  ...inner,
  async create(name, amount, enteredBy) {
    const created = await inner.create(name, amount, enteredBy);
    await record(context, AUDIT_ACTIONS.runningCostSet, "RunningCost", created.id, null, created);
    return created;
  },
  async setAmount(id, amount, enteredBy) {
    const previous = (await inner.list()).find((cost) => cost.id === id) ?? null;
    const after = await inner.setAmount(id, amount, enteredBy);
    await record(context, AUDIT_ACTIONS.runningCostSet, "RunningCost", id, previous, after);
    return after;
  },
});
