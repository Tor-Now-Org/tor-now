import { addMinutesToInstant, formatInstant, type Clock } from "@tor-now/domain";
import { REMINDERS } from "../config.ts";
import { TEMPLATES } from "../ports/notifier.ts";
import { system, type UnitOfWork } from "../ports/unit-of-work.ts";

/**
 * ADR 0005 deferred reminders "until a scheduler exists". One exists now
 * (ADR 0007's cron), and this is the job it drives.
 *
 * The reminder is enqueued rather than delivered here, exactly like a
 * confirmation: the outbox row and the stamp saying it was written go into the
 * same transaction, so the message is written once even if the job is run
 * twice, and delivery stays the worker's problem.
 */
export type ReminderReport = {
  readonly considered: number;
  readonly enqueued: number;
};

export const reminderService = (dependencies: {
  unitOfWork: UnitOfWork;
  clock: Clock;
}) => ({
  /**
   * Reminds about appointments starting a fixed distance ahead. The window is
   * wider than the interval the job runs on, so a late or skipped run still
   * catches its appointments — and the stamp is what stops the overlap sending
   * anything twice.
   */
  async send(): Promise<ReminderReport> {
    const now = dependencies.clock.now();
    const from = addMinutesToInstant(now, REMINDERS.leadMinutes);
    const to = addMinutesToInstant(
      now,
      REMINDERS.leadMinutes + REMINDERS.windowMinutes,
    );

    return dependencies.unitOfWork.run(system(), async (session) => {
      const due = await session.repositories.appointments.dueForReminder(
        from,
        to,
        REMINDERS.batchSize,
      );

      for (const entry of due) {
        await session.outbox.enqueue({
          recipientPhone: entry.customerPhone,
          template: TEMPLATES.bookingReminder,
          payload: {
            businessName: entry.businessName,
            businessPhone: entry.businessPhone,
            serviceName: entry.appointment.serviceName,
            customerName: entry.customerName,
            startAt: formatInstant(entry.appointment.startAt),
          },
        });
      }

      await session.repositories.appointments.markReminderEnqueued(
        due.map((entry) => entry.appointment.id),
      );

      return { considered: due.length, enqueued: due.length };
    });
  },
});
