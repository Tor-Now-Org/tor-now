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
  PlanVersionRepository,
  PreviewRepository,
  SubscriptionRepository,
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
    return {
      planVersionId: asId(text(row["plan_version_id"])),
      grants: grants.map((grant) => ({
        feature: parseFeature(text(grant["feature"])),
        endsOn: parseLocalDate(text(grant["endsOn"])),
      })),
    };
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

export const planVersionRepository = (tx: Transaction): PlanVersionRepository => ({
  async findById(id) {
    const rows = await tx<Row[]>`select * from plan_version where id = ${id}`;
    const row = rows[0];
    return row === undefined ? null : toPlanVersion(row);
  },

  async listCurrent() {
    const rows = await tx<Row[]>`
      select distinct on (plan) * from plan_version order by plan, number desc`;
    return rows.map(toPlanVersion);
  },

  async listAll() {
    const rows = await tx<Row[]>`select * from plan_version order by plan, number`;
    return rows.map(toPlanVersion);
  },
});

export const previewRepository = (tx: Transaction): PreviewRepository => ({
  async list() {
    const rows = await tx<Row[]>`select * from feature_preview order by feature`;
    return rows.map(toPreview);
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

export const unitRateRepository = (tx: Transaction): UnitRateRepository => ({
  async list() {
    const rows = await tx<Row[]>`
      select unit, effective_from, micro_shekels, source
      from unit_rate order by unit, effective_from`;
    return rows.map((row) => ({
      unit: toCostUnit(text(row["unit"])),
      effectiveFrom: toLocalDate(row["effective_from"]),
      perUnit: microShekels(Number(row["micro_shekels"])),
      source: text(row["source"]),
    }));
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
