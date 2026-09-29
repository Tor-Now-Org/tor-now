import {
  asId,
  BUSINESS_MESSAGE_SOURCES,
  checkCalculatorUse,
  FAIR_USE_SOURCES,
  money,
  notFound,
  validationFailed,
  type CalculatorUse,
  type FairUseLimits,
  type FairUseSource,
  type ReferenceBusiness,
  type RunningCost,
  type RunningCostAmount,
} from "@tor-now/domain";
import type {
  FairUseLimitRepository,
  ReferenceBusinessRepository,
  RunningCostRepository,
} from "../../ports/repositories.ts";
import { errorCodeOf, PG_ERRORS, type Transaction } from "./client.ts";
import { text, toLocalDate, type Row } from "./mappers.ts";

/**
 * The tables behind what Businesses and the platform cost (ADR 0023). Each is
 * an administrator's, over the service connection only; the auditing decorator
 * records every write.
 */

/** A database refusal the administrator can act on, as the domain says it. */
const translated = (error: unknown, field: string, message: string): unknown => {
  const code = errorCodeOf(error);
  return code === PG_ERRORS.uniqueViolation || code === PG_ERRORS.checkViolation
    ? validationFailed(message, { field })
    : error;
};

export const fairUseLimitRepository = (tx: Transaction): FairUseLimitRepository => {
  const get = async (): Promise<FairUseLimits> => {
    const rows = await tx<Row[]>`select source, business_month_minor, codes_per_day from fair_use_limit`;
    const bySource = new Map(rows.map((row) => [text(row["source"]), row]));
    const perBusiness = Object.fromEntries(
      FAIR_USE_SOURCES.map((source) => {
        const row = bySource.get(source);
        if (row === undefined) throw new Error(`No Fair Use Limit is set for ${source}`);
        return [source, money(Number(row["business_month_minor"]))];
      }),
    ) as Record<FairUseSource, FairUseLimits["perBusiness"][FairUseSource]>;
    const signIn = bySource.get("SIGN_IN");
    if (signIn === undefined) throw new Error("No Fair Use Limit is set for sign-in codes");
    return { perBusiness, signInPerDay: Number(signIn["codes_per_day"]) };
  };

  return {
    get,

    async setBusinessLimit(source, amount) {
      await tx`
        update fair_use_limit set business_month_minor = ${amount}, updated_at = now()
        where source = ${source}`;
      return get();
    },

    async setSignInLimit(codesPerDay) {
      await tx`
        update fair_use_limit set codes_per_day = ${codesPerDay}, updated_at = now()
        where source = 'SIGN_IN'`;
      return get();
    },
  };
};

/** A saved use as the column holds it, checked again on the way out. */
const toUse = (value: unknown, calendars: number): CalculatorUse => {
  const stored = (typeof value === "string" ? JSON.parse(value) : value) as Record<string, Record<string, unknown>>;
  return checkCalculatorUse({
    calendars,
    ...(Object.fromEntries(
      BUSINESS_MESSAGE_SOURCES.map((source) => [
        source,
        { whatsapp: Number(stored[source]?.["whatsapp"] ?? 0), sms: Number(stored[source]?.["sms"] ?? 0) },
      ]),
    ) as Omit<CalculatorUse, "calendars">),
  });
};

const usageColumn = (use: CalculatorUse) =>
  Object.fromEntries(BUSINESS_MESSAGE_SOURCES.map((source) => [source, use[source]]));

const toReferenceBusiness = (row: Row): ReferenceBusiness => ({
  id: asId(text(row["id"])),
  name: text(row["name"]),
  use: toUse(row["usage"], Number(row["calendars"])),
  savedOn: toLocalDate(row["saved_on"]),
});

const NAME_TAKEN = "Another saved Business has this name";

