import {
  asId,
  displayName,
  DomainError,
  forbidden,
  GRACE_PERIOD_DAYS,
  notFound,
  parseFeature,
  parseLocalDate,
  COST_UNITS,
  microShekels,
  type CostSource,
  type CostUnit,
} from "@tor-now/domain";
import type {
  PaymentRepository,
  PlanEdition,
  PlanVersionRepository,
  PreviewEntry,
  PreviewRepository,
  SubscriptionRepository,
  UnitRateEntry,
  UnitRateRepository,
  UsageRecordRepository,
} from "../../ports/repositories.ts";
import { errorCodeOf, PG_ERRORS, type Transaction } from "./client.ts";
import {
  text,
  toBusiness,
  toLocalDate,
  toPayment,
  toPlanVersion,
  toPreview,
  toInstant,
  toPlan,
  toSubscription,
  type Row,
} from "./mappers.ts";

/** Raised by app.start_subscription when the caller may not start one. */
const INSUFFICIENT_PRIVILEGE = "42501";

export const subscriptionRepository = (
  tx: Transaction,
): SubscriptionRepository => ({
  async findByBusiness(businessId) {
    const rows = await tx<Row[]>`
      select * from subscription where business_id = ${businessId}`;
    const row = rows[0];
    return row === undefined ? null : toSubscription(row);
  },

  async update(businessId, changes) {
    // A scheduled move is two columns that are set or cleared together.
    const move = changes.scheduledMove;
    const rows = await tx<Row[]>`
      update subscription set
        plan_version_id = coalesce(${changes.planVersionId ?? null}, plan_version_id),
        trial_ends_on = ${
          changes.trialEndsOn === undefined ? tx`trial_ends_on` : tx`${changes.trialEndsOn}`
        },
        paid_through = ${
          changes.paidThrough === undefined ? tx`paid_through` : tx`${changes.paidThrough}`
        },
        scheduled_version_id = ${
          move === undefined ? tx`scheduled_version_id` : tx`${move?.planVersionId ?? null}`
        },
        scheduled_on = ${move === undefined ? tx`scheduled_on` : tx`${move?.effectiveOn ?? null}`}
      where business_id = ${businessId}
      returning *`;
    const row = rows[0];
    if (row === undefined) throw notFound("Subscription", businessId);
    return toSubscription(row);
  },

  async setPlanAsOwner(businessId, terms) {
    try {
      await tx`
        select app.owner_sets_plan(
          ${businessId},
          ${terms.planVersionId},
          ${terms.scheduledMove?.planVersionId ?? null},
          ${terms.scheduledMove?.effectiveOn ?? null})`;
    } catch (error) {
      const code = errorCodeOf(error);
      if (code === INSUFFICIENT_PRIVILEGE) throw forbidden("Only the owner changes the plan");
      if (code === PG_ERRORS.checkViolation) {
        throw new DomainError("CONFLICT", error instanceof Error ? error.message : "The plan could not be changed");
      }
      throw error;
    }
    const rows = await tx<Row[]>`select * from subscription where business_id = ${businessId}`;
    const row = rows[0];
    if (row === undefined) throw notFound("Subscription", businessId);
    return toSubscription(row);
  },

  async listDueMoves(today) {
    const rows = await tx<Row[]>`
      select * from subscription
      where scheduled_on is not null and scheduled_on <= ${today}::date`;
    return rows.map(toSubscription);
  },

  async start(businessId, terms) {
    try {
      await tx`select app.start_subscription(${businessId}, ${terms.planVersionId}, ${terms.trialEndsOn})`;
    } catch (error) {
      const code = errorCodeOf(error);
      if (code === INSUFFICIENT_PRIVILEGE) throw forbidden("Only a new Business's owner starts its Subscription");
      if (code === PG_ERRORS.checkViolation) {
        throw new DomainError(
          "CONFLICT",
          error instanceof Error ? error.message : "The Subscription could not be started",
        );
      }
      throw error;
    }
    const rows = await tx<Row[]>`select * from subscription where business_id = ${businessId}`;
    const row = rows[0];
    if (row === undefined) throw notFound("Subscription", businessId);
    return toSubscription(row);
  },

  async listLapsed(today) {
    const rows = await tx<Row[]>`
      select s.* from subscription s
      join business b on b.id = s.business_id
      where b.active
        and case
          when s.paid_through is null then s.trial_ends_on is null or s.trial_ends_on < ${today}::date
          else s.paid_through + ${GRACE_PERIOD_DAYS}::integer < ${today}::date
        end`;
    return rows.map(toSubscription);
  },

  async entitlementBasis(businessId) {
    const rows = await tx<Row[]>`select * from app.entitlement_basis(${businessId})`;
    const row = rows[0];
    if (row === undefined) return null;
    const grants = row["grants"] as readonly Row[];
    const addons = row["addons"] as readonly Row[];
    return {
      planVersionId: asId(text(row["plan_version_id"])),
      grants: grants.map((grant) => ({
        feature: parseFeature(text(grant["feature"])),
        endsOn: parseLocalDate(text(grant["endsOn"])),
      })),
      addons: addons.map((addon) => ({
        feature: parseFeature(text(addon["feature"])),
        addedOn: parseLocalDate(text(addon["addedOn"])),
        endsOn: addon["endsOn"] === null ? null : parseLocalDate(text(addon["endsOn"])),
      })),
      trialEndsOn: row["trial_ends_on"] === null ? null : toLocalDate(row["trial_ends_on"]),
    };
  },

  async plansHeld(businessId) {
    const rows = await tx<Row[]>`select plan from plan_held where business_id = ${businessId} order by plan`;
    return rows.map((row) => toPlan(row["plan"]));
  },

  async holdPlan(businessId, plan) {
    await tx`insert into plan_held (business_id, plan) values (${businessId}, ${plan}) on conflict do nothing`;
  },

  async directory() {
    const rows = await tx<Row[]>`
      select to_jsonb(b) as business, to_jsonb(s) as subscription,
             (select count(*)::int from resource r
               where r.business_id = b.id and r.active and r.paused_at is null) as on_offer,
             owner.given_name, owner.family_name, owner.phone as owner_phone
      from business b
      join subscription s on s.business_id = b.id
      left join lateral (
        select u.given_name, u.family_name, u.phone
        from membership m join app_user u on u.id = m.user_id
        where m.business_id = b.id and m.role = 'OWNER'
        order by m.created_at
        limit 1
      ) owner on true
      order by b.created_at desc`;
    return rows.map((row) => {
      const givenName = row["given_name"];
      return {
        business: toBusiness(row["business"] as Row),
        subscription: toSubscription(row["subscription"] as Row),
        resourcesOnOffer: Number(row["on_offer"]),
        owner:
          givenName === null || givenName === undefined
            ? null
            : {
                name: displayName({
                  givenName: text(givenName),
                  familyName: row["family_name"] === null ? null : text(row["family_name"]),
                }),
                phone: text(row["owner_phone"]),
              },
      };
    });
  },
});

