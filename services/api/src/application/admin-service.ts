import {
  applyPayment,
  changePlan,
  forbidden,
  instant,
  money,
  notFound,
  parseLocalDate,
  validationFailed,
  shouldDeactivate,
  todayIn,
  timeZone,
  type Business,
  type BusinessId,
  type Clock,
  type Patch,
  type Payment,
  type BillingStatus,
  type Plan,
  type User,
  type UserId,
} from "@tor-now/domain";
import { PAGINATION } from "../config.ts";
import { AUDIT_ACTIONS, type AuditLogEntry } from "../ports/audit.ts";
import type {
  BusinessVolume,
  MonthCount,
  Page,
  Repositories,
  WeeklyAppointmentActivity,
} from "../ports/repositories.ts";
import type { Actor, UnitOfWork } from "../ports/unit-of-work.ts";
import { requireAdministrator, requireOperator } from "./authorization.ts";
import { currentVersionOf, subscriptionView, type SubscriptionView } from "./billing.ts";
import {
  directoryRow,
  filterDirectory,
  NO_FILTER,
  type DirectoryCounts,
  type DirectoryFilter,
  type DirectoryRow,
} from "./business-directory.ts";

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

/**
 * A read-only snapshot of the platform's health: no customer, no Business
 * name beyond a leaderboard's, nothing an administrator could not already see
 * one Business at a time. Only counted differently.
 */
export type PlatformStats = {
  /** The same five statuses the Businesses tab filters by. */
  readonly statusCounts: Readonly<Record<BillingStatus, number>>;
  readonly planCounts: Readonly<Record<Plan, number>>;
  readonly monthlyRecurringRevenueMinor: number;
  readonly totalUsers: number;
  readonly businessSignupsByMonth: readonly MonthCount[];
  readonly userSignupsByMonth: readonly MonthCount[];
  readonly appointmentActivityByWeek: readonly WeeklyAppointmentActivity[];
  readonly topBusinesses: readonly BusinessVolume[];
};

/** One page of the directory, with how many match and what each filter would show. */
export type DirectoryPage = {
  readonly rows: readonly DirectoryRow[];
  readonly total: number;
  readonly counts: DirectoryCounts;
};