export const referenceBusinessRepository = (tx: Transaction): ReferenceBusinessRepository => {
  const one = (rows: readonly Row[], id: string): ReferenceBusiness => {
    const row = rows[0];
    if (row === undefined) throw notFound("ReferenceBusiness", id);
    return toReferenceBusiness(row);
  };

  return {
    async list() {
      const rows = await tx<Row[]>`select * from reference_business order by position`;
      return rows.map(toReferenceBusiness);
    },

    async create(input) {
      try {
        const rows = await tx<Row[]>`
          insert into reference_business (name, calendars, usage, saved_on, saved_by)
          values (${input.name}, ${input.use.calendars}, ${tx.json(usageColumn(input.use))},
                  ${input.savedOn}, ${input.savedBy})
          returning *`;
        return one(rows, input.name);
      } catch (error) {
        throw translated(error, "name", errorCodeOf(error) === PG_ERRORS.checkViolation
          ? "At most 8 Businesses can be saved; delete one first"
          : NAME_TAKEN);
      }
    },

    async update(id, input) {
      const rows = await tx<Row[]>`
        update reference_business
        set calendars = ${input.use.calendars}, usage = ${tx.json(usageColumn(input.use))},
            saved_on = ${input.savedOn}, saved_by = ${input.savedBy}
        where id = ${id}
        returning *`;
      return one(rows, id);
    },

    async rename(id, name) {
      try {
        const rows = await tx<Row[]>`update reference_business set name = ${name} where id = ${id} returning *`;
        return one(rows, id);
      } catch (error) {
        throw translated(error, "name", NAME_TAKEN);
      }
    },

    async delete(id) {
      const rows = await tx<Row[]>`delete from reference_business where id = ${id} returning id`;
      if (rows.length === 0) throw notFound("ReferenceBusiness", id);
    },
  };
};

const toAmount = (row: Row): RunningCostAmount => ({
  effectiveFrom: toLocalDate(row["effective_from"]),
  amount: money(Number(row["amount_minor"])),
  source: text(row["source"]),
});

/** Rows of costs joined to their amounts, folded into one cost each, in order. */
const toRunningCosts = (rows: readonly Row[]): RunningCost[] => {
  const costs = new Map<string, { id: string; name: string; amounts: RunningCostAmount[] }>();
  for (const row of rows) {
    const id = text(row["id"]);
    const cost = costs.get(id) ?? { id, name: text(row["name"]), amounts: [] };
    if (row["effective_from"] !== null) cost.amounts.push(toAmount(row));
    costs.set(id, cost);
  }
  return [...costs.values()].map((cost) => ({ id: asId(cost.id), name: cost.name, amounts: cost.amounts }));
};

export const runningCostRepository = (tx: Transaction): RunningCostRepository => {
  const byId = async (id: string): Promise<RunningCost> => {
    const rows = await tx<Row[]>`
      select c.id, c.name, a.effective_from, a.amount_minor, a.source
      from running_cost c
      left join running_cost_amount a on a.running_cost_id = c.id
      where c.id = ${id}
      order by a.effective_from`;
    const [cost] = toRunningCosts(rows);
    if (cost === undefined) throw notFound("RunningCost", id);
    return cost;
  };

  const putAmount = async (id: string, amount: RunningCostAmount, enteredBy: string) => {
    await tx`
      insert into running_cost_amount (running_cost_id, effective_from, amount_minor, source, entered_by)
      values (${id}, ${amount.effectiveFrom}, ${amount.amount}, ${amount.source}, ${enteredBy})
      on conflict (running_cost_id, effective_from) do update
      set amount_minor = excluded.amount_minor,
          source = excluded.source,
          entered_by = excluded.entered_by,
          entered_at = now()`;
  };

  return {
    async list() {
      const rows = await tx<Row[]>`
        select c.id, c.name, a.effective_from, a.amount_minor, a.source
        from running_cost c
        left join running_cost_amount a on a.running_cost_id = c.id
        order by c.position, a.effective_from`;
      return toRunningCosts(rows);
    },

    async create(name, amount, enteredBy) {
      let id: string;
      try {
        const rows = await tx<Row[]>`insert into running_cost (name) values (${name}) returning id`;
        id = text(rows[0]?.["id"]);
      } catch (error) {
        throw translated(error, "name", "A running cost with this name is already listed");
      }
      await putAmount(id, amount, enteredBy);
      return byId(id);
    },

    async setAmount(id, amount, enteredBy) {
      await byId(id);
      await putAmount(id, amount, enteredBy);
      return byId(id);
    },
  };
};
