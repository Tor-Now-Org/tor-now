import { beforeEach, describe, expect, it } from "vitest";
import { displayName, parseInstant } from "@tor-now/domain";
import { harness, signIn, type Harness } from "../infrastructure/testing/harness.ts";
import { anEstablishedBusiness, TUESDAY, TUESDAY_AT } from "../infrastructure/testing/scenarios.ts";

describe("registering a business", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  it("makes the registrant the owner, and the business immediately findable", async () => {
    const shop = await anEstablishedBusiness(test);

    const membership = test.store.memberships.find(
      (candidate) =>
        candidate.userId === shop.owner.user.id &&
        candidate.businessId === shop.business.id,
    );
    expect(membership?.role).toBe("OWNER");
    // ADR 0011: active on registration, no approval queue.
    expect(shop.business.active).toBe(true);
    expect(
      await test.services.discovery.search({ kind: "ANONYMOUS" }, "מספרת"),
    ).toHaveLength(1);
  });

  it("gives every business a subscription without being asked", async () => {
    const shop = await anEstablishedBusiness(test);
    const billing = await test.services.business.subscription(
      shop.owner.actor,
      shop.business.id,
    );
    expect(billing.subscription.plan).toBe("FREE");
    expect(billing.state).toBe("CURRENT");
  });

  it("refuses a business with no calendar", async () => {
    const owner = await signIn(test, "+972500000001");
    await expect(
      test.services.business.register(owner.actor, {
        name: "ריק",
        phone: "+972500000001",
        description: null,
        address: null,
        resourceNames: [],
        services: [{ name: "ש", durationMinutes: 30, priceMinor: 0, bufferMinutes: null }],
        workingHours: [{ dayOfWeek: 2, start: "09:00", end: "17:00" }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("owning a business", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  it("keeps a stranger out of every management path", async () => {
    const shop = await anEstablishedBusiness(test);
    const stranger = await signIn(test, "+972500000099");

    await expect(
      test.services.business.listServices(stranger.actor, shop.business.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      test.services.business.update(stranger.actor, shop.business.id, { name: "שלי" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      test.services.calendar.customers(stranger.actor, shop.business.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps one owner out of another owner's business", async () => {
    const first = await anEstablishedBusiness(test);
    const otherOwner = await signIn(test, "+972500000007");
    await test.services.business.register(otherOwner.actor, {
      name: "אחר",
      phone: "+972500000007",
      description: null,
      address: null,
      resourceNames: ["א"],
      services: [{ name: "ש", durationMinutes: 30, priceMinor: 0, bufferMinutes: null }],
      workingHours: [{ dayOfWeek: 2, start: "09:00", end: "17:00" }],
    });

    await expect(
      test.services.business.listServices(otherOwner.actor, first.business.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("changing the booking window changes what is offered", async () => {
    const shop = await anEstablishedBusiness(test);
    const before = await test.services.availability.forRange({ kind: "ANONYMOUS" }, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      from: TUESDAY as never,
      to: TUESDAY as never,
    });

    // ADR 0012: the horizon trims the far end. One day ahead puts the Tuesday
    // out of reach entirely.
    await test.services.business.update(shop.owner.actor, shop.business.id, {
      bookingHorizonDays: 1,
    });

    const after = await test.services.availability.forRange({ kind: "ANONYMOUS" }, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      from: TUESDAY as never,
      to: TUESDAY as never,
    });

    expect(before[0]?.slots.length).toBeGreaterThan(0);
    expect(after[0]?.slots).toEqual([]);
    expect(after[0]?.emptyReason).toBe("BEYOND_HORIZON");
  });

  it("withdraws a booked service instead of deleting it", async () => {
    const shop = await anEstablishedBusiness(test);
    const customer = await signIn(test, "+972500000002");
    await test.services.booking.book(customer.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    });

    await test.services.business.deleteService(
      shop.owner.actor,
      shop.business.id,
      shop.service.id,
    );

    const services = await test.services.business.listServices(
      shop.owner.actor,
      shop.business.id,
    );
    expect(services).toHaveLength(1);
    expect(services[0]?.active).toBe(false);
  });

  it("refuses to remove the last calendar", async () => {
    const shop = await anEstablishedBusiness(test);
    await expect(
      test.services.business.deleteResource(
        shop.owner.actor,
        shop.business.id,
        shop.resource.id,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("an override with no ranges closes the day entirely", async () => {
    const shop = await anEstablishedBusiness(test);
    await test.services.business.putOverride(
      shop.owner.actor,
      shop.business.id,
      shop.resource.id,
      { date: TUESDAY, note: null, ranges: [] },
    );

    const [day] = await test.services.availability.forRange({ kind: "ANONYMOUS" }, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      from: TUESDAY as never,
      to: TUESDAY as never,
    });
    expect(day?.emptyReason).toBe("CLOSED");
  });

  it("an override replaces the weekday's hours rather than adding to them", async () => {
    const shop = await anEstablishedBusiness(test);
    await test.services.business.putOverride(
      shop.owner.actor,
      shop.business.id,
      shop.resource.id,
      { date: TUESDAY, note: null, ranges: [{ start: "10:00", end: "11:00" }] },
    );

    const [day] = await test.services.availability.forRange({ kind: "ANONYMOUS" }, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      from: TUESDAY as never,
      to: TUESDAY as never,
    });
    expect(day?.slots.map((slot) => slot.startAt)).toEqual([
      TUESDAY_AT("10:00"),
      TUESDAY_AT("10:30"),
    ]);
  });

  it("a block carves time out of an otherwise open day", async () => {
    const shop = await anEstablishedBusiness(test);
    await test.services.calendar.createBlock(
      shop.owner.actor,
      shop.business.id,
      shop.resource.id,
      { startAt: TUESDAY_AT("09:00"), endAt: TUESDAY_AT("10:00"), reason: "ספק" },
    );

    const [day] = await test.services.availability.forRange({ kind: "ANONYMOUS" }, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      from: TUESDAY as never,
      to: TUESDAY as never,
    });
    expect(day?.slots.map((slot) => slot.startAt)).not.toContain(TUESDAY_AT("09:00"));
    expect(day?.slots.map((slot) => slot.startAt)).toContain(TUESDAY_AT("10:00"));
  });

  it("records schedule changes in the audit trail", async () => {
    const shop = await anEstablishedBusiness(test);
    await test.services.business.addWorkingHours(
      shop.owner.actor,
      shop.business.id,
      shop.resource.id,
      { dayOfWeek: 3, start: "09:00", end: "12:00" },
    );
    expect(
      test.store.audit.some((entry) => entry.action === "WORKING_HOURS_CHANGED"),
    ).toBe(true);
  });
});

describe("the owner's customers", () => {
  it("shows only the people who booked with that business", async () => {
    const test = harness();
    const shop = await anEstablishedBusiness(test);
    const customer = await signIn(test, "+972500000002", "דנה");
    await signIn(test, "+972500000003", "מישהו אחר");

    await test.services.booking.book(customer.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    });

    const customers = await test.services.calendar.customers(
      shop.owner.actor,
      shop.business.id,
    );
    expect(customers.map(displayName)).toEqual(["דנה"]);
  });

  it("counts a late cancellation against the record", async () => {
    const test = harness();
    const shop = await anEstablishedBusiness(test);
    const customer = await signIn(test, "+972500000002", "דנה");

    // Booked with plenty of notice...
    const appointment = await test.services.booking.book(customer.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:30"),
      customerNote: null,
    });

    // ...then cancelled inside the business's 24-hour window. The cancellation
    // is allowed either way; only what is recorded differs.
    test.travelTo(parseInstant(TUESDAY_AT("08:00")));
    await test.services.booking.cancel(customer.actor, appointment.id);

    const record = await test.services.calendar.customerRecord(
      shop.owner.actor,
      shop.business.id,
      customer.user.id,
    );
    expect(record.lateCancellations).toBe(1);
  });
});
