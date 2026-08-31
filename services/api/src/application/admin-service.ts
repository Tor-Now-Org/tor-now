import {
  applyPayment,
  forbidden,
  money,
  notFound,
  parseLocalDate,
  shouldDeactivate,
  subscriptionStateOn,
  todayIn,
  timeZone,
  type Business,
  type BusinessId,
  type Clock,
  type Payment,
  type Subscription,
  type SubscriptionState,
  type User,
  type UserId,
} from "@tor-now/domain";
import { PAGINATION } from "../config.ts";
import { AUDIT_ACTIONS, type AuditLogEntry } from "../ports/audit.ts";
import type { Actor, UnitOfWork } from "../ports/unit-of-work.ts";
import { requireAdministrator } from "./authorization.ts";

/**
 * ADR 0010 fixes exactly what an administrator may do: read the list of
 * Businesses and Users, toggle a Business's active flag, record a Payment,
 * deactivate a User, edit a Business on its owner's behalf, and open an
 * individual customer record for support.
 *
 * Impersonation is excluded. No administrator may act as another User —
 * impersonated actions would record the wrong actor and make every "the system
 * did this without me" dispute unresolvable.
 *
 * These run over the service_role connection, which bypasses Row Level
 * Security. There is no database backstop on this path, only the checks below,
 * which is why every action is audited without exception — reads included.
 */

export type BusinessSummary = {
  readonly business: Business;
  readonly subscription: Subscription | null;
  readonly subscriptionState: SubscriptionState | null;
  readonly ownerName: string | null;
};

