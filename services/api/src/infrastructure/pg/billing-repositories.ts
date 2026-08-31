import { GRACE_PERIOD_DAYS, notFound } from "@tor-now/domain";
import type {
  PaymentRepository,
  SubscriptionRepository,
} from "../../ports/repositories.ts";
import type { Transaction } from "./client.ts";
import { toPayment, toSubscription, type Row } from "./mappers.ts";

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
    const rows = await tx<Row[]>`
      update subscription set
        plan = coalesce(${changes.plan ?? null}, plan),
        amount_minor = coalesce(${changes.amount ?? null}, amount_minor),
        billing_period = coalesce(${changes.billingPeriod ?? null}, billing_period),
        paid_through = coalesce(${changes.paidThrough ?? null}, paid_through)
      where business_id = ${businessId}
      returning *`;
    const row = rows[0];
    if (row === undefined) throw notFound("Subscription");
    return toSubscription(row);
  },

  /**
   * The single channel between Billing and Scheduling: Subscriptions past the
   * Grace Period whose Business is still active. A free plan never appears
   * here — it has nothing to pay.
   */
  async listLapsed(today) {
    const rows = await tx<Row[]>`
      select s.* from subscription s
      join business b on b.id = s.business_id
      where s.plan <> 'FREE'
        and b.active
        and s.paid_through + ${GRACE_PERIOD_DAYS} < ${today}::date`;
    return rows.map(toSubscription);
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
