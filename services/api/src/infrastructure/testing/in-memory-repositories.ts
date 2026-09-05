import {
  asId,
  BUSINESS_DEFAULTS,
  DomainError,
  instant,
  isActive,
  money,
  notFound,
  parseLocalDate,
  timeZone,
  type Appointment,
  type Business,
  type BusinessPhoto,
  type Instant,
  type LocalDate,
  type TimeZone,
  type Membership,
  type Resource,
  type Service,
  type Subscription,
  type User,
  GRACE_PERIOD_DAYS,
  addDays,
  compareLocalDate,
  instantToZoned,
  dayOfWeek,
  displayName,
  localTime,
} from "@tor-now/domain";
import { SEARCH } from "../../config.ts";
import { PG_ERRORS } from "../pg/client.ts";
import type { Repositories } from "../../ports/repositories.ts";
import type { Store } from "./in-memory-store.ts";

/**
 * The second implementation of every repository port, held in memory.
 *
 * It is not a mock: it enforces the rules the database enforces, so a test that
 * passes here is testing the same behaviour production gets. In particular it
 * refuses an overlapping appointment the way ADR 0003's exclusion constraint
 * does — a double booking has to fail in both implementations or the seam is
 * lying.
 */

/**
 * The same grouping the database does, done here: an instant belongs to the
 * local day it falls on in the Business's zone, not the server's.
 */
const countByLocalDay = (
  starts: readonly Instant[],
  timeZone: TimeZone,
): readonly { date: LocalDate; count: number }[] => {
  const perDay = new Map<LocalDate, number>();
  for (const start of starts) {
    const date = instantToZoned(start, timeZone).date;
    perDay.set(date, (perDay.get(date) ?? 0) + 1);
  }
  return [...perDay.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => compareLocalDate(a.date, b.date));
};

