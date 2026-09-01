import {
  cancelAppointment,
  clearNoShow,
  displayName,
  END_OF_DAY,
  formatInstant,
  instantToZoned,
  markNoShow,
  MIDNIGHT,
  notFound,
  parseInstant,
  validateBooking,
  validateReschedule,
  zonedToInstant,
  type Appointment,
  type AppointmentId,
  type BusinessId,
  type CancelledBy,
  type Clock,
  type ResourceId,
  type ServiceId,
  type SlotGenerationStrategy,
  type UserId,
} from "@tor-now/domain";
import { PAGINATION } from "../config.ts";
import { TEMPLATES, type OutboundMessage } from "../ports/notifier.ts";
import type { Page, Repositories } from "../ports/repositories.ts";
import type { Actor, UnitOfWork } from "../ports/unit-of-work.ts";
import { loadContext } from "./availability-service.ts";
import { requireOwnership, requireUser } from "./authorization.ts";

export type BookingRequestInput = {
  readonly businessId: BusinessId;
  readonly serviceId: ServiceId;
  readonly resourceId: ResourceId;
  readonly startAt: string;
  readonly customerNote: string | null;
};

/**
 * The schedule a booking is validated against, loaded for the single day the
 * booking falls on. A wider span would be wasted work: the rules only ever look
 * at the day in question.
 */
const scheduleForDay = async (
  repositories: Repositories,
  context: Awaited<ReturnType<typeof loadContext>>,
  startAt: number,
) => {
  const date = instantToZoned(startAt as never, context.business.timeZone).date;
  const dayStart = zonedToInstant(date, MIDNIGHT, context.business.timeZone);
  const dayEnd = zonedToInstant(date, END_OF_DAY, context.business.timeZone);

  const [workingHours, overrides, blocks, occupied] = await Promise.all([
    repositories.workingHours.listForResource(context.resource.id),
    repositories.dateOverrides.listForResource(context.resource.id, date, date),
    repositories.blocks.blockedBetween(context.resource.id, dayStart, dayEnd),
    repositories.appointments.occupiedBetween(context.resource.id, dayStart, dayEnd),
  ]);

  return { workingHours, overrides, blocks, occupied };
};

const notificationFor = (
  template: OutboundMessage["template"],
  appointment: Appointment,
  business: { name: string; phone: string; timeZone: string },
  customer: { givenName: string; familyName: string | null; phone: string },
  previousStartAt?: string,
): OutboundMessage => ({
  recipientPhone: customer.phone,
  template,
  payload: {
    businessName: business.name,
    businessPhone: business.phone,
    serviceName: appointment.serviceName,
    customerName: displayName(customer),
    startAt: formatInstant(appointment.startAt),
    ...(previousStartAt === undefined ? {} : { previousStartAt }),
  },
});