const toPlanEdition = (row: Row): PlanEdition => ({
  ...toPlanVersion(row),
  publishedAt: toInstant(row["created_at"]),
  withdrawnAt: row["withdrawn_at"] === null ? null : toInstant(row["withdrawn_at"]),
  firstMoveOn: row["first_move_on"] === null ? null : toLocalDate(row["first_move_on"]),
});

export const planVersionRepository = (tx: Transaction): PlanVersionRepository => ({
  async findById(id) {
    const rows = await tx<Row[]>`select * from plan_version where id = ${id}`;
    const row = rows[0];
    return row === undefined ? null : toPlanVersion(row);
  },

  async listCurrent() {
    const rows = await tx<Row[]>`
      select distinct on (plan) * from plan_version
      where withdrawn_at is null
      order by plan, number desc`;
    return rows.map(toPlanVersion);
  },

  async listAll() {
    const rows = await tx<Row[]>`select * from plan_version order by plan, number`;
    return rows.map(toPlanVersion);
  },

  async listEditions() {
    const rows = await tx<Row[]>`select * from plan_version order by plan, number`;
    return rows.map(toPlanEdition);
  },

  async publish(edition) {
    const rows = await tx<Row[]>`
      insert into plan_version (plan, number, features, resource_allowance, price_minor, first_move_on)
      values (${edition.plan}, ${edition.number}, ${[...edition.terms.features]}::text[],
              ${edition.terms.resourceAllowance}, ${edition.terms.price}, ${edition.firstMoveOn})
      returning *`;
    const row = rows[0];
    if (row === undefined) throw notFound("PlanVersion", `${edition.plan}:${edition.number}`);
    return toPlanEdition(row);
  },

  async setTerms(id, terms) {
    const rows = await tx<Row[]>`
      update plan_version
      set features = ${[...terms.features]}::text[],
          resource_allowance = ${terms.resourceAllowance},
          price_minor = ${terms.price}
      where id = ${id}
      returning *`;
    const row = rows[0];
    if (row === undefined) throw notFound("PlanVersion", id);
    return toPlanVersion(row);
  },

  async withdraw(id, at) {
    await tx`update plan_version set withdrawn_at = ${new Date(at)} where id = ${id}`;
  },
});

const toPreviewEntry = (row: Row): PreviewEntry => {
  const keepOn = row["keep_on"];
  return {
    ...toPreview(row),
    placement: keepOn === null || keepOn === undefined ? null : { keepOn: (keepOn as string[]).map(toPlan) },
    decidedAt: row["decided_at"] === null ? null : toInstant(row["decided_at"]),
  };
};