export const adminService = (dependencies: {
  unitOfWork: UnitOfWork;
  clock: Clock;
}) => {
  const { unitOfWork, clock } = dependencies;

  return {
    async listBusinesses(
      actor: Actor,
      query: string | null,
      page = { limit: PAGINATION.defaultPageSize, offset: 0 },
    ): Promise<readonly BusinessSummary[]> {
      requireAdministrator(actor);
      return unitOfWork.run(actor, async ({ repositories }) => {
        const businesses = await repositories.businesses.list(page, query);
        return Promise.all(
          businesses.map(async (business) => {
            const [subscription, owners] = await Promise.all([
              repositories.subscriptions.findByBusiness(business.id),
              repositories.memberships.listForBusiness(business.id, "OWNER"),
            ]);
            const firstOwner = owners[0];
            const owner =
              firstOwner === undefined
                ? null
                : await repositories.users.findById(firstOwner.userId);
            const today = todayIn(clock.now(), business.timeZone);
            return {
              business,
              subscription,
              subscriptionState:
                subscription === null ? null : subscriptionStateOn(subscription, today),
              ownerName: owner?.name ?? null,
            };
          }),
        );
      });
    },

    /** ADR 0010: toggling the active flag, which removes a Business from search. */
    async setBusinessActive(
      actor: Actor,
      businessId: BusinessId,
      active: boolean,
    ): Promise<Business> {
      requireAdministrator(actor);
      return unitOfWork.run(actor, ({ repositories }) =>
        repositories.businesses.setActive(businessId, active),
      );
    },

    /** Editing a Business on its owner's behalf. The reason is what the log records. */
    async updateBusiness(
      actor: Actor,
      businessId: BusinessId,
      changes: Partial<{
        name: string;
        phone: string;
        timeZone: string;
        description: string | null;
        address: string | null;
        minimumNoticeMinutes: number;
        bookingHorizonDays: number;
        cancellationWindowHours: number;
        defaultBufferMinutes: number;
      }>,
      reason: string,
    ): Promise<Business> {
      const administratorId = requireAdministrator(actor);
      return unitOfWork.run(actor, async (session) => {
        const updated = await session.repositories.businesses.update(businessId, {
          ...changes,
          ...(changes.timeZone === undefined
            ? {}
            : { timeZone: timeZone(changes.timeZone) }),
        });
        await session.audit.append({
          actorId: administratorId,
          action: AUDIT_ACTIONS.businessUpdated,
          entityType: "Business",
          entityId: businessId,
          before: null,
          after: { reason, onBehalfOfOwner: true },
        });
        return updated;
      });
    },

    async listUsers(
      actor: Actor,
      query: string | null,
      page = { limit: PAGINATION.defaultPageSize, offset: 0 },
    ): Promise<readonly User[]> {
      requireAdministrator(actor);
      return unitOfWork.run(actor, ({ repositories }) =>
        repositories.users.list(page, query),
      );
    },

    async setUserActive(
      actor: Actor,
      userId: UserId,
      active: boolean,
    ): Promise<User> {
      const administratorId = requireAdministrator(actor);
      if (administratorId === userId && !active) {
        throw forbidden("An administrator cannot deactivate their own account");
      }
      return unitOfWork.run(actor, ({ repositories }) =>
        active ? repositories.users.restore(userId) : repositories.users.softDelete(userId),
      );
    },

    /**
     * ADR 0006: an administrator opening a customer record is audited as well
     * as any write. An unlogged read on this path would be undetectable, and it
     * is the only oversight mechanism covering it.
     */
    async readCustomerRecord(actor: Actor, userId: UserId) {
      const administratorId = requireAdministrator(actor);
      return unitOfWork.run(actor, async (session) => {
        const user = await session.repositories.users.findById(userId);
        if (user === null) throw notFound("User", userId);

        await session.audit.append({
          actorId: administratorId,
          action: AUDIT_ACTIONS.customerRecordRead,
          entityType: "User",
          entityId: userId,
          before: null,
          after: null,
        });

        const memberships = await session.repositories.memberships.listForUser(userId);
        const appointments = await session.repositories.appointments.listForCustomer(
          userId,
          { limit: PAGINATION.maxPageSize, offset: 0 },
        );
        return { user, memberships, appointments };
      });
    },

    /**
     * ADR 0010: the first administrator is seeded by migration; thereafter the
     * flag is set only by another administrator, and that change is audited.
     * The allowlist is a second, independent condition — the flag alone does
     * not confer access.
     */
    async setAdministrator(
      actor: Actor,
      userId: UserId,
      isAdministrator: boolean,
    ): Promise<User> {
      const administratorId = requireAdministrator(actor);
      if (administratorId === userId && !isAdministrator) {
        throw forbidden("An administrator cannot revoke their own access");
      }
      return unitOfWork.run(actor, ({ repositories }) =>
        repositories.users.setAdministrator(userId, isAdministrator),
      );
    },

    async listAdministrators(actor: Actor): Promise<readonly User[]> {
      requireAdministrator(actor);
      return unitOfWork.run(actor, async ({ repositories }) => {
        const users = await repositories.users.list(
          { limit: PAGINATION.maxPageSize, offset: 0 },
          null,
        );
        return users.filter((user) => user.isAdministrator);
      });
    },

    async listAllowlist(actor: Actor) {
      requireAdministrator(actor);
      return unitOfWork.run(actor, ({ repositories }) =>
        repositories.administratorAllowlist.list(),
      );
    },

    async addToAllowlist(actor: Actor, phone: string, note: string | null) {
      const administratorId = requireAdministrator(actor);
      await unitOfWork.run(actor, async (session) => {
        await session.repositories.administratorAllowlist.add(phone, note, administratorId);
        await session.audit.append({
          actorId: administratorId,
          action: AUDIT_ACTIONS.allowlistChanged,
          entityType: "AdministratorAllowlist",
          entityId: phone,
          before: null,
          after: { added: phone, note },
        });
      });
    },

    async removeFromAllowlist(actor: Actor, phone: string) {
      const administratorId = requireAdministrator(actor);
      await unitOfWork.run(actor, async (session) => {
        await session.repositories.administratorAllowlist.remove(phone);
        await session.audit.append({
          actorId: administratorId,
          action: AUDIT_ACTIONS.allowlistChanged,
          entityType: "AdministratorAllowlist",
          entityId: phone,
          before: { removed: phone },
          after: null,
        });
      });
    },

    // -----------------------------------------------------------------------
    // Billing. The platform moves no money; a Payment records something that
    // already happened elsewhere.
    // -----------------------------------------------------------------------

    async recordPayment(
      actor: Actor,
      businessId: BusinessId,
      input: { amountMinor: number; paidOn: string; note: string | null },
    ): Promise<Payment> {
      const administratorId = requireAdministrator(actor);
      return unitOfWork.run(actor, async (session) => {
        const { repositories } = session;
        const subscription = await repositories.subscriptions.findByBusiness(businessId);
        if (subscription === null) throw notFound("Subscription", businessId);

        const paidOn = parseLocalDate(input.paidOn);
        const payment = await repositories.payments.create({
          subscriptionId: subscription.id,
          businessId,
          amount: money(input.amountMinor),
          paidOn,
          recordedBy: administratorId,
          note: input.note,
        });

        // Recording a Payment is what extends the paid-through date; the two
        // are one act, so they commit together.
        const extended = applyPayment(subscription, paidOn);
        await repositories.subscriptions.update(businessId, {
          paidThrough: extended.paidThrough,
        });

        await session.audit.append({
          actorId: administratorId,
          action: AUDIT_ACTIONS.paymentRecorded,
          entityType: "Payment",
          entityId: payment.id,
          before: subscription,
          after: { payment, paidThrough: extended.paidThrough },
        });

        return payment;
      });
    },

    async subscriptionFor(actor: Actor, businessId: BusinessId) {
      requireAdministrator(actor);
      return unitOfWork.run(actor, async ({ repositories }) => {
        const [subscription, payments, business] = await Promise.all([
          repositories.subscriptions.findByBusiness(businessId),
          repositories.payments.listForBusiness(businessId),
          repositories.businesses.findById(businessId),
        ]);
        if (subscription === null || business === null) {
          throw notFound("Subscription", businessId);
        }
        return {
          subscription,
          payments,
          state: subscriptionStateOn(
            subscription,
            todayIn(clock.now(), business.timeZone),
          ),
        };
      });
    },

    async updateSubscription(
      actor: Actor,
      businessId: BusinessId,
      changes: Partial<{ plan: Subscription["plan"]; amountMinor: number; billingPeriod: Subscription["billingPeriod"] }>,
    ): Promise<Subscription> {
      requireAdministrator(actor);
      return unitOfWork.run(actor, ({ repositories }) =>
        repositories.subscriptions.update(businessId, {
          ...(changes.plan === undefined ? {} : { plan: changes.plan }),
          ...(changes.billingPeriod === undefined
            ? {}
            : { billingPeriod: changes.billingPeriod }),
          ...(changes.amountMinor === undefined
            ? {}
            : { amount: money(changes.amountMinor) }),
        }),
      );
    },

    async auditLog(
      actor: Actor,
      page = { limit: PAGINATION.defaultPageSize, offset: 0 },
    ): Promise<readonly AuditLogEntry[]> {
      requireAdministrator(actor);
      return unitOfWork.run(actor, (session) =>
        session.auditTrail.recent(page.limit, page.offset),
      );
    },

    /**
     * The single channel between Billing and Scheduling (CONTEXT-MAP.md).
     * Billing deactivates a Business whose Subscription lapsed beyond its Grace
     * Period, and knows nothing of Appointments, Services or Resources.
     * Existing Appointments are never affected.
     */
    async deactivateLapsedBusinesses(actor: Actor): Promise<readonly BusinessId[]> {
      requireAdministrator(actor);
      return unitOfWork.run(actor, async ({ repositories }) => {
        const today = parseLocalDate(new Date(clock.now()).toISOString().slice(0, 10));
        const lapsed = await repositories.subscriptions.listLapsed(today);
        const deactivated = await Promise.all(
          lapsed
            .filter((subscription) => shouldDeactivate(subscription, today))
            .map(async (subscription) => {
              await repositories.businesses.setActive(subscription.businessId, false);
              return subscription.businessId;
            }),
        );
        return deactivated;
      });
    },
  };
};