export const bookingService = (dependencies: {
  unitOfWork: UnitOfWork;
  clock: Clock;
  strategy?: SlotGenerationStrategy;
}) => {
  const { unitOfWork, clock } = dependencies;

  return {
    /**
     * ADR 0003: the appointment is created directly as CONFIRMED. Nothing is
     * held while the customer authenticates, so a slot can be lost between
     * selecting and confirming — the constraint violation surfaces as a
     * recoverable SLOT_TAKEN and the interface re-renders availability in place.
     */
    async book(actor: Actor, input: BookingRequestInput): Promise<Appointment> {
      const customerId = requireUser(actor);
      const startAt = parseInstant(input.startAt);

      return unitOfWork.run(actor, async (session) => {
        const { repositories } = session;
        const context = await loadContext(repositories, input);
        const schedule = await scheduleForDay(repositories, context, startAt);

        const draft = validateBooking(
          {
            business: context.business,
            resource: context.resource,
            service: context.service,
            customerId,
            startAt,
            customerNote: input.customerNote,
            now: clock.now(),
          },
          schedule,
          dependencies.strategy,
        );

        // Booking is what makes the customer relationship (CONTEXT.md:
        // "Customer" is always relative to a Business).
        await repositories.memberships.ensureCustomer(customerId, context.business.id);

        const appointment = await repositories.appointments.create(draft);
        const customer = await repositories.users.findById(customerId);
        if (customer !== null) {
          await session.outbox.enqueue(
            notificationFor(
              TEMPLATES.bookingConfirmed,
              appointment,
              context.business,
              customer,
            ),
          );
        }
        return appointment;
      });
    },

    /**
     * A customer may always cancel; the Cancellation Window governs visibility,
     * not permission. Cancelling inside it is recorded as a Late Cancellation
     * and shown to the Business, and never blocked.
     */
    async cancel(actor: Actor, appointmentId: AppointmentId): Promise<Appointment> {
      const userId = requireUser(actor);

      return unitOfWork.run(actor, async (session) => {
        const { repositories } = session;
        const appointment = await repositories.appointments.findById(appointmentId);
        if (appointment === null) throw notFound("Appointment", appointmentId);

        const business = await repositories.businesses.findById(appointment.businessId);
        if (business === null) throw notFound("Business", appointment.businessId);

        const cancelledBy = await whoIsCancelling(
          repositories,
          actor,
          userId,
          appointment,
        );

        const outcome = cancelAppointment(
          appointment,
          business,
          cancelledBy,
          clock.now(),
        );

        const updated = await repositories.appointments.update(appointmentId, {
          status: "CANCELLED",
          ...outcome,
        });

        const customer = await repositories.users.findById(appointment.customerId);
        if (customer !== null) {
          await session.outbox.enqueue(
            notificationFor(TEMPLATES.bookingCancelled, updated, business, customer),
          );
        }
        return updated;
      });
    },

    /**
     * ADR 0005 counts reschedule as a third template, and CONTEXT.md makes it a
     * Business action only — a customer wanting a different time cancels and
     * books again.
     */
    async reschedule(
      actor: Actor,
      appointmentId: AppointmentId,
      newStartAt: string,
    ): Promise<Appointment> {
      const startAt = parseInstant(newStartAt);

      return unitOfWork.run(actor, async (session) => {
        const { repositories } = session;
        const appointment = await repositories.appointments.findById(appointmentId);
        if (appointment === null) throw notFound("Appointment", appointmentId);
        await requireOwnership(repositories, actor, appointment.businessId);

        const context = await loadContext(repositories, {
          businessId: appointment.businessId,
          serviceId: appointment.serviceId,
          resourceId: appointment.resourceId,
        });
        const schedule = await scheduleForDay(repositories, context, startAt);

        const draft = validateReschedule(
          appointment,
          {
            business: context.business,
            resource: context.resource,
            service: context.service,
            customerId: appointment.customerId,
            startAt,
            customerNote: appointment.customerNote,
            now: clock.now(),
          },
          schedule,
          dependencies.strategy,
        );

        const previousStartAt = formatInstant(appointment.startAt);
        const updated = await repositories.appointments.update(appointmentId, {
          startAt: draft.startAt,
          endAt: draft.endAt,
          occupiedUntil: draft.occupiedUntil,
        });

        const customer = await repositories.users.findById(appointment.customerId);
        if (customer !== null) {
          await session.outbox.enqueue(
            notificationFor(
              TEMPLATES.bookingRescheduled,
              updated,
              context.business,
              customer,
              previousStartAt,
            ),
          );
        }
        return updated;
      });
    },

    /** Marked by the Business, and only once the appointment has actually ended. */
    async markNoShow(actor: Actor, appointmentId: AppointmentId): Promise<Appointment> {
      return unitOfWork.run(actor, async ({ repositories }) => {
        const appointment = await repositories.appointments.findById(appointmentId);
        if (appointment === null) throw notFound("Appointment", appointmentId);
        await requireOwnership(repositories, actor, appointment.businessId);

        markNoShow(appointment, clock.now());
        return repositories.appointments.update(appointmentId, { status: "NO_SHOW" });
      });
    },

    async clearNoShow(actor: Actor, appointmentId: AppointmentId): Promise<Appointment> {
      return unitOfWork.run(actor, async ({ repositories }) => {
        const appointment = await repositories.appointments.findById(appointmentId);
        if (appointment === null) throw notFound("Appointment", appointmentId);
        await requireOwnership(repositories, actor, appointment.businessId);

        clearNoShow(appointment);
        return repositories.appointments.update(appointmentId, { status: "CONFIRMED" });
      });
    },

    async myAppointments(
      actor: Actor,
      page: Page = { limit: PAGINATION.defaultPageSize, offset: 0 },
    ): Promise<readonly Appointment[]> {
      const userId = requireUser(actor);
      return unitOfWork.run(actor, ({ repositories }) =>
        repositories.appointments.listForCustomer(userId, page),
      );
    },
  };
};

/**
 * A cancellation is recorded against whoever made it, because a Late
 * Cancellation is a customer's doing and a business cancelling its own
 * appointment is not the same event.
 */
const whoIsCancelling = async (
  repositories: Repositories,
  actor: Actor,
  userId: UserId,
  appointment: Appointment,
): Promise<CancelledBy> => {
  if (appointment.customerId === userId) return "CUSTOMER";
  await requireOwnership(repositories, actor, appointment.businessId);
  return "BUSINESS";
};
