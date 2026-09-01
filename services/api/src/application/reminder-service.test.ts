import { beforeEach, describe, expect, it } from "vitest";
import { addMinutesToInstant, parseInstant } from "@tor-now/domain";
import { REMINDERS } from "../config.ts";
import { harness, signIn, type Harness } from "../infrastructure/testing/harness.ts";
import { anEstablishedBusiness, TUESDAY_AT } from "../infrastructure/testing/scenarios.ts";

/**
 * ADR 0005's reminders. The job may run at any time and as often as anyone
 * likes; what it must never do is write two reminders for one appointment, or
 * remind about one that has been cancelled.
 */
describe("reminders", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  const anAppointmentAtNine = async () => {
    const shop = await anEstablishedBusiness(test);
    const customer = await signIn(test, "+972500000002", "דנה");
    const appointment = await test.services.booking.book(customer.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    });
    return { shop, customer, appointment };
  };

  /** Moves the clock so the appointment sits inside the reminder window. */
  const aDayBefore = (startAt: string) =>
    addMinutesToInstant(parseInstant(startAt), -REMINDERS.leadMinutes - 1);

  it("says nothing while the appointment is still far off", async () => {
    await anAppointmentAtNine();
    const report = await test.services.reminders.send();
    expect(report.enqueued).toBe(0);
    expect(test.store.outbox.filter((entry) => entry.message.template === "BOOKING_REMINDER"))
      .toHaveLength(0);
  });

  it("reminds once the appointment is a day away", async () => {
    const { appointment } = await anAppointmentAtNine();
    test.travelTo(aDayBefore(TUESDAY_AT("09:00")));

    const report = await test.services.reminders.send();

    expect(report.enqueued).toBe(1);
    const reminder = test.store.outbox.find(
      (entry) => entry.message.template === "BOOKING_REMINDER",
    );
    expect(reminder?.message.recipientPhone).toBe("+972500000002");
    expect(reminder?.message.payload.customerName).toBe("דנה");
    expect(reminder?.message.payload.serviceName).toBe(appointment.serviceName);
  });

  it("never reminds twice, however often the job runs", async () => {
    await anAppointmentAtNine();
    test.travelTo(aDayBefore(TUESDAY_AT("09:00")));

    await test.services.reminders.send();
    const second = await test.services.reminders.send();
    const third = await test.services.reminders.send();

    expect(second.enqueued).toBe(0);
    expect(third.enqueued).toBe(0);
    expect(
      test.store.outbox.filter((entry) => entry.message.template === "BOOKING_REMINDER"),
    ).toHaveLength(1);
  });

  it("does not remind about an appointment that was cancelled", async () => {
    const { customer, appointment } = await anAppointmentAtNine();
    await test.services.booking.cancel(customer.actor, appointment.id);

    test.travelTo(aDayBefore(TUESDAY_AT("09:00")));
    const report = await test.services.reminders.send();

    expect(report.enqueued).toBe(0);
  });

  it("hands the reminder to the worker rather than delivering it itself", async () => {
    await anAppointmentAtNine();
    test.travelTo(aDayBefore(TUESDAY_AT("09:00")));
    await test.services.reminders.send();

    // ADR 0005: delivery never happens inside the transaction that caused it.
    expect(test.deliveredTemplates).not.toContain("BOOKING_REMINDER");
    await test.services.outboxWorker.drain();
    expect(test.deliveredTemplates).toContain("BOOKING_REMINDER");
  });
});