export const previewRepository = (tx: Transaction): PreviewRepository => ({
  async list() {
    const rows = await tx<Row[]>`select * from feature_preview order by feature`;
    return rows.map(toPreview);
  },

  async listEntries() {
    const rows = await tx<Row[]>`select * from feature_preview order by feature`;
    return rows.map(toPreviewEntry);
  },

  async start(feature, endsOn) {
    const rows = await tx<Row[]>`
      insert into feature_preview (feature, ends_on) values (${feature}, ${endsOn})
      on conflict (feature) do update
      set ends_on = excluded.ends_on, keep_on = null, decided_at = null, created_at = now()
      returning *`;
    const row = rows[0];
    if (row === undefined) throw notFound("Preview", feature);
    return toPreviewEntry(row);
  },

  async setEnd(feature, endsOn) {
    const rows = await tx<Row[]>`
      update feature_preview set ends_on = ${endsOn} where feature = ${feature} returning *`;
    const row = rows[0];
    if (row === undefined) throw notFound("Preview", feature);
    return toPreviewEntry(row);
  },

  async place(feature, placement, at) {
    const rows = await tx<Row[]>`
      update feature_preview
      set keep_on = ${[...placement.keepOn]}::text[], ends_on = ${placement.endsOn}, decided_at = ${new Date(at)}
      where feature = ${feature}
      returning *`;
    const row = rows[0];
    if (row === undefined) throw notFound("Preview", feature);
    return toPreviewEntry(row);
  },
});

export const paymentRepository = (tx: Transaction): PaymentRepository => ({
  async create(payment) {
    const rows = await tx<Row[]>`
      insert into payment (subscription_id, business_id, amount_minor, paid_on, recorded_by, note)
      values (${payment.subscriptionId}, ${payment.businessId}, ${payment.amount},
              ${payment.paidOn}, ${payment.recordedBy}, ${payment.note})
      returning *`;
    const row = rows[0];
    if (row === undefined) throw notFound("Payment");
    return toPayment(row);
  },

  async listForBusiness(businessId) {
    const rows = await tx<Row[]>`
      select * from payment where business_id = ${businessId} order by paid_on desc`;
    return rows.map(toPayment);
  },
});

export const usageRecordRepository = (tx: Transaction): UsageRecordRepository => ({
  async record(records) {
    if (records.length === 0) return;
    await tx`
      insert into usage_record ${tx(
        records.map((record) => ({
          business_id: record.businessId,
          source: record.source,
          unit: record.unit,
          quantity: record.quantity,
          occurred_at: new Date(record.occurredAt),
        })),
      )}`;
  },

  async summarise(from, to) {
    const rows = await tx<Row[]>`
      select business_id, source, unit,
             (occurred_at at time zone 'UTC')::date as day,
             sum(quantity)::int as quantity
      from usage_record
      where occurred_at >= ${new Date(from)} and occurred_at < ${new Date(to)}
      group by business_id, source, unit, day
      order by business_id nulls first, source, unit, day`;
    return rows.map((row) => ({
      businessId: row["business_id"] === null ? null : asId(text(row["business_id"])),
      source: toCostSource(text(row["source"])),
      unit: toCostUnit(text(row["unit"])),
      day: toLocalDate(row["day"]),
      quantity: Number(row["quantity"]),
    }));
  },
});

const toUnitRateEntry = (row: Row): UnitRateEntry => ({
  unit: toCostUnit(text(row["unit"])),
  effectiveFrom: toLocalDate(row["effective_from"]),
  perUnit: microShekels(Number(row["micro_shekels"])),
  source: text(row["source"]),
  checkedBy:
    row["given_name"] === null || row["given_name"] === undefined
      ? null
      : displayName({
          givenName: text(row["given_name"]),
          familyName: row["family_name"] === null ? null : text(row["family_name"]),
        }),
  enteredAt: toInstant(row["entered_at"]),
});

export const unitRateRepository = (tx: Transaction): UnitRateRepository => ({
  async list() {
    const rows = await tx<Row[]>`
      select r.unit, r.effective_from, r.micro_shekels, r.source, r.entered_at,
             u.given_name, u.family_name
      from unit_rate r
      left join app_user u on u.id = r.checked_by
      order by r.unit, r.effective_from`;
    return rows.map(toUnitRateEntry);
  },

  async set(rate, checkedBy) {
    await tx`
      insert into unit_rate (unit, effective_from, micro_shekels, source, checked_by)
      values (${rate.unit}, ${rate.effectiveFrom}, ${rate.perUnit}, ${rate.source}, ${checkedBy})
      on conflict (unit, effective_from) do update
      set micro_shekels = excluded.micro_shekels,
          source = excluded.source,
          checked_by = excluded.checked_by,
          entered_at = now()`;
    const rows = await tx<Row[]>`
      select r.unit, r.effective_from, r.micro_shekels, r.source, r.entered_at,
             u.given_name, u.family_name
      from unit_rate r
      left join app_user u on u.id = r.checked_by
      where r.unit = ${rate.unit} and r.effective_from = ${rate.effectiveFrom}`;
    const row = rows[0];
    if (row === undefined) throw notFound("UnitRate", `${rate.unit}:${rate.effectiveFrom}`);
    return toUnitRateEntry(row);
  },
});

const toCostUnit = (value: string): CostUnit => {
  if (!(COST_UNITS as readonly string[]).includes(value)) {
    throw new Error(`Unknown cost unit in the database: ${value}`);
  }
  return value as CostUnit;
};

const toCostSource = (value: string): CostSource =>
  value === "BOOKING" || value === "SIGN_IN" || value === "BILLING" ? value : parseFeature(value);
