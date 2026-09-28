import {
  asId,
  DomainError,
  forbidden,
  money,
  notFound,
  parseFeature,
  PLANS,
  type AddonEnding,
  type AddonHolding,
  type AddonOffer,
  type DaysOwedEntry,
  type OwedKind,
  type Feature,
  type Plan,
} from "@tor-now/domain";
import type { AddonHoldingRepository, AddonOfferRepository, DaysOwedRepository } from "../../ports/repositories.ts";
import { errorCodeOf, PG_ERRORS, type Transaction } from "./client.ts";
import { text, toLocalDate, type Row } from "./mappers.ts";

/**
 * Add-ons (ADR 0021) and the days owed beyond a monthly price. An owner writes
 * their own Add-ons only through app.owner_adds_addon and its siblings, which
 * take the price from the sale; an administrator and the daily run write the
 * tables directly.
 */

/** Raised by the owner's doors when the caller does not own the Business. */
const INSUFFICIENT_PRIVILEGE = "42501";

const dateOrNull = (value: unknown) => (value === null || value === undefined ? null : toLocalDate(value));

const toAddonOffer = (row: Row): AddonOffer => ({
  feature: parseFeature(text(row["feature"])),
  price: money(Number(row["price_minor"])),
  since: toLocalDate(row["since"]),
  stoppedOn: dateOrNull(row["stopped_on"]),
  rise:
    row["rise_from_minor"] === null
      ? null
      : {
          from: money(Number(row["rise_from_minor"])),
          announcedOn: toLocalDate(row["rise_announced_on"]),
          firstOn: toLocalDate(row["rise_first_on"]),
          lastOn: toLocalDate(row["rise_last_on"]),
        },
});

const toEnding = (value: unknown): AddonEnding | null => {
  if (value === null || value === undefined) return null;
  const ending = text(value);
  if (ending !== "CANCELLED" && ending !== "INCLUDED") throw new Error(`Unknown Add-on ending in the database: ${ending}`);
  return ending;
};

const toAddonHolding = (row: Row): AddonHolding => ({
  id: asId(text(row["id"])),
  businessId: asId(text(row["business_id"])),
  feature: parseFeature(text(row["feature"])),
  addedOn: toLocalDate(row["added_on"]),
  paysFrom: toLocalDate(row["pays_from"]),
  price: money(Number(row["price_minor"])),
  nextPrice:
    row["next_price_minor"] === null
      ? null
      : { price: money(Number(row["next_price_minor"])), effectiveOn: toLocalDate(row["next_price_on"]) },
  endsOn: dateOrNull(row["ends_on"]),
  ending: toEnding(row["ending"]),
});

const toChargeKind = (value: string): OwedKind => {
  if (value !== "ADDON_DAYS" && value !== "PLAN_DAYS") throw new Error(`Unknown kind of days owed in the database: ${value}`);
  return value;
};

const toSubject = (kind: OwedKind, value: string): Feature | Plan => {
  if (kind === "ADDON_DAYS") return parseFeature(value);
  if (!(PLANS as readonly string[]).includes(value)) throw new Error(`Unknown plan in the database: ${value}`);
  return value as Plan;
};

const toCharge = (row: Row): DaysOwedEntry => {
  const kind = toChargeKind(text(row["kind"]));
  return {
    id: asId(text(row["id"])),
    businessId: asId(text(row["business_id"])),
    kind,
    subject: toSubject(kind, text(row["subject"])),
    amount: money(Number(row["amount_minor"])),
    from: toLocalDate(row["from_on"]),
    through: toLocalDate(row["through_on"]),
    paymentId: row["payment_id"] === null ? null : asId(text(row["payment_id"])),
  };
};

/** The owner's doors raise as the database decides; what they mean, said in the domain's words. */
const asOwner = async <T>(work: () => Promise<T>, refusal: string): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    const code = errorCodeOf(error);
    if (code === INSUFFICIENT_PRIVILEGE) throw forbidden(refusal);
    if (code === PG_ERRORS.checkViolation) {
      throw new DomainError("CONFLICT", error instanceof Error ? error.message : refusal);
    }
    throw error;
  }
};

