import { beforeEach, describe, expect, it } from "vitest";
import { formatInstant, parseInstant } from "@tor-now/domain";
import { harness, signIn, type Harness } from "../infrastructure/testing/harness.ts";
import { anEstablishedBusiness, TUESDAY_AT } from "../infrastructure/testing/scenarios.ts";

/**
 * The booking path, exercised through the application services against the
 * in-memory adapters. These are the rules a customer meets, checked without a
 * database — the same services the Edge Function composes.
 */
describe("booking", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  it("books a slot the engine offers, and makes the customer a customer", async () => {
    const shop = await anEstablishedBusiness(test);
    const customer = await signIn(test, "+972500000002", "דנה");

    const appointment = await test.services.booking.book(customer.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    });

    expect(appointment.status).toBe("CONFIRMED");
    expect(appointment.serviceName).toBe(shop.service.name);

    // CONTEXT.md: "Customer" is a Membership, created by the act of booking.
    const membership = test.store.memberships.find(
      (candidate) =>
        candidate.userId === customer.user.id && candidate.businessId === shop.business.id,
    );
    expect(membership?.role).toBe("CUSTOMER");
  });

  it("stops at a second booking for the same service that day, and says what for", async () => {
    const shop = await anEstablishedBusiness(test);
    const customer = await signIn(test, "+972500000002", "דנה");

    const request = {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    };
    await test.services.booking.book(customer.actor, request);

    // Its own code, and carrying what the question needs: the interface has to
    // name the service and the day when it asks whether they meant it.
    await expect(
      test.services.booking.book(customer.actor, { ...request, startAt: TUESDAY_AT("11:00") }),
    ).rejects.toMatchObject({
      code: "ALREADY_BOOKED_THAT_DAY",
      details: { serviceName: shop.service.name },
    });
  });

  it("takes the second booking once the customer has said to go ahead", async () => {
    const shop = await anEstablishedBusiness(test);
    const customer = await signIn(test, "+972500000002", "דנה");

    const request = {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    };
    const first = await test.services.booking.book(customer.actor, request);

    // Two haircuts for two children on one phone number: unusual enough to ask
    // about, ordinary enough that refusing it outright would be wrong.
    const second = await test.services.booking.book(customer.actor, {
      ...request,
      startAt: TUESDAY_AT("11:00"),
      bookingAnotherOfTheSame: true,
    });

    expect(second.status).toBe("CONFIRMED");
    expect(second.id).not.toBe(first.id);
    expect(
      test.store.appointments.filter(
        (appointment) => appointment.customerId === customer.user.id,
      ),
    ).toHaveLength(2);
  });

  it("still refuses a second booking at a time no longer on offer", async () => {
    const shop = await anEstablishedBusiness(test);
    const customer = await signIn(test, "+972500000002", "דנה");

    const request = {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    };
    await test.services.booking.book(customer.actor, request);

    // Saying "yes, another one" answers a question about repeating a service.
    // It does not answer for the chair being occupied, which is not the
    // customer's to overrule — that slot is simply no longer offered.
    await expect(
      test.services.booking.book(customer.actor, {
        ...request,
        bookingAnotherOfTheSame: true,
      }),
    ).rejects.toMatchObject({ code: "OUTSIDE_WORKING_HOURS" });
  });

  it("allows a different service at the same business on the same day", async () => {
    const shop = await anEstablishedBusiness(test);
    const other = await test.services.business.createService(
      shop.owner.actor,
      shop.business.id,
      { name: "צביעה", durationMinutes: 30, priceMinor: 12000, bufferMinutes: null },
    );
    const customer = await signIn(test, "+972500000002", "דנה");

    const request = {
      businessId: shop.business.id,
      resourceId: shop.resource.id,
      customerNote: null,
    };
    await test.services.booking.book(customer.actor, {
      ...request,
      serviceId: shop.service.id,
      startAt: TUESDAY_AT("09:00"),
    });

    const second = await test.services.booking.book(customer.actor, {
      ...request,
      serviceId: other.id,
      startAt: TUESDAY_AT("11:00"),
    });
    expect(second.status).toBe("CONFIRMED");
  });

  it("allows the same service again on a different day", async () => {
    const shop = await anEstablishedBusiness(test);
    const customer = await signIn(test, "+972500000002", "דנה");

    const request = {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    };
    await test.services.booking.book(customer.actor, request);

    const nextWeek = formatInstant(
      (parseInstant(TUESDAY_AT("09:00")) + 7 * 24 * 60 * 60 * 1000) as never,
    );
    const second = await test.services.booking.book(customer.actor, {
      ...request,
      startAt: nextWeek,
    });
    expect(second.status).toBe("CONFIRMED");
  });

  it("lets a cancelled booking be replaced on the same day", async () => {
    const shop = await anEstablishedBusiness(test);
    const customer = await signIn(test, "+972500000002", "דנה");

    const request = {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    };
    const first = await test.services.booking.book(customer.actor, request);
    await test.services.booking.cancel(customer.actor, first.id);

    const second = await test.services.booking.book(customer.actor, {
      ...request,
      startAt: TUESDAY_AT("11:00"),
    });
    expect(second.status).toBe("CONFIRMED");
  });

  it("refuses a booking from a customer this business has blocked", async () => {
    const shop = await anEstablishedBusiness(test);
    const customer = await signIn(test, "+972500000002", "דנה");

    const request = {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    };

    // Booking is what makes them a customer, so they must book once first.
    await test.services.booking.book(customer.actor, request);
    await test.services.calendar.setCustomerBlocked(
      shop.owner.actor,
      shop.business.id,
      customer.user.id,
      true,
    );

    await expect(
      test.services.booking.book(customer.actor, { ...request, startAt: TUESDAY_AT("10:00") }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a time the engine does not offer", async () => {
    const shop = await anEstablishedBusiness(test);
    const customer = await signIn(test, "+972500000002");

    await expect(
      test.services.booking.book(customer.actor, {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: shop.resource.id,
        // Collides with nothing, but is not a start the greedy walk produces.
        startAt: TUESDAY_AT("09:07"),
        customerNote: null,
      }),
    ).rejects.toMatchObject({ code: "OUTSIDE_WORKING_HOURS" });
  });

  it("refuses the second of two bookings on the same slot", async () => {
    const shop = await anEstablishedBusiness(test);
    const first = await signIn(test, "+972500000002");
    const second = await signIn(test, "+972500000003");

    const request = {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    };

    await test.services.booking.book(first.actor, request);
    await expect(test.services.booking.book(second.actor, request)).rejects.toMatchObject({
      code: "OUTSIDE_WORKING_HOURS",
    });
  });

  it("enqueues a confirmation in the same unit of work", async () => {
    const shop = await anEstablishedBusiness(test);
    const customer = await signIn(test, "+972500000002");

    await test.services.booking.book(customer.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    });

    expect(test.store.outbox).toHaveLength(1);
    expect(test.store.outbox[0]?.message.template).toBe("BOOKING_CONFIRMED");
  });

  it("records the booking in the audit trail", async () => {
    const shop = await anEstablishedBusiness(test);
    const customer = await signIn(test, "+972500000002");

    await test.services.booking.book(customer.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    });

    const booked = test.store.audit.filter((entry) => entry.action === "APPOINTMENT_BOOKED");
    expect(booked).toHaveLength(1);
    expect(booked[0]?.actorId).toBe(customer.user.id);
  });

  it("refuses a booking at an inactive business", async () => {
    const shop = await anEstablishedBusiness(test);
    await test.services.admin.setBusinessActive(
      { kind: "ADMINISTRATOR", userId: shop.owner.user.id },
      shop.business.id,
      false,
    );
    const customer = await signIn(test, "+972500000002");

    await expect(
      test.services.booking.book(customer.actor, {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: shop.resource.id,
        startAt: TUESDAY_AT("09:00"),
        customerNote: null,
      }),
    ).rejects.toMatchObject({ code: "BUSINESS_INACTIVE" });
  });

  it("requires a session", async () => {
    const shop = await anEstablishedBusiness(test);
    await expect(
      test.services.booking.book(
        { kind: "ANONYMOUS" },
        {
          businessId: shop.business.id,
          serviceId: shop.service.id,
          resourceId: shop.resource.id,
          startAt: TUESDAY_AT("09:00"),
          customerNote: null,
        },
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

describe("cancelling", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  const book = async () => {
    const shop = await anEstablishedBusiness(test);
    const customer = await signIn(test, "+972500000002");
    const appointment = await test.services.booking.book(customer.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    });
    return { shop, customer, appointment };
  };

  it("frees the slot for someone else at once", async () => {
    const { shop, customer, appointment } = await book();
    await test.services.booking.cancel(customer.actor, appointment.id);

    const other = await signIn(test, "+972500000003");
    const rebooked = await test.services.booking.book(other.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    });
    expect(rebooked.status).toBe("CONFIRMED");
  });

  it("records who cancelled, and notifies", async () => {
    const { customer, appointment } = await book();
    const cancelled = await test.services.booking.cancel(customer.actor, appointment.id);

    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelledBy).toBe("CUSTOMER");
    expect(test.store.outbox.map((entry) => entry.message.template)).toContain(
      "BOOKING_CANCELLED",
    );
  });

  it("refuses to cancel the same appointment twice", async () => {
    const { customer, appointment } = await book();
    await test.services.booking.cancel(customer.actor, appointment.id);
    await expect(
      test.services.booking.cancel(customer.actor, appointment.id),
    ).rejects.toMatchObject({ code: "ALREADY_CANCELLED" });
  });

  it("lets a stranger cancel nothing", async () => {
    const { appointment } = await book();
    const stranger = await signIn(test, "+972500000009");
    await expect(
      test.services.booking.cancel(stranger.actor, appointment.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("rescheduling", () => {
  it("is an owner action, keeps the appointment, and notifies", async () => {
    const test = harness();
    const shop = await anEstablishedBusiness(test);
    const customer = await signIn(test, "+972500000002");

    const appointment = await test.services.booking.book(customer.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    });

    const moved = await test.services.booking.reschedule(
      shop.owner.actor,
      appointment.id,
      formatInstant(parseInstant(TUESDAY_AT("10:00"))),
    );

    expect(moved.id).toBe(appointment.id);
    expect(moved.status).toBe("CONFIRMED");
    expect(formatInstant(moved.startAt)).toBe(TUESDAY_AT("10:00"));
    // A reschedule is never a cancellation and is not counted as one.
    expect(moved.lateCancellation).toBe(false);
    expect(test.store.outbox.map((entry) => entry.message.template)).toContain(
      "BOOKING_RESCHEDULED",
    );
  });

  it("is refused once the appointment has started", async () => {
    const test = harness();
    const shop = await anEstablishedBusiness(test);
    const customer = await signIn(test, "+972500000002");
    const appointment = await test.services.booking.book(customer.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    });

    // One minute past the hour: the time it was given has begun to be spent.
    test.travelTo(parseInstant(TUESDAY_AT("09:01")));

    await expect(
      test.services.booking.reschedule(
        shop.owner.actor,
        appointment.id,
        formatInstant(parseInstant(TUESDAY_AT("15:00"))),
      ),
    ).rejects.toMatchObject({ code: "ALREADY_STARTED" });

    // What is left to do with it is to record what happened — and that is
    // available from the appointed time, not once the slot has run out.
    expect(
      (await test.services.booking.markNoShow(shop.owner.actor, appointment.id)).status,
    ).toBe("NO_SHOW");
  });

  it("will not take a no show before the appointment has started", async () => {
    const test = harness();
    const shop = await anEstablishedBusiness(test);
    const customer = await signIn(test, "+972500000004");
    const appointment = await test.services.booking.book(customer.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    });

    test.travelTo(parseInstant(TUESDAY_AT("08:59")));
    await expect(
      test.services.booking.markNoShow(shop.owner.actor, appointment.id),
    ).rejects.toThrow(/started/);
  });

  it("is still allowed a minute before it starts", async () => {
    const test = harness();
    const shop = await anEstablishedBusiness(test);
    const customer = await signIn(test, "+972500000003");
    const appointment = await test.services.booking.book(customer.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("11:00"),
      customerNote: null,
    });

    test.travelTo(parseInstant(TUESDAY_AT("10:59")));
    const moved = await test.services.booking.reschedule(
      shop.owner.actor,
      appointment.id,
      formatInstant(parseInstant(TUESDAY_AT("14:00"))),
    );
    expect(formatInstant(moved.startAt)).toBe(TUESDAY_AT("14:00"));
  });

  it("is refused to the customer whose appointment it is", async () => {
    const test = harness();
    const shop = await anEstablishedBusiness(test);
    const customer = await signIn(test, "+972500000002");
    const appointment = await test.services.booking.book(customer.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    });

    await expect(
      test.services.booking.reschedule(
        customer.actor,
        appointment.id,
        formatInstant(parseInstant(TUESDAY_AT("10:00"))),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
