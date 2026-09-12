import { beforeEach, describe, expect, it } from "vitest";
import { parseLocalDate } from "@tor-now/domain";
import { harness, signIn, type Harness } from "../infrastructure/testing/harness.ts";
import { anEstablishedBusiness, TUESDAY, TUESDAY_AT } from "../infrastructure/testing/scenarios.ts";

/**
 * Closing the shop, and what becomes of the people already booked inside it.
 *
 * The screen that does this used to write an Override per calendar and stop
 * there: the days looked shut and every appointment in them stood, unmentioned
 * to the customer and invisible to the owner. These cover the whole decision —
 * who is warned, what is called off, who is told, and what the calendar says
 * afterwards.
 */

/** The Wednesday after the Tuesday the scenarios book against. */
const WEDNESDAY = "2026-09-02";

const aBookingOn = async (
  test: Harness,
  shop: Awaited<ReturnType<typeof anEstablishedBusiness>>,
  phone: string,
  startAt: string,
) => {
  const customer = await signIn(test, phone, "דנה כהן");
  const appointment = await test.services.booking.book(customer.actor, {
    businessId: shop.business.id,
    serviceId: shop.service.id,
    resourceId: shop.resource.id,
    startAt,
    customerNote: null,
  });
  return { customer, appointment };
};