export const addonOfferRepository = (tx: Transaction): AddonOfferRepository => ({
  async list() {
    const rows = await tx<Row[]>`select * from addon_offer order by feature`;
    return rows.map(toAddonOffer);
  },

  async put(offer) {
    const { rise } = offer;
    try {
      const rows = await tx<Row[]>`
        insert into addon_offer (feature, price_minor, since, stopped_on,
                                 rise_from_minor, rise_announced_on, rise_first_on, rise_last_on)
        values (${offer.feature}, ${offer.price}, ${offer.since}, ${offer.stoppedOn},
                ${rise?.from ?? null}, ${rise?.announcedOn ?? null}, ${rise?.firstOn ?? null}, ${rise?.lastOn ?? null})
        on conflict (feature) do update
        set price_minor = excluded.price_minor,
            since = excluded.since,
            stopped_on = excluded.stopped_on,
            rise_from_minor = excluded.rise_from_minor,
            rise_announced_on = excluded.rise_announced_on,
            rise_first_on = excluded.rise_first_on,
            rise_last_on = excluded.rise_last_on
        returning *`;
      const row = rows[0];
      if (row === undefined) throw notFound("AddonOffer", offer.feature);
      return toAddonOffer(row);
    } catch (error) {
      if (errorCodeOf(error) === PG_ERRORS.checkViolation) {
        throw new DomainError("CONFLICT", error instanceof Error ? error.message : "The Add-on could not be put on sale");
      }
      throw error;
    }
  },
});

export const addonHoldingRepository = (tx: Transaction): AddonHoldingRepository => {
  const byId = async (id: string): Promise<AddonHolding> => {
    const rows = await tx<Row[]>`select * from addon_holding where id = ${id}`;
    const row = rows[0];
    if (row === undefined) throw notFound("AddonHolding", id);
    return toAddonHolding(row);
  };

  return {
    async listForBusiness(businessId) {
      const rows = await tx<Row[]>`
        select * from addon_holding where business_id = ${businessId} order by created_at`;
      return rows.map(toAddonHolding);
    },

    async listRunning(onOrAfter) {
      const rows = await tx<Row[]>`
        select * from addon_holding
        where ends_on is null or ends_on >= ${onOrAfter}::date
        order by created_at`;
      return rows.map(toAddonHolding);
    },

    async add(holding) {
      const rows = await tx<Row[]>`
        insert into addon_holding (business_id, feature, added_on, pays_from, price_minor)
        values (${holding.businessId}, ${holding.feature}, ${holding.addedOn}, ${holding.paysFrom}, ${holding.price})
        returning *`;
      const row = rows[0];
      if (row === undefined) throw notFound("AddonHolding");
      return toAddonHolding(row);
    },

    async addAsOwner(holding) {
      const rows = await asOwner(
        () => tx<Row[]>`
          select app.owner_adds_addon(${holding.businessId}, ${holding.feature}, ${holding.addedOn}, ${holding.paysFrom}) as id`,
        "Only the owner adds an Add-on",
      );
      return byId(text(rows[0]?.["id"]));
    },

    async end(id, ending) {
      const rows = await tx<Row[]>`
        update addon_holding set ends_on = ${ending.endsOn}, ending = ${ending.ending}
        where id = ${id} returning *`;
      const row = rows[0];
      if (row === undefined) throw notFound("AddonHolding", id);
      return toAddonHolding(row);
    },

    async endAsOwner(businessId, id, ending) {
      await asOwner(
        () => tx`select app.owner_ends_addon(${businessId}, ${id}, ${ending.endsOn}, ${ending.ending})`,
        "Only the owner ends an Add-on",
      );
      return byId(id);
    },

    async resume(id) {
      const rows = await tx<Row[]>`
        update addon_holding set ends_on = null, ending = null where id = ${id} returning *`;
      const row = rows[0];
      if (row === undefined) throw notFound("AddonHolding", id);
      return toAddonHolding(row);
    },

    async resumeAsOwner(businessId, id) {
      await asOwner(() => tx`select app.owner_resumes_addon(${businessId}, ${id})`, "Only the owner resumes an Add-on");
      return byId(id);
    },

    async setPrices(changes) {
      for (const change of changes) {
        await tx`
          update addon_holding
          set price_minor = ${change.price},
              next_price_minor = ${change.nextPrice?.price ?? null},
              next_price_on = ${change.nextPrice?.effectiveOn ?? null}
          where id = ${change.id}`;
      }
    },
  };
};

export const daysOwedRepository = (tx: Transaction): DaysOwedRepository => ({
  async add(owed) {
    const rows = await tx<Row[]>`
      insert into days_owed (business_id, kind, subject, amount_minor, from_on, through_on)
      values (${owed.businessId}, ${owed.kind}, ${owed.subject}, ${owed.amount}, ${owed.from}, ${owed.through})
      returning *`;
    const row = rows[0];
    if (row === undefined) throw notFound("DaysOwedEntry");
    return toCharge(row);
  },

  async listOwed(businessId) {
    const rows = await tx<Row[]>`
      select * from days_owed
      where business_id = ${businessId} and payment_id is null
      order by created_at`;
    return rows.map(toCharge);
  },

  async settle(businessId, paymentId) {
    await tx`
      update days_owed set payment_id = ${paymentId}
      where business_id = ${businessId} and payment_id is null`;
  },
});
