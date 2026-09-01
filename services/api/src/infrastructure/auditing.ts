import type { UserId } from "@tor-now/domain";
import { AUDIT_ACTIONS, type AuditSink } from "../ports/audit.ts";
import type {
  AppointmentRepository,
  BlockRepository,
  BusinessRepository,
  DateOverrideRepository,
  Repositories,
  ResourceRepository,
  ServiceRepository,
  UserRepository,
  WorkingHoursRepository,
} from "../ports/repositories.ts";

/**
 * ADR 0006: audit rows are produced by a decorator wrapping each repository,
 * not by call sites. Each decorator implements the same interface as the
 * repository it wraps, reads the prior state, delegates the mutation, and
 * appends the audit row — inside the same transaction, because a committed
 * change without its audit row is not an acceptable state.
 *
 * Domain services depend on the repository interface and are unaware that
 * auditing happens at all. Adding it to a new entity is a change here and in
 * the composition root, not an edit to every mutation site.
 */

type Context = { readonly sink: AuditSink; readonly actorId: UserId | null };

const record = async (
  { sink, actorId }: Context,
  action: string,
  entityType: string,
  entityId: string | null,
  before: unknown,
  after: unknown,
): Promise<void> => {
  await sink.append({ actorId, action, entityType, entityId, before, after });
};

export const auditedAppointments = (
  inner: AppointmentRepository,
  context: Context,
): AppointmentRepository => ({
  ...inner,
  async create(draft) {
    const created = await inner.create(draft);
    await record(
      context,
      AUDIT_ACTIONS.appointmentBooked,
      "Appointment",
      created.id,
      null,
      created,
    );
    return created;
  },
  async update(id, changes) {
    const before = await inner.findById(id);
    const after = await inner.update(id, changes);
    await record(
      context,
      actionForAppointmentChange(changes),
      "Appointment",
      id,
      before,
      after,
    );
    return after;
  },
});

/**
 * The log is read by people asking specific questions, so a cancellation and a
 * reschedule are different actions rather than one generic update.
 */
const actionForAppointmentChange = (
  changes: Parameters<AppointmentRepository["update"]>[1],
): string => {
  if (changes.status === "CANCELLED") return AUDIT_ACTIONS.appointmentCancelled;
  if (changes.status === "NO_SHOW") return AUDIT_ACTIONS.appointmentNoShow;
  if (changes.status === "CONFIRMED" && changes.startAt === undefined) {
    return AUDIT_ACTIONS.appointmentNoShowCleared;
  }
  return AUDIT_ACTIONS.appointmentRescheduled;
};

export const auditedBusinesses = (
  inner: BusinessRepository,
  context: Context,
): BusinessRepository => ({
  ...inner,
  async create(business) {
    const created = await inner.create(business);
    await record(
      context,
      AUDIT_ACTIONS.businessRegistered,
      "Business",
      created.id,
      null,
      created,
    );
    return created;
  },
  async update(id, changes) {
    const before = await inner.findById(id);
    const after = await inner.update(id, changes);
    await record(context, AUDIT_ACTIONS.businessUpdated, "Business", id, before, after);
    return after;
  },
  async setActive(id, active) {
    const before = await inner.findById(id);
    const after = await inner.setActive(id, active);
    await record(
      context,
      active ? AUDIT_ACTIONS.businessActivated : AUDIT_ACTIONS.businessDeactivated,
      "Business",
      id,
      before,
      after,
    );
    return after;
  },
});

export const auditedServices = (
  inner: ServiceRepository,
  context: Context,
): ServiceRepository => ({
  ...inner,
  async create(service) {
    const created = await inner.create(service);
    await record(context, AUDIT_ACTIONS.serviceCreated, "Service", created.id, null, created);
    return created;
  },
  async update(id, changes) {
    const before = await inner.findById(id);
    const after = await inner.update(id, changes);
    await record(context, AUDIT_ACTIONS.serviceUpdated, "Service", id, before, after);
    return after;
  },
  async delete(id) {
    const before = await inner.findById(id);
    await inner.delete(id);
    await record(context, AUDIT_ACTIONS.serviceDeleted, "Service", id, before, null);
  },
});