export const inMemoryRepositories = (store: Store): Repositories => {
  const nextId = store.nextId;
  const now = () => instant(Date.now());

  const requireUser = (id: string): User => {
    const found = store.users.find((user) => user.id === id);
    if (found === undefined) throw notFound("User", id);
    return found;
  };

  const replaceUser = (updated: User): User => {
    store.users = store.users.map((user) => (user.id === updated.id ? updated : user));
    return updated;
  };

  return {
    users: {
      async findById(id) {
        const found = store.users.find((user) => user.id === id);
        return found === undefined || found.deletedAt !== null ? null : found;
      },
      async findByPhone(phone) {
        // Deleted rows are returned deliberately: ADR 0008 keeps the phone, and
        // sign-in has to tell "closed" from "unknown".
        return store.users.find((user) => user.phone === phone) ?? null;
      },
      async create({ phone, givenName, familyName, birthDate }) {
        if (store.users.some((user) => user.phone === phone)) {
          throw new DomainError("CONFLICT", "That phone number is already registered");
        }
        const user: User = {
          id: asId(nextId("user")),
          phone,
          givenName,
          familyName,
          birthDate,
          deletedAt: null,
          anonymisedAt: null,
          isAdministrator: false,
          createdAt: now(),
        };
        store.users = [...store.users, user];
        return user;
      },
      async update(id, changes) {
        const user = requireUser(id);
        return replaceUser({
          ...user,
          ...(changes.givenName === undefined ? {} : { givenName: changes.givenName }),
          ...(changes.familyName === undefined ? {} : { familyName: changes.familyName }),
          ...(changes.birthDate === undefined ? {} : { birthDate: changes.birthDate }),
        });
      },
      async softDelete(id) {
        return replaceUser({ ...requireUser(id), deletedAt: now() });
      },
      async restore(id) {
        return replaceUser({ ...requireUser(id), deletedAt: null });
      },
      async anonymise(id) {
        const user = requireUser(id);
        if (user.anonymisedAt !== null) return user;
        return replaceUser({
          ...user,
          phone: `anonymised:${nextId("erased")}`,
          givenName: "משתמש שהוסר",
          familyName: null,
          birthDate: null,
          deletedAt: user.deletedAt ?? now(),
          anonymisedAt: now(),
          isAdministrator: false,
        });
      },

      async setAdministrator(id, isAdministrator) {
        return replaceUser({ ...requireUser(id), isAdministrator });
      },
      async list(page, query) {
        const matching = store.users.filter(
          (user) =>
            query === null ||
            displayName(user).toLowerCase().includes(query.toLowerCase()) ||
            user.phone.includes(query),
        );
        return matching.slice(page.offset, page.offset + page.limit);
      },
    },

    businesses: {
      async findById(id) {
        return store.businesses.find((business) => business.id === id) ?? null;
      },
      /**
       * Trigram ranking is the database's; in memory a substring match with the
       * same prefix boost preserves the ordering the callers depend on.
       */
      async search(query) {
        return store.businesses
          .filter(
            (business) =>
              business.active &&
              business.name.toLowerCase().includes(query.toLowerCase()),
          )
          .map((business) => ({
            business,
            score:
              (business.name.toLowerCase().startsWith(query.toLowerCase())
                ? SEARCH.prefixBoost
                : 0) + 0.5,
          }))
          .sort((left, right) => right.score - left.score)
          .slice(0, SEARCH.maxResults);
      },
      async create(input) {
        const business: Business = {
          id: asId(nextId("business")),
          name: input.name,
          phone: input.phone,
          timeZone: timeZone(input.timeZone),
          description: input.description,
          address: input.address,
          instagram: null,
          whatsapp: null,
          active: true,
          defaultBufferMinutes: BUSINESS_DEFAULTS.defaultBufferMinutes,
          minimumNoticeMinutes: BUSINESS_DEFAULTS.minimumNoticeMinutes,
          bookingHorizonDays: BUSINESS_DEFAULTS.bookingHorizonDays,
          cancellationWindowHours: BUSINESS_DEFAULTS.cancellationWindowHours,
        };
        store.businesses = [...store.businesses, business];
        // Every Business has a Subscription, which the database does with a
        // trigger; here it is the same guarantee, made in the same place.
        store.subscriptions = [
          ...store.subscriptions,
          {
            id: asId(nextId("subscription")),
            businessId: business.id,
            plan: "FREE",
            amount: money(0),
            billingPeriod: "MONTHLY",
            paidThrough: parseLocalDate(new Date().toISOString().slice(0, 10)),
          },
        ];
        return business;
      },
      async update(id, changes) {
        const business = store.businesses.find((candidate) => candidate.id === id);
        if (business === undefined) throw notFound("Business", id);
        const updated: Business = {
          ...business,
          ...Object.fromEntries(
            Object.entries(changes).filter(([, value]) => value !== undefined),
          ),
          ...(changes.timeZone === undefined
            ? {}
            : { timeZone: timeZone(changes.timeZone) }),
        };
        store.businesses = store.businesses.map((candidate) =>
          candidate.id === id ? updated : candidate,
        );
        return updated;
      },
      async setActive(id, active) {
        const business = store.businesses.find((candidate) => candidate.id === id);
        if (business === undefined) throw notFound("Business", id);
        const updated = { ...business, active };
        store.businesses = store.businesses.map((candidate) =>
          candidate.id === id ? updated : candidate,
        );
        return updated;
      },
      async list(page, query) {
        return store.businesses
          .filter(
            (business) =>
              query === null ||
              business.name.toLowerCase().includes(query.toLowerCase()),
          )
          .slice(page.offset, page.offset + page.limit);
      },
    },

    businessPhotos: {
      async listForBusiness(businessId) {
        return store.businessPhotos
          .filter((photo) => photo.businessId === businessId)
          .sort((a, b) => a.slot - b.slot);
      },
      async findById(id) {
        return store.businessPhotos.find((photo) => photo.id === id) ?? null;
      },
      async create(input) {
        // The unique pair the schema enforces, enforced here too: the contract
        // suite runs against both, and an implementation that quietly allowed a
        // fifth photo would pass against memory and fail against Postgres.
        const taken = store.businessPhotos.some(
          (photo) =>
            photo.businessId === input.businessId && photo.slot === input.slot,
        );
        if (taken) {
          throw Object.assign(new Error("photo slot already taken"), {
            code: PG_ERRORS.uniqueViolation,
          });
        }
        const photo: BusinessPhoto = {
          id: asId(store.nextId("business_photo")),
          businessId: input.businessId,
          slot: input.slot,
          storagePath: input.storagePath,
          contentType: input.contentType,
          byteSize: input.byteSize,
        };
        store.businessPhotos.push(photo);
        return photo;
      },
      async delete(id) {
        store.businessPhotos = store.businessPhotos.filter(
          (photo) => photo.id !== id,
        );
      },
    },

    memberships: {
      async find(userId, businessId) {
        return (
          store.memberships.find(
            (membership) =>
              membership.userId === userId && membership.businessId === businessId,
          ) ?? null
        );
      },
      async listForUser(userId) {
        return store.memberships.filter((membership) => membership.userId === userId);
      },
      async listForBusiness(businessId, role) {
        return store.memberships.filter(
          (membership) =>
            membership.businessId === businessId && membership.role === role,
        );
      },
      async create(userId, businessId, role) {
        if (
          store.memberships.some(
            (membership) =>
              membership.userId === userId && membership.businessId === businessId,
          )
        ) {
          throw new DomainError("CONFLICT", "That membership already exists");
        }
        const membership: Membership = {
          id: asId(nextId("membership")),
          userId,
          businessId,
          role,
          createdAt: now(),
          blockedAt: null,
        };
        store.memberships = [...store.memberships, membership];
        return membership;
      },
      /** Never demotes: an owner booking at their own business stays the owner. */
      async ensureCustomer(userId, businessId) {
        const existing = store.memberships.find(
          (membership) =>
            membership.userId === userId && membership.businessId === businessId,
        );
        if (existing !== undefined) return existing;
        const membership: Membership = {
          id: asId(nextId("membership")),
          userId,
          businessId,
          role: "CUSTOMER",
          createdAt: now(),
          blockedAt: null,
        };
        store.memberships = [...store.memberships, membership];
        return membership;
      },
      async setBlocked(userId, businessId, blockedAt) {
        const existing = store.memberships.find(
          (membership) =>
            membership.userId === userId && membership.businessId === businessId,
        );
        if (existing === undefined) throw notFound("Membership", userId);
        const updated: Membership = { ...existing, blockedAt };
        store.memberships = store.memberships.map((membership) =>
          membership === existing ? updated : membership,
        );
        return updated;
      },
    },

    resources: {
      async findById(id) {
        return store.resources.find((resource) => resource.id === id) ?? null;
      },
      async listForBusiness(businessId) {
        return store.resources.filter((resource) => resource.businessId === businessId);
      },
      async create({ businessId, name }) {
        const resource: Resource = {
          id: asId(nextId("resource")),
          businessId,
          name,
          active: true,
        };
        store.resources = [...store.resources, resource];
        return resource;
      },
      async update(id, changes) {
        const resource = store.resources.find((candidate) => candidate.id === id);
        if (resource === undefined) throw notFound("Resource", id);
        const updated: Resource = {
          ...resource,
          ...(changes.name === undefined ? {} : { name: changes.name }),
          ...(changes.active === undefined ? {} : { active: changes.active }),
        };
        store.resources = store.resources.map((candidate) =>
          candidate.id === id ? updated : candidate,
        );
        return updated;
      },
      /** Withdraws a calendar that has been booked; see the pg repository. */
      async delete(id) {
        const booked = store.appointments.some(
          (appointment) => appointment.resourceId === id,
        );
        store.resources = booked
          ? store.resources.map((resource) =>
              resource.id === id ? { ...resource, active: false } : resource,
            )
          : store.resources.filter((resource) => resource.id !== id);
      },
    },

    services: {
      async findById(id) {
        return store.services.find((service) => service.id === id) ?? null;
      },
      async listForBusiness(businessId, includeInactive) {
        return store.services.filter(
          (service) =>
            service.businessId === businessId && (includeInactive || service.active),
        );
      },
      async create(input) {
        const service: Service = {
          id: asId(nextId("service")),
          businessId: input.businessId,
          name: input.name,
          durationMinutes: input.durationMinutes,
          price: input.price,
          bufferMinutes: input.bufferMinutes,
          active: true,
        };
        store.services = [...store.services, service];
        return service;
      },
      async update(id, changes) {
        const service = store.services.find((candidate) => candidate.id === id);
        if (service === undefined) throw notFound("Service", id);
        const updated: Service = {
          ...service,
          ...Object.fromEntries(
            Object.entries(changes).filter(([, value]) => value !== undefined),
          ),
        };
        store.services = store.services.map((candidate) =>
          candidate.id === id ? updated : candidate,
        );
        return updated;
      },
      /** A service that has been booked is withdrawn, never removed. */
      async delete(id) {
        const booked = store.appointments.some(
          (appointment) => appointment.serviceId === id,
        );
        if (booked) {
          store.services = store.services.map((service) =>
            service.id === id ? { ...service, active: false } : service,
          );
          return;
        }
        store.services = store.services.filter((service) => service.id !== id);
      },
    },

    workingHours: {
      async listForResource(resourceId) {
        return store.workingHours
          .filter((hours) => hours.resourceId === resourceId)
          .sort((left, right) => left.dayOfWeek - right.dayOfWeek || left.start - right.start);
      },
      async create(input) {
        const hours = {
          id: asId(nextId("working-hours")),
          resourceId: input.resourceId,
          businessId: input.businessId,
          dayOfWeek: dayOfWeek(input.dayOfWeek),
          start: localTime(input.startMinutes),
          end: localTime(input.endMinutes),
        } as (typeof store.workingHours)[number];
        store.workingHours = [...store.workingHours, hours];
        return hours;
      },
      async update(id, changes) {
        const existing = store.workingHours.find((hours) => hours.id === id);
        if (existing === undefined) throw notFound("WorkingHours", id);
        const updated = {
          ...existing,
          start: localTime(changes.startMinutes),
          end: localTime(changes.endMinutes),
        } as (typeof store.workingHours)[number];
        store.workingHours = store.workingHours.map((hours) =>
          hours.id === id ? updated : hours,
        );
        return updated;
      },
      async delete(id) {
        store.workingHours = store.workingHours.filter((hours) => hours.id !== id);
      },
    },

    dateOverrides: {
      async listForResource(resourceId, from, to) {
        return store.dateOverrides.filter(
          (override) =>
            override.resourceId === resourceId &&
            compareLocalDate(override.date, from) >= 0 &&
            compareLocalDate(override.date, to) <= 0,
        );
      },
      async findByDate(resourceId, date) {
        return (
          store.dateOverrides.find(
            (override) => override.resourceId === resourceId && override.date === date,
          ) ?? null
        );
      },
      /** Replaces the whole date; an empty range list is a day off. */
      async put(input) {
        const existing = store.dateOverrides.find(
          (override) =>
            override.resourceId === input.resourceId && override.date === input.date,
        );
        const override = {
          id: existing?.id ?? asId(nextId("override")),
          resourceId: input.resourceId,
          businessId: input.businessId,
          date: input.date,
          note: input.note,
          ranges: input.ranges.map((range) => ({
            start: localTime(range.startMinutes),
            end: localTime(range.endMinutes),
          })),
        } as (typeof store.dateOverrides)[number];
        store.dateOverrides = [
          ...store.dateOverrides.filter((candidate) => candidate.id !== override.id),
          override,
        ];
        return override;
      },
      async delete(id) {
        store.dateOverrides = store.dateOverrides.filter(
          (override) => override.id !== id,
        );
      },
    },

    blocks: {
      async blockedBetween(resourceId, from, to) {
        return store.blocks
          .filter(
            (block) =>
              block.resourceId === resourceId &&
              block.startAt < to &&
              block.endAt > from,
          )
          .map((block) => ({ startAt: block.startAt, endAt: block.endAt }));
      },
      async countsByLocalDay(resourceId, from, to, timeZone) {
        return countByLocalDay(
          store.blocks
            .filter(
              (block) =>
                block.resourceId === resourceId &&
                block.startAt >= from &&
                block.startAt < to,
            )
            .map((block) => block.startAt),
          timeZone,
        );
      },

      async listForResourceBetween(resourceId, from, to) {
        return store.blocks.filter(
          (block) =>
            block.resourceId === resourceId && block.startAt < to && block.endAt > from,
        );
      },
      async create(input) {
        const block = {
          id: asId(nextId("block")),
          resourceId: input.resourceId,
          businessId: input.businessId,
          startAt: input.startAt,
          endAt: input.endAt,
          reason: input.reason,
        } as (typeof store.blocks)[number];
        store.blocks = [...store.blocks, block];
        return block;
      },
      async delete(id) {
        store.blocks = store.blocks.filter((block) => block.id !== id);
      },
    },

    appointments: {
      async findById(id) {
        return store.appointments.find((appointment) => appointment.id === id) ?? null;
      },
      async occupiedBetween(resourceId, from, to) {
        return store.appointments
          .filter(
            (appointment) =>
              appointment.resourceId === resourceId &&
              isActive(appointment) &&
              appointment.startAt < to &&
              appointment.occupiedUntil > from,
          )
          .map((appointment) => ({
            appointmentId: appointment.id,
            startAt: appointment.startAt,
            occupiedUntil: appointment.occupiedUntil,
          }));
      },
      async countsByLocalDay(resourceId, from, to, timeZone) {
        return countByLocalDay(
          store.appointments
            .filter(
              (appointment) =>
                appointment.resourceId === resourceId &&
                appointment.startAt >= from &&
                appointment.startAt < to &&
                appointment.status !== "CANCELLED",
            )
            .map((appointment) => appointment.startAt),
          timeZone,
        );
      },
      async searchUpcoming(businessId, query, from, limit) {
        const needle = query.toLowerCase();
        return store.appointments
          .filter(
            (appointment) =>
              appointment.businessId === businessId &&
              appointment.status === "CONFIRMED" &&
              appointment.startAt >= from,
          )
          .map((appointment) => ({
            appointment,
            customer: store.users.find((user) => user.id === appointment.customerId),
          }))
          .filter(
            ({ customer }) =>
              customer !== undefined &&
              (displayName(customer).toLowerCase().includes(needle) ||
                customer.phone.includes(query)),
          )
          .sort((left, right) => left.appointment.startAt - right.appointment.startAt)
          .slice(0, limit)
          .map(({ appointment, customer }) => ({
            appointment,
            customerName: displayName(customer as User),
            customerPhone: (customer as User).phone,
          }));
      },
      async listForResourceBetween(resourceId, from, to) {
        return store.appointments
          .filter(
            (appointment) =>
              appointment.resourceId === resourceId &&
              appointment.startAt < to &&
              appointment.occupiedUntil > from,
          )
          .sort((left, right) => left.startAt - right.startAt);
      },
      async listForBusinessBetween(businessId, from, to) {
        return store.appointments.filter(
          (appointment) =>
            appointment.businessId === businessId &&
            appointment.startAt >= from &&
            appointment.startAt < to,
        );
      },
      async listForCustomer(customerId, page) {
        return store.appointments
          .filter((appointment) => appointment.customerId === customerId)
          .sort((left, right) => right.startAt - left.startAt)
          .slice(page.offset, page.offset + page.limit);
      },
      async listForCustomerWithBusiness(customerId, page) {
        return store.appointments
          .filter((appointment) => appointment.customerId === customerId)
          .sort((left, right) => right.startAt - left.startAt)
          .slice(page.offset, page.offset + page.limit)
          .map((appointment) => {
            const business = store.businesses.find(
              (candidate) => candidate.id === appointment.businessId,
            );
            if (business === undefined) throw notFound("Business", appointment.businessId);
            const resource = store.resources.find(
              (candidate) => candidate.id === appointment.resourceId,
            );
            if (resource === undefined) throw notFound("Resource", appointment.resourceId);
            return { appointment, businessName: business.name, resourceName: resource.name };
          });
      },
      async listForCustomerAtBusiness(customerId, businessId) {
        return store.appointments.filter(
          (appointment) =>
            appointment.customerId === customerId &&
            appointment.businessId === businessId,
        );
      },

      async hasConfirmedForServiceBetween(customerId, serviceId, from, to) {
        return store.appointments.some(
          (appointment) =>
            appointment.customerId === customerId &&
            appointment.serviceId === serviceId &&
            appointment.status === "CONFIRMED" &&
            appointment.startAt >= from &&
            appointment.startAt < to,
        );
      },

      async upcomingForResource(resourceId, from) {
        return store.appointments
          .filter(
            (appointment) =>
              appointment.resourceId === resourceId &&
              appointment.status === "CONFIRMED" &&
              appointment.startAt >= from,
          )
          .sort((left, right) => left.startAt - right.startAt);
      },

      async upcomingCountsByResource(businessId, from) {
        const counts = new Map<Resource["id"], number>();
        for (const appointment of store.appointments) {
          if (
            appointment.businessId !== businessId ||
            appointment.status !== "CONFIRMED" ||
            appointment.startAt < from
          ) {
            continue;
          }
          counts.set(appointment.resourceId, (counts.get(appointment.resourceId) ?? 0) + 1);
        }
        return counts;
      },

      async customerIdsFor(businessId) {
        return [
          ...new Set(
            store.appointments
              .filter((appointment) => appointment.businessId === businessId)
              .map((appointment) => appointment.customerId),
          ),
        ];
      },
      async dueForReminder(from, to, limit) {
        return store.appointments
          .filter(
            (appointment) =>
              isActive(appointment) &&
              appointment.reminderEnqueuedAt === null &&
              appointment.startAt >= from &&
              appointment.startAt < to,
          )
          .sort((left, right) => left.startAt - right.startAt)
          .slice(0, limit)
          .map((appointment) => {
            const customer = store.users.find(
              (user) => user.id === appointment.customerId,
            );
            const business = store.businesses.find(
              (candidate) => candidate.id === appointment.businessId,
            );
            return {
              appointment,
              customerName: customer === undefined ? "" : displayName(customer),
              customerPhone: customer?.phone ?? "",
              businessName: business?.name ?? "",
              businessPhone: business?.phone ?? "",
              businessTimeZone: business?.timeZone ?? "UTC",
            };
          });
      },

      async markReminderEnqueued(ids) {
        const stamped = new Set<string>(ids);
        store.appointments = store.appointments.map((appointment) =>
          stamped.has(appointment.id)
            ? { ...appointment, reminderEnqueuedAt: now() }
            : appointment,
        );
      },

      /** ADR 0003's constraint, enforced here so both implementations agree. */
      async create(draft) {
        assertNoOverlap(store, draft.resourceId, draft.startAt, draft.occupiedUntil, null);
        const appointment: Appointment = {
          ...draft,
          id: asId(nextId("appointment")),
          cancelledAt: null,
          cancelledBy: null,
          lateCancellation: false,
          reminderEnqueuedAt: null,
          createdAt: now(),
        };
        store.appointments = [...store.appointments, appointment];
        return appointment;
      },
      async update(id, changes) {
        const existing = store.appointments.find((appointment) => appointment.id === id);
        if (existing === undefined) throw notFound("Appointment", id);
        const updated: Appointment = {
          ...existing,
          ...Object.fromEntries(
            Object.entries(changes).filter(([, value]) => value !== undefined),
          ),
        };
        if (isActive(updated)) {
          assertNoOverlap(store, updated.resourceId, updated.startAt, updated.occupiedUntil, id);
        }
        store.appointments = store.appointments.map((appointment) =>
          appointment.id === id ? updated : appointment,
        );
        return updated;
      },
    },

    subscriptions: {
      async findByBusiness(businessId) {
        return (
          store.subscriptions.find(
            (subscription) => subscription.businessId === businessId,
          ) ?? null
        );
      },
      async update(businessId, changes) {
        const existing = store.subscriptions.find(
          (subscription) => subscription.businessId === businessId,
        );
        if (existing === undefined) throw notFound("Subscription", businessId);
        const updated: Subscription = {
          ...existing,
          ...Object.fromEntries(
            Object.entries(changes).filter(([, value]) => value !== undefined),
          ),
        };
        store.subscriptions = store.subscriptions.map((subscription) =>
          subscription.businessId === businessId ? updated : subscription,
        );
        return updated;
      },
      async listLapsed(today) {
        return store.subscriptions.filter((subscription) => {
          if (subscription.plan === "FREE") return false;
          const business = store.businesses.find(
            (candidate) => candidate.id === subscription.businessId,
          );
          if (business === undefined || !business.active) return false;
          return (
            compareLocalDate(today, addDays(subscription.paidThrough, GRACE_PERIOD_DAYS)) > 0
          );
        });
      },
    },

    payments: {
      async create(input) {
        const payment = {
          id: asId(nextId("payment")),
          subscriptionId: input.subscriptionId,
          businessId: input.businessId,
          amount: input.amount,
          paidOn: input.paidOn,
          recordedBy: input.recordedBy,
          note: input.note,
          recordedAt: now(),
        } as (typeof store.payments)[number];
        store.payments = [...store.payments, payment];
        return payment;
      },
      async listForBusiness(businessId) {
        return store.payments.filter((payment) => payment.businessId === businessId);
      },
    },

    administratorAllowlist: {
      async contains(phone) {
        return store.allowlist.some((entry) => entry.phone === phone);
      },
      async list() {
        return store.allowlist;
      },
      async add(phone, note) {
        store.allowlist = [
          ...store.allowlist.filter((entry) => entry.phone !== phone),
          { phone, note },
        ];
      },
      async remove(phone) {
        store.allowlist = store.allowlist.filter((entry) => entry.phone !== phone);
      },
    },
  };
};

/**
 * The in-memory stand-in for ADR 0003's exclusion constraint. Half-open, so an
 * appointment starting exactly where another's buffer ends is adjacent rather
 * than conflicting — the same rule the `[)` range bound gives in Postgres.
 */
const assertNoOverlap = (
  store: Store,
  resourceId: string,
  startAt: number,
  occupiedUntil: number,
  excluding: string | null,
): void => {
  const clash = store.appointments.some(
    (appointment) =>
      appointment.id !== excluding &&
      appointment.resourceId === resourceId &&
      isActive(appointment) &&
      appointment.startAt < occupiedUntil &&
      appointment.occupiedUntil > startAt,
  );
  if (clash) {
    throw new DomainError(
      "SLOT_TAKEN",
      "That time was taken while you were confirming it",
    );
  }
};