export const adminService = (dependencies: {
  unitOfWork: UnitOfWork;
  clock: Clock;
}) => {
  const { unitOfWork, clock } = dependencies;

  /** Every Business, with its standing worked out against its own today. */
  const directoryOf = async (repositories: Repositories): Promise<readonly DirectoryRow[]> => {
    const [entries, versions] = await Promise.all([
      repositories.subscriptions.directory(),
      repositories.planVersions.listAll(),
    ]);
    const byId = new Map(versions.map((version) => [version.id, version]));
    return entries.map((entry) => {
      const version = byId.get(entry.subscription.planVersionId);
      if (version === undefined) throw notFound("PlanVersion", entry.subscription.planVersionId);
      return directoryRow(entry, version, todayIn(clock.now(), entry.business.timeZone));
    });
  };

  return {
    async listBusinesses(
      actor: Actor,
      filter: DirectoryFilter = NO_FILTER,
      page: Page = { limit: PAGINATION.defaultPageSize, offset: 0 },
    ): Promise<DirectoryPage> {
      requireAdministrator(actor);
      return unitOfWork.run(actor, async ({ repositories }) => {
        const result = filterDirectory(await directoryOf(repositories), filter);
        return {
          rows: result.rows.slice(page.offset, page.offset + page.limit),
          total: result.rows.length,
          counts: result.counts,
        };
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
      changes: Patch<{
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
      page: Page = { limit: PAGINATION.defaultPageSize, offset: 0 },
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
     * ADR 0008's erasure path, answering a formal request under Israel's
     * Privacy Protection Law. Distinct from deactivation: that hides a person
     * and can be undone, this removes them and cannot.
     *
     * An administrator action because a formal request reaches the operator,
     * not a screen — and because it is irreversible, which is not something to
     * put behind a button a customer can press by accident.
     */
    async anonymiseUser(actor: Actor, userId: UserId, reason: string): Promise<User> {
      const administratorId = requireAdministrator(actor);
      if (administratorId === userId) {
        throw forbidden("An administrator cannot erase their own account");
      }
      if (reason.trim().length < 3) {
        throw validationFailed("An erasure has to record why it was carried out");
      }

      return unitOfWork.run(actor, async (session) => {
        const erased = await session.repositories.users.anonymise(userId);
        await session.audit.append({
          actorId: administratorId,
          action: AUDIT_ACTIONS.userAnonymised,
          entityType: "User",
          entityId: userId,
          before: null,
          // The reason, not the data: what was removed is precisely what must
          // not be kept here.
          after: { reason: reason.trim() },
        });
        return erased;
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
        const business = await repositories.businesses.findById(businessId);
        if (business === null) throw notFound("Business", businessId);
        const [view, payments] = await Promise.all([
          subscriptionView(repositories, businessId, todayIn(clock.now(), business.timeZone)),
          repositories.payments.listForBusiness(businessId),
        ]);
        return { ...view, payments };
      });
    },

    /**
     * Putting a Business on another Plan on its owner's behalf, by the owner's
     * own rule (ADR 0020): an upgrade at once, a downgrade at the renewal, so
     * nothing already paid for is taken away. Audited by the decorator.
     */
    async changePlan(actor: Actor, businessId: BusinessId, plan: Plan): Promise<SubscriptionView> {
      requireAdministrator(actor);
      return unitOfWork.run(actor, async ({ repositories }) => {
        const business = await repositories.businesses.findById(businessId);
        if (business === null) throw notFound("Business", businessId);
        const today = todayIn(clock.now(), business.timeZone);
        const view = await subscriptionView(repositories, businessId, today);
        const target = await currentVersionOf(repositories, plan);
        const changed = changePlan(view.subscription, { from: view.planVersion, to: target });
        await repositories.subscriptions.update(businessId, {
          planVersionId: changed.planVersionId,
          scheduledMove: changed.scheduledMove,
        });
        return subscriptionView(repositories, businessId, today);
      });
    },

    /**
     * Counts only, never an identity. A business's status, plan and place on
     * the leaderboard are all things its own row on the Businesses tab already
     * shows one at a time — this is the same facts, summed. Not audited: it
     * exposes nothing a customer-record read does (ADR 0006), so it is a read
     * like `listBusinesses`, not like `readCustomerRecord`.
     */
    async platformStats(
      actor: Actor,
      weeks: number = 8,
      months: number = 12,
    ): Promise<PlatformStats> {
      requireAdministrator(actor);
      return unitOfWork.run(actor, async ({ repositories }) => {
        const rows = await directoryOf(repositories);
        const { counts } = filterDirectory(rows, NO_FILTER);
        // A Trial owes nothing and a lapsed or deactivated Business is not being
        // billed, so only paid time — running or in grace — is revenue.
        const monthlyRecurringRevenueMinor = rows
          .filter((row) => row.standing.status === "PAID" || row.standing.status === "IN_GRACE")
          .reduce((sum, row) => sum + row.planVersion.terms.price, 0);

        const to = clock.now();
        const weeksFrom = instant(to - weeks * 7 * 24 * 60 * 60 * 1000);
        // A month's length varies; this is a chart's lookback, not a billing
        // date, so 30 days per month is close enough.
        const monthsFrom = instant(to - months * 30 * 24 * 60 * 60 * 1000);

        const [
          businessSignupsByMonth,
          userSignupsByMonth,
          appointmentActivityByWeek,
          topBusinesses,
          totalUsers,
        ] = await Promise.all([
          repositories.businesses.monthlySignups(monthsFrom, to),
          repositories.users.monthlySignups(monthsFrom, to),
          repositories.appointments.platformWeeklyActivity(weeksFrom, to),
          repositories.appointments.topBusinessesByVolume(weeksFrom, to, 10),
          repositories.users.count(),
        ]);

        return {
          statusCounts: counts.statuses,
          planCounts: counts.plans,
          monthlyRecurringRevenueMinor,
          totalUsers,
          businessSignupsByMonth,
          userSignupsByMonth,
          appointmentActivityByWeek,
          topBusinesses,
        };
      });
    },

    async auditLog(
      actor: Actor,
      page: Page = { limit: PAGINATION.defaultPageSize, offset: 0 },
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
      // Cron calls this with no human behind it, which is the normal case; an
      // administrator may also run it by hand.
      requireOperator(actor);
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