export const auditedResources = (
  inner: ResourceRepository,
  context: Context,
): ResourceRepository => ({
  ...inner,
  async create(resource) {
    const created = await inner.create(resource);
    await record(context, AUDIT_ACTIONS.resourceCreated, "Resource", created.id, null, created);
    return created;
  },
  async update(id, changes) {
    const before = await inner.findById(id);
    const after = await inner.update(id, changes);
    await record(context, AUDIT_ACTIONS.resourceUpdated, "Resource", id, before, after);
    return after;
  },
  async delete(id) {
    const before = await inner.findById(id);
    await inner.delete(id);
    await record(context, AUDIT_ACTIONS.resourceDeleted, "Resource", id, before, null);
  },
});

export const auditedWorkingHours = (
  inner: WorkingHoursRepository,
  context: Context,
): WorkingHoursRepository => ({
  ...inner,
  async create(hours) {
    const created = await inner.create(hours);
    await record(
      context,
      AUDIT_ACTIONS.workingHoursChanged,
      "WorkingHours",
      created.id,
      null,
      created,
    );
    return created;
  },
  async update(id, changes) {
    const after = await inner.update(id, changes);
    await record(context, AUDIT_ACTIONS.workingHoursChanged, "WorkingHours", id, null, after);
    return after;
  },
  async delete(id) {
    await inner.delete(id);
    await record(context, AUDIT_ACTIONS.workingHoursChanged, "WorkingHours", id, null, null);
  },
});

export const auditedDateOverrides = (
  inner: DateOverrideRepository,
  context: Context,
): DateOverrideRepository => ({
  ...inner,
  async put(override) {
    const before = await inner.findByDate(override.resourceId, override.date);
    const after = await inner.put(override);
    await record(
      context,
      AUDIT_ACTIONS.dateOverrideChanged,
      "DateOverride",
      after.id,
      before,
      after,
    );
    return after;
  },
  async delete(id) {
    await inner.delete(id);
    await record(context, AUDIT_ACTIONS.dateOverrideChanged, "DateOverride", id, null, null);
  },
});

export const auditedBlocks = (
  inner: BlockRepository,
  context: Context,
): BlockRepository => ({
  ...inner,
  async create(block) {
    const created = await inner.create(block);
    await record(context, AUDIT_ACTIONS.blockCreated, "Block", created.id, null, created);
    return created;
  },
  async delete(id) {
    await inner.delete(id);
    await record(context, AUDIT_ACTIONS.blockDeleted, "Block", id, null, null);
  },
});

export const auditedUsers = (
  inner: UserRepository,
  context: Context,
): UserRepository => ({
  ...inner,
  async update(id, changes) {
    const before = await inner.findById(id);
    const after = await inner.update(id, changes);
    await record(context, AUDIT_ACTIONS.userUpdated, "User", id, before, after);
    return after;
  },
  async softDelete(id) {
    const before = await inner.findById(id);
    const after = await inner.softDelete(id);
    await record(context, AUDIT_ACTIONS.userDeleted, "User", id, before, after);
    return after;
  },
  async restore(id) {
    const after = await inner.restore(id);
    await record(context, AUDIT_ACTIONS.userRestored, "User", id, null, after);
    return after;
  },
  async anonymise(id) {
    const after = await inner.anonymise(id);
    // Neither `before` nor `after` carries the person's details. The trail
    // records that an erasure happened, by whom and to which row — recording
    // the values would keep exactly what the request asked to be removed.
    await record(context, AUDIT_ACTIONS.userAnonymised, "User", id, null, {
      anonymisedAt: after.anonymisedAt,
    });
    return after;
  },
  async setAdministrator(id, isAdministrator) {
    const before = await inner.findById(id);
    const after = await inner.setAdministrator(id, isAdministrator);
    await record(
      context,
      isAdministrator
        ? AUDIT_ACTIONS.administratorGranted
        : AUDIT_ACTIONS.administratorRevoked,
      "User",
      id,
      before,
      after,
    );
    return after;
  },
});

/** Applied where repositories are wired, which is the only place that knows. */
export const withAuditing = (
  repositories: Repositories,
  context: Context,
): Repositories => ({
  ...repositories,
  users: auditedUsers(repositories.users, context),
  businesses: auditedBusinesses(repositories.businesses, context),
  resources: auditedResources(repositories.resources, context),
  services: auditedServices(repositories.services, context),
  workingHours: auditedWorkingHours(repositories.workingHours, context),
  dateOverrides: auditedDateOverrides(repositories.dateOverrides, context),
  blocks: auditedBlocks(repositories.blocks, context),
  appointments: auditedAppointments(repositories.appointments, context),
});