describe("closing the business", () => {
  let test: Harness;
  let shop: Awaited<ReturnType<typeof anEstablishedBusiness>>;

  beforeEach(async () => {
    test = harness();
    shop = await anEstablishedBusiness(test);
  });

  it("warns about every appointment the days would strand, by name", async () => {
    const { appointment } = await aBookingOn(test, shop, "+972500000002", TUESDAY_AT("09:00"));

    const impact = await test.services.closures.preview(shop.owner.actor, shop.business.id, {
      fromDate: TUESDAY,
      toDate: TUESDAY,
      ranges: [],
    });

    expect(impact.days).toBe(1);
    expect(impact.calendars).toBe(1);
    expect(impact.appointments).toHaveLength(1);
    expect(impact.appointments[0]?.id).toBe(appointment.id);
    // The owner is deciding whether to call somebody off: "1 appointment" is
    // not that decision, and the name is what makes it one.
    expect(impact.appointments[0]?.customerName).toBe("דנה כהן");
    expect(impact.appointments[0]?.serviceName).toBe(shop.service.name);
  });

  it("shuts every calendar for every day of the range", async () => {
    await test.services.closures.close(
      shop.owner.actor,
      shop.business.id,
      { fromDate: TUESDAY, toDate: WEDNESDAY, note: "חופשה", ranges: [] },
      "KEEP",
    );

    const overrides = await test.services.business.listOverrides(
      shop.owner.actor,
      shop.business.id,
      shop.resource.id,
      TUESDAY,
      WEDNESDAY,
    );
    expect(overrides).toHaveLength(2);
    expect(overrides.every((override) => override.ranges.length === 0)).toBe(true);
    expect(overrides.every((override) => override.note === "חופשה")).toBe(true);
  });

  it("takes the days out of what a customer is offered", async () => {
    const before = await test.services.availability.forRange({ kind: "ANONYMOUS" }, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      from: parseLocalDate(TUESDAY),
      to: parseLocalDate(TUESDAY),
    });
    expect(before[0]?.slots.length ?? 0).toBeGreaterThan(0);

    await test.services.closures.close(
      shop.owner.actor,
      shop.business.id,
      { fromDate: TUESDAY, toDate: TUESDAY, note: null, ranges: [] },
      "KEEP",
    );

    const after = await test.services.availability.forRange({ kind: "ANONYMOUS" }, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      from: parseLocalDate(TUESDAY),
      to: parseLocalDate(TUESDAY),
    });
    expect(after[0]?.slots ?? []).toHaveLength(0);
  });

  it("calls off what it strands, and queues a message to each customer", async () => {
    const { appointment } = await aBookingOn(test, shop, "+972500000002", TUESDAY_AT("09:00"));
    const other = await aBookingOn(test, shop, "+972500000003", TUESDAY_AT("11:00"));

    const outcome = await test.services.closures.close(
      shop.owner.actor,
      shop.business.id,
      { fromDate: TUESDAY, toDate: TUESDAY, note: "חופשה", ranges: [] },
      "CANCEL",
    );

    expect(outcome.cancelled).toBe(2);
    const stored = test.store.appointments.filter((one) =>
      [appointment.id, other.appointment.id].includes(one.id),
    );
    expect(stored.every((one) => one.status === "CANCELLED")).toBe(true);
    // Cancelled by the business, so it is not held against the customer as a
    // late cancellation.
    expect(stored.every((one) => one.cancelledBy === "BUSINESS")).toBe(true);
    expect(stored.every((one) => one.lateCancellation === false)).toBe(true);

    const told = test.store.outbox.filter(
      (entry) => entry.message.template === "BOOKING_CANCELLED",
    );
    expect(told).toHaveLength(2);
  });

  it("leaves the appointments standing when the owner says to keep them", async () => {
    const { appointment } = await aBookingOn(test, shop, "+972500000002", TUESDAY_AT("09:00"));

    const outcome = await test.services.closures.close(
      shop.owner.actor,
      shop.business.id,
      { fromDate: TUESDAY, toDate: TUESDAY, note: null, ranges: [] },
      "KEEP",
    );

    expect(outcome.cancelled).toBe(0);
    expect(
      test.store.appointments.find((one) => one.id === appointment.id)?.status,
    ).toBe("CONFIRMED");
    expect(test.store.outbox).toHaveLength(1); // the booking's own confirmation
  });

  it("strands only what the shorter hours no longer hold", async () => {
    const early = await aBookingOn(test, shop, "+972500000002", TUESDAY_AT("09:00"));
    const late = await aBookingOn(test, shop, "+972500000003", TUESDAY_AT("15:00"));

    const impact = await test.services.closures.preview(shop.owner.actor, shop.business.id, {
      fromDate: TUESDAY,
      toDate: TUESDAY,
      ranges: [{ start: "09:00", end: "12:00" }],
    });

    expect(impact.appointments.map((one) => one.id)).toEqual([late.appointment.id]);

    await test.services.closures.close(
      shop.owner.actor,
      shop.business.id,
      {
        fromDate: TUESDAY,
        toDate: TUESDAY,
        note: "יום קצר",
        ranges: [{ start: "09:00", end: "12:00" }],
      },
      "CANCEL",
    );

    expect(
      test.store.appointments.find((one) => one.id === early.appointment.id)?.status,
    ).toBe("CONFIRMED");
    expect(
      test.store.appointments.find((one) => one.id === late.appointment.id)?.status,
    ).toBe("CANCELLED");
  });

  it("says nothing about a day that has already happened", async () => {
    // The frozen clock sits before the Tuesday; a closure over the week before
    // it has nothing to answer for even though the shop was open then.
    const impact = await test.services.closures.preview(shop.owner.actor, shop.business.id, {
      fromDate: "2026-08-24",
      toDate: "2026-08-26",
      ranges: [],
    });
    expect(impact.appointments).toHaveLength(0);
  });

  it("refuses a range that ends before it starts", async () => {
    await expect(
      test.services.closures.close(
        shop.owner.actor,
        shop.business.id,
        { fromDate: WEDNESDAY, toDate: TUESDAY, note: null, ranges: [] },
        "KEEP",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("gives the days back, and the hours with them", async () => {
    await test.services.closures.close(
      shop.owner.actor,
      shop.business.id,
      { fromDate: TUESDAY, toDate: WEDNESDAY, note: "חופשה", ranges: [] },
      "KEEP",
    );

    const removed = await test.services.closures.lift(
      shop.owner.actor,
      shop.business.id,
      TUESDAY,
      WEDNESDAY,
    );
    expect(removed).toBe(2);

    const after = await test.services.availability.forRange({ kind: "ANONYMOUS" }, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      from: parseLocalDate(TUESDAY),
      to: parseLocalDate(TUESDAY),
    });
    expect((after[0]?.slots ?? []).length).toBeGreaterThan(0);
  });

  it("does not un-cancel what it called off", async () => {
    const { appointment } = await aBookingOn(test, shop, "+972500000002", TUESDAY_AT("09:00"));
    await test.services.closures.close(
      shop.owner.actor,
      shop.business.id,
      { fromDate: TUESDAY, toDate: TUESDAY, note: null, ranges: [] },
      "CANCEL",
    );
    await test.services.closures.lift(shop.owner.actor, shop.business.id, TUESDAY, TUESDAY);

    // Having told somebody not to come is not undone by re-opening the day.
    expect(
      test.store.appointments.find((one) => one.id === appointment.id)?.status,
    ).toBe("CANCELLED");
  });

  it("shows the shut days on the month as one band, in the owner's own words", async () => {
    await test.services.closures.close(
      shop.owner.actor,
      shop.business.id,
      { fromDate: TUESDAY, toDate: WEDNESDAY, note: "חופשה", ranges: [] },
      "KEEP",
    );

    const month = await test.services.calendar.businessMonth(
      shop.owner.actor,
      shop.business.id,
      "2026-09-01",
    );

    expect(month.closures).toEqual([
      {
        fromDate: parseLocalDate(TUESDAY),
        toDate: parseLocalDate(WEDNESDAY),
        days: 2,
        note: "חופשה",
      },
    ]);
    const tuesday = month.days.find((day) => day.date === TUESDAY);
    expect(tuesday?.shopClosed).toBe(true);
    expect(tuesday?.shopNote).toBe("חופשה");
  });
});

describe("who may close the business", () => {
  let test: Harness;
  let shop: Awaited<ReturnType<typeof anEstablishedBusiness>>;

  beforeEach(async () => {
    test = harness();
    shop = await anEstablishedBusiness(test);
  });

  /** A member of staff on the calendar, without the authority to shut the shop. */
  const aWorker = async (phone: string) => {
    const worker = await signIn(test, phone, "עובד");
    await test.services.business.inviteUser(shop.owner.actor, shop.business.id, {
      phone,
      givenName: "עובד",
      familyName: null,
      role: "WORKER",
      resourceIds: [shop.resource.id],
    });
    return worker;
  };

  it("refuses a worker, who may keep their own calendar but not shut the shop", async () => {
    const worker = await aWorker("+972500000044");

    await expect(
      test.services.closures.close(
        worker.actor,
        shop.business.id,
        { fromDate: TUESDAY, toDate: TUESDAY, note: null, ranges: [] },
        "KEEP",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      test.services.closures.preview(worker.actor, shop.business.id, {
        fromDate: TUESDAY,
        toDate: TUESDAY,
        ranges: [],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      test.services.closures.lift(worker.actor, shop.business.id, TUESDAY, TUESDAY),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows a manager, who runs the business day to day", async () => {
    const phone = "+972500000055";
    const manager = await signIn(test, phone, "מנהלת");
    await test.services.business.inviteUser(shop.owner.actor, shop.business.id, {
      phone,
      givenName: "מנהלת",
      familyName: null,
      role: "MANAGER",
      resourceIds: [],
    });

    const outcome = await test.services.closures.close(
      manager.actor,
      shop.business.id,
      { fromDate: TUESDAY, toDate: TUESDAY, note: null, ranges: [] },
      "KEEP",
    );
    expect(outcome.days).toBe(1);
  });

  it("refuses a stranger outright", async () => {
    const stranger = await signIn(test, "+972500000077");
    await expect(
      test.services.closures.preview(stranger.actor, shop.business.id, {
        fromDate: TUESDAY,
        toDate: TUESDAY,
        ranges: [],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
