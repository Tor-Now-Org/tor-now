import { beforeEach, describe, expect, it } from "vitest";
import { displayName, MAXIMUM_PHOTOS, parseInstant } from "@tor-now/domain";
import { PHOTOS } from "../config.ts";
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
        address: "רחוב הרצל 1",
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
      address: "רחוב אחר 2",
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
    await test.services.calendar.createBlocks(
      shop.owner.actor,
      shop.business.id,
      shop.resource.id,
      [{ startAt: TUESDAY_AT("09:00"), endAt: TUESDAY_AT("10:00"), reason: "ספק" }],
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

  it("blocks several days as one decision, each of them its own block", async () => {
    const shop = await anEstablishedBusiness(test);

    // A week away: three days, made together. Each is a block of its own
    // afterwards, so one day of it can be given back without the rest.
    const made = await test.services.calendar.createBlocks(
      shop.owner.actor,
      shop.business.id,
      shop.resource.id,
      [
        { startAt: TUESDAY_AT("09:00"), endAt: TUESDAY_AT("10:00"), reason: "חופשה" },
        { startAt: TUESDAY_AT("11:00"), endAt: TUESDAY_AT("12:00"), reason: "חופשה" },
        { startAt: TUESDAY_AT("14:00"), endAt: TUESDAY_AT("15:00"), reason: "חופשה" },
      ],
    );

    expect(made).toHaveLength(3);
    expect(new Set(made.map((block) => block.id)).size).toBe(3);

    const [day] = await test.services.availability.forRange({ kind: "ANONYMOUS" }, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      from: TUESDAY as never,
      to: TUESDAY as never,
    });
    const starts = day?.slots.map((slot) => slot.startAt) ?? [];
    expect(starts).not.toContain(TUESDAY_AT("09:00"));
    expect(starts).not.toContain(TUESDAY_AT("11:00"));
    expect(starts).not.toContain(TUESDAY_AT("14:00"));
    expect(starts).toContain(TUESDAY_AT("10:00"));
  });

  it("makes none of a blockage when one of its spans is impossible", async () => {
    const shop = await anEstablishedBusiness(test);

    await expect(
      test.services.calendar.createBlocks(
        shop.owner.actor,
        shop.business.id,
        shop.resource.id,
        [
          { startAt: TUESDAY_AT("09:00"), endAt: TUESDAY_AT("10:00"), reason: "" },
          { startAt: TUESDAY_AT("15:00"), endAt: TUESDAY_AT("14:00"), reason: "" },
        ],
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    // One decision, one transaction: a holiday blocked to Wednesday and failing
    // on Thursday is a calendar nobody can trust.
    expect(test.store.blocks).toHaveLength(0);
  });

  it("refuses a special day whose hours run into one another", async () => {
    const shop = await anEstablishedBusiness(test);

    await expect(
      test.services.business.putOverride(
        shop.owner.actor,
        shop.business.id,
        shop.resource.id,
        {
          date: TUESDAY,
          note: null,
          ranges: [
            { start: "09:00", end: "13:00" },
            { start: "12:00", end: "17:00" },
          ],
        },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("takes a special day with a break in the middle of it", async () => {
    const shop = await anEstablishedBusiness(test);

    const override = await test.services.business.putOverride(
      shop.owner.actor,
      shop.business.id,
      shop.resource.id,
      {
        date: TUESDAY,
        note: null,
        ranges: [
          { start: "09:00", end: "13:00" },
          { start: "16:00", end: "19:00" },
        ],
      },
    );

    expect(override.ranges).toHaveLength(2);

    // And the day the customer is offered follows it: nothing in the gap.
    const [day] = await test.services.availability.forRange({ kind: "ANONYMOUS" }, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      from: TUESDAY as never,
      to: TUESDAY as never,
    });
    const starts = day?.slots.map((slot) => slot.startAt) ?? [];
    expect(starts).toContain(TUESDAY_AT("09:00"));
    expect(starts).not.toContain(TUESDAY_AT("14:00"));
    expect(starts).toContain(TUESDAY_AT("16:00"));
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

  it("replaces the whole week in one go, and audits it once", async () => {
    const shop = await anEstablishedBusiness(test);
    const before = test.store.audit.length;

    const week = await test.services.business.replaceWorkingHours(
      shop.owner.actor,
      shop.business.id,
      shop.resource.id,
      [
        { dayOfWeek: 1, start: "09:00", end: "13:00" },
        { dayOfWeek: 1, start: "16:00", end: "19:00" },
        { dayOfWeek: 2, start: "09:00", end: "17:00" },
      ],
    );

    // The registered Tuesday is gone: this is the week now, not an addition to
    // the week that was there.
    expect(week).toHaveLength(3);
    const stored = await test.services.business.listWorkingHours(
      shop.owner.actor,
      shop.business.id,
      shop.resource.id,
    );
    expect(stored.map((entry) => `${entry.dayOfWeek}:${entry.start}-${entry.end}`)).toEqual([
      "1:540-780",
      "1:960-1140",
      "2:540-1020",
    ]);

    // One row for the change a person made, not one per range.
    expect(test.store.audit.length - before).toBe(1);
  });

  it("refuses a range that ends before it starts, and writes nothing", async () => {
    const shop = await anEstablishedBusiness(test);

    await expect(
      test.services.business.replaceWorkingHours(
        shop.owner.actor,
        shop.business.id,
        shop.resource.id,
        [
          { dayOfWeek: 1, start: "09:00", end: "13:00" },
          { dayOfWeek: 2, start: "17:00", end: "09:00" },
        ],
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    // The whole week is one transaction, so a bad range leaves the old one
    // standing rather than half a new one.
    const stored = await test.services.business.listWorkingHours(
      shop.owner.actor,
      shop.business.id,
      shop.resource.id,
    );
    expect(stored.map((entry) => entry.dayOfWeek)).toEqual([2]);
  });

  it("refuses a week that writes one day twice over the same minutes", async () => {
    const shop = await anEstablishedBusiness(test);

    // What the editor merges before it writes. Accepting it is how a day's
    // stretch landed under another day's number and the day it belonged to
    // came back empty — the store took the duplicate without a word.
    await expect(
      test.services.business.replaceWorkingHours(
        shop.owner.actor,
        shop.business.id,
        shop.resource.id,
        [
          { dayOfWeek: 1, start: "09:00", end: "17:00" },
          { dayOfWeek: 1, start: "16:00", end: "20:00" },
        ],
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { dayOfWeek: 1 } });
  });

  it("takes two stretches of one day that leave a break between them", async () => {
    const shop = await anEstablishedBusiness(test);

    const week = await test.services.business.replaceWorkingHours(
      shop.owner.actor,
      shop.business.id,
      shop.resource.id,
      [
        { dayOfWeek: 1, start: "09:00", end: "13:00" },
        { dayOfWeek: 1, start: "16:00", end: "20:00" },
      ],
    );
    expect(week).toHaveLength(2);
  });

  it("will not let one owner rewrite another's week", async () => {
    const shop = await anEstablishedBusiness(test);
    const stranger = await signIn(test, "+972500000044", "זר");

    await expect(
      test.services.business.replaceWorkingHours(
        stranger.actor,
        shop.business.id,
        shop.resource.id,
        [{ dayOfWeek: 1, start: "09:00", end: "13:00" }],
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("removing a calendar", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  it("keeps the appointments made against a calendar that is withdrawn", async () => {
    const shop = await anEstablishedBusiness(test);
    const spare = await test.services.business.createResource(
      shop.owner.actor,
      shop.business.id,
      "כיסא שני",
    );
    const customer = await signIn(test, "+972500000002", "דנה");
    await test.services.booking.book(customer.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    });

    await test.services.business.deleteResource(
      shop.owner.actor,
      shop.business.id,
      shop.resource.id,
    );

    // The appointment stands, and the calendar stops being offered.
    expect(test.store.appointments).toHaveLength(1);
    const profile = await test.services.discovery.profile(
      { kind: "ANONYMOUS" },
      shop.business.id,
    );
    expect(profile.resources.map((resource) => resource.id)).toEqual([spare.id]);
  });

  it("will not leave a business with nothing bookable", async () => {
    const shop = await anEstablishedBusiness(test);
    const spare = await test.services.business.createResource(
      shop.owner.actor,
      shop.business.id,
      "כיסא שני",
    );
    const customer = await signIn(test, "+972500000002", "דנה");
    await test.services.booking.book(customer.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    });

    // The first is withdrawn rather than removed, so its row remains. Counting
    // rows would call that "two calendars" and let the last bookable one go.
    await test.services.business.deleteResource(
      shop.owner.actor,
      shop.business.id,
      shop.resource.id,
    );

    await expect(
      test.services.business.deleteResource(shop.owner.actor, shop.business.id, spare.id),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("adding a calendar", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  it("opens the same hours the business already keeps", async () => {
    const shop = await anEstablishedBusiness(test);
    const existing = await test.services.business.listWorkingHours(
      shop.owner.actor,
      shop.business.id,
      shop.resource.id,
    );

    const second = await test.services.business.createResource(
      shop.owner.actor,
      shop.business.id,
      "כיסא שני",
    );

    // A calendar with no hours is bookable at no time at all, so a new one
    // arrived unusable and the owner had to type the week out again to say
    // what the business had already said.
    const copied = await test.services.business.listWorkingHours(
      shop.owner.actor,
      shop.business.id,
      second.id,
    );
    const asWeek = (hours: readonly { dayOfWeek: number; start: unknown; end: unknown }[]) =>
      hours.map((entry) => ({
        dayOfWeek: entry.dayOfWeek,
        start: entry.start,
        end: entry.end,
      }));
    expect(asWeek(copied)).toEqual(asWeek(existing));
    expect(copied.length).toBeGreaterThan(0);
  });

  it("is immediately bookable, without the owner touching the schedule", async () => {
    const shop = await anEstablishedBusiness(test);
    const second = await test.services.business.createResource(
      shop.owner.actor,
      shop.business.id,
      "כיסא שני",
    );
    const customer = await signIn(test, "+972500000002", "דנה");

    const booked = await test.services.booking.book(customer.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: second.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    });

    expect(booked.resourceId).toBe(second.id);
  });
});

describe("taking a calendar away", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  const aCalendarWithABooking = async () => {
    const shop = await anEstablishedBusiness(test);
    const spare = await test.services.business.createResource(
      shop.owner.actor,
      shop.business.id,
      "כיסא שני",
    );
    const customer = await signIn(test, "+972500000002", "דנה");
    const booked = await test.services.booking.book(customer.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: spare.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    });
    return { shop, spare, booked };
  };

  it("keeps what is booked when the owner says to keep it", async () => {
    const { shop, spare, booked } = await aCalendarWithABooking();

    await test.services.business.deleteResource(
      shop.owner.actor,
      shop.business.id,
      spare.id,
      "KEEP",
    );

    // The appointment stands and its customer is none the wiser; the calendar
    // simply stops being offered for anything new.
    const after = test.store.appointments.find((entry) => entry.id === booked.id);
    expect(after?.status).toBe("CONFIRMED");
    expect(test.deliveredTemplates).not.toContain("BOOKING_CANCELLED");
  });

  it("calls off what is booked when the owner says to, and tells each customer", async () => {
    const { shop, spare, booked } = await aCalendarWithABooking();

    await test.services.business.deleteResource(
      shop.owner.actor,
      shop.business.id,
      spare.id,
      "CANCEL",
    );

    const after = test.store.appointments.find((entry) => entry.id === booked.id);
    expect(after?.status).toBe("CANCELLED");
    expect(after?.cancelledBy).toBe("BUSINESS");

    // Somebody holding an appointment that has just stopped existing hears it
    // from us rather than at the door.
    await test.services.outboxWorker.drain();
    expect(test.deliveredTemplates).toContain("BOOKING_CANCELLED");
  });

  it("leaves the past alone either way", async () => {
    const { shop, spare } = await aCalendarWithABooking();
    // Move past the appointment, so it is history rather than a plan.
    test.travelTo(parseInstant(TUESDAY_AT("18:00")));

    await test.services.business.deleteResource(
      shop.owner.actor,
      shop.business.id,
      spare.id,
      "CANCEL",
    );

    // Nothing upcoming to call off, and what happened is still recorded.
    expect(test.store.appointments).toHaveLength(1);
    expect(test.store.appointments[0]?.status).toBe("CONFIRMED");
  });
});

describe("hiding a calendar", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  it("takes it off what customers are offered, and puts it back", async () => {
    const shop = await anEstablishedBusiness(test);
    const spare = await test.services.business.createResource(
      shop.owner.actor,
      shop.business.id,
      "כיסא שני",
    );

    await test.services.business.updateResource(
      shop.owner.actor,
      shop.business.id,
      spare.id,
      { active: false },
    );
    const whileHidden = await test.services.discovery.profile(
      { kind: "ANONYMOUS" },
      shop.business.id,
    );
    expect(whileHidden.resources.map((resource) => resource.id)).not.toContain(spare.id);

    await test.services.business.updateResource(
      shop.owner.actor,
      shop.business.id,
      spare.id,
      { active: true },
    );
    const whenShown = await test.services.discovery.profile(
      { kind: "ANONYMOUS" },
      shop.business.id,
    );
    expect(whenShown.resources.map((resource) => resource.id)).toContain(spare.id);
  });

  it("will not hide the last one a business has", async () => {
    const shop = await anEstablishedBusiness(test);

    // Hiding is how a calendar stops being offered, so hiding the only one
    // leaves a business no one can book — the same end the delete guard
    // already refuses, reached by a different door.
    await expect(
      test.services.business.updateResource(
        shop.owner.actor,
        shop.business.id,
        shop.resource.id,
        { active: false },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("where else a business can be found", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  it("keeps an Instagram handle and a WhatsApp number, and hands them back", async () => {
    const shop = await anEstablishedBusiness(test);

    const updated = await test.services.business.update(shop.owner.actor, shop.business.id, {
      instagram: "dreamhair",
      whatsapp: "+972545646946",
    });

    expect(updated.instagram).toBe("dreamhair");
    expect(updated.whatsapp).toBe("+972545646946");

    // And a customer looking at the business sees them, since that is the only
    // reason to hold them at all.
    const profile = await test.services.discovery.profile(
      { kind: "ANONYMOUS" },
      shop.business.id,
    );
    expect(profile.business.instagram).toBe("dreamhair");
    expect(profile.business.whatsapp).toBe("+972545646946");
  });

  it("lets a business take them down again", async () => {
    const shop = await anEstablishedBusiness(test);
    await test.services.business.update(shop.owner.actor, shop.business.id, {
      instagram: "dreamhair",
    });

    const cleared = await test.services.business.update(shop.owner.actor, shop.business.id, {
      instagram: null,
    });

    // Null is a removal, not "no change" — the distinction the other optional
    // fields already make.
    expect(cleared.instagram).toBeNull();
  });

  it("leaves them alone when the change does not mention them", async () => {
    const shop = await anEstablishedBusiness(test);
    await test.services.business.update(shop.owner.actor, shop.business.id, {
      instagram: "dreamhair",
      whatsapp: "+972545646946",
    });

    const renamed = await test.services.business.update(shop.owner.actor, shop.business.id, {
      name: "שם חדש",
    });

    expect(renamed.instagram).toBe("dreamhair");
    expect(renamed.whatsapp).toBe("+972545646946");
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
    expect(customers.map((customer) => displayName(customer.user))).toEqual(["דנה"]);
  });

  it("shows an owner who booked at their own business", async () => {
    const test = harness();
    const shop = await anEstablishedBusiness(test);

    // A person holds one role per Business, and booking never demotes an owner
    // to customer. Reading the list off that role therefore hid anyone who was
    // both — the owner who takes an appointment in their own chair, which is
    // exactly what a one-person business does all day.
    await test.services.booking.book(shop.owner.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("11:00"),
      customerNote: null,
    });

    const customers = await test.services.calendar.customers(
      shop.owner.actor,
      shop.business.id,
    );
    expect(customers.map((customer) => customer.user.id)).toContain(shop.owner.user.id);
  });

  it("shows a customer whose only appointment was cancelled", async () => {
    const test = harness();
    const shop = await anEstablishedBusiness(test);
    const customer = await signIn(test, "+972500000004", "יעל");

    const appointment = await test.services.booking.book(customer.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("12:00"),
      customerNote: null,
    });
    await test.services.booking.cancel(customer.actor, appointment.id);

    // Cancelling ends an appointment, not a relationship: the owner still needs
    // to find this person to talk to them about it.
    const customers = await test.services.calendar.customers(
      shop.owner.actor,
      shop.business.id,
    );
    expect(customers.map((customer) => displayName(customer.user))).toContain("יעל");
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

describe("business photos", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  const aPhoto = (byteSize = 64) => new Uint8Array(byteSize).fill(7);

  it("puts the cover in slot zero and hands back where it lives", async () => {
    const shop = await anEstablishedBusiness(test);
    const photo = await test.services.business.putPhoto(
      shop.owner.actor,
      shop.business.id,
      { slot: 0, bytes: aPhoto(), contentType: "image/jpeg" },
    );

    expect(photo.slot).toBe(0);
    expect(photo.byteSize).toBe(64);
    // The bytes really went to the store, rather than only the row being written.
    expect(test.photos.read?.(photo.storagePath)?.bytes).toHaveLength(64);
  });

  it("takes a cover and three more, and a fifth replaces rather than adds", async () => {
    const shop = await anEstablishedBusiness(test);
    for (const slot of [0, 1, 2, 3] as const) {
      await test.services.business.putPhoto(shop.owner.actor, shop.business.id, {
        slot,
        bytes: aPhoto(),
        contentType: "image/png",
      });
    }
    expect(
      await test.services.business.listPhotos(shop.owner.actor, shop.business.id),
    ).toHaveLength(MAXIMUM_PHOTOS);

    // There is no fifth slot to fill, so putting one more replaces slot one.
    const replacement = await test.services.business.putPhoto(
      shop.owner.actor,
      shop.business.id,
      { slot: 1, bytes: aPhoto(128), contentType: "image/png" },
    );
    const held = await test.services.business.listPhotos(
      shop.owner.actor,
      shop.business.id,
    );
    expect(held).toHaveLength(MAXIMUM_PHOTOS);
    expect(held.find((photo) => photo.slot === 1)?.id).toBe(replacement.id);
    expect(replacement.byteSize).toBe(128);
  });

  it("replacing drops the bytes of the photo it replaced", async () => {
    const shop = await anEstablishedBusiness(test);
    const first = await test.services.business.putPhoto(
      shop.owner.actor,
      shop.business.id,
      { slot: 0, bytes: aPhoto(), contentType: "image/jpeg" },
    );
    const second = await test.services.business.putPhoto(
      shop.owner.actor,
      shop.business.id,
      { slot: 0, bytes: aPhoto(32), contentType: "image/jpeg" },
    );

    expect(second.storagePath).not.toBe(first.storagePath);
    expect(test.photos.read?.(first.storagePath)).toBeNull();
    expect(test.photos.read?.(second.storagePath)?.bytes).toHaveLength(32);
  });

  it("refuses a file that is not one of the image types", async () => {
    const shop = await anEstablishedBusiness(test);
    await expect(
      test.services.business.putPhoto(shop.owner.actor, shop.business.id, {
        slot: 0,
        bytes: aPhoto(),
        contentType: "application/pdf",
      }),
    ).rejects.toThrow(/image/);
  });

  it("refuses an empty file and one over the limit", async () => {
    const shop = await anEstablishedBusiness(test);
    const add = (bytes: Uint8Array) =>
      test.services.business.putPhoto(shop.owner.actor, shop.business.id, {
        slot: 0,
        bytes,
        contentType: "image/jpeg",
      });

    await expect(add(new Uint8Array(0))).rejects.toThrow(/empty/i);
    await expect(add(aPhoto(PHOTOS.maximumBytes + 1))).rejects.toThrow(/at most/i);
  });

  it("does not let somebody else's owner add a photo, or reach the bucket", async () => {
    const shop = await anEstablishedBusiness(test);
    const stranger = await signIn(test, "+972500000099");

    await expect(
      test.services.business.putPhoto(stranger.actor, shop.business.id, {
        slot: 0,
        bytes: aPhoto(),
        contentType: "image/jpeg",
      }),
    ).rejects.toThrow(/manage/i);
    // Ownership is checked before anything is uploaded, so nothing was stored.
    expect(test.store.businessPhotos).toHaveLength(0);
  });

  it("leaves no orphaned bytes, and the old photo, when the swap fails", async () => {
    const shop = await anEstablishedBusiness(test);
    const original = await test.services.business.putPhoto(
      shop.owner.actor,
      shop.business.id,
      { slot: 0, bytes: aPhoto(), contentType: "image/jpeg" },
    );

    // Ownership is settled before the upload and checked again inside the
    // transaction that swaps the rows. Losing it in between — an owner removed
    // while they were choosing a file — is what fails the second check.
    const realPut = test.photos.put.bind(test.photos);
    let uploaded: string | null = null;
    test.photos.put = async (input) => {
      const result = await realPut(input);
      uploaded = result.path;
      test.store.memberships = [];
      return result;
    };

    await expect(
      test.services.business.putPhoto(shop.owner.actor, shop.business.id, {
        slot: 0,
        bytes: aPhoto(999),
        contentType: "image/jpeg",
      }),
    ).rejects.toThrow();

    // The bytes nobody can reach are gone...
    expect(uploaded).not.toBeNull();
    expect(test.photos.read?.(uploaded as unknown as string)).toBeNull();
    // ...and the photo the business already had is untouched.
    expect(test.store.businessPhotos).toHaveLength(1);
    expect(test.photos.read?.(original.storagePath)?.bytes).toHaveLength(64);
  });

  it("keeps the new photo when the old one's bytes cannot be tidied away", async () => {
    const shop = await anEstablishedBusiness(test);
    const original = await test.services.business.putPhoto(
      shop.owner.actor,
      shop.business.id,
      { slot: 0, bytes: aPhoto(), contentType: "image/jpeg" },
    );

    // The rows have already been swapped by the time the superseded object is
    // dropped. If that drop is allowed to fail the call, the compensating
    // delete removes the bytes the committed row points at, and the business
    // is left with a photo that renders as nothing.
    test.photos.remove = async (path) => {
      if (path === original.storagePath) throw new Error("Storage refused the delete");
    };

    const replacement = await test.services.business.putPhoto(
      shop.owner.actor,
      shop.business.id,
      { slot: 0, bytes: aPhoto(32), contentType: "image/jpeg" },
    );

    expect(test.store.businessPhotos).toHaveLength(1);
    expect(test.store.businessPhotos[0]?.id).toBe(replacement.id);
    expect(test.photos.read?.(replacement.storagePath)?.bytes).toHaveLength(32);
  });

  it("deleting a photo frees its slot and drops the bytes", async () => {
    const shop = await anEstablishedBusiness(test);
    const photo = await test.services.business.putPhoto(
      shop.owner.actor,
      shop.business.id,
      { slot: 3, bytes: aPhoto(), contentType: "image/webp" },
    );

    await test.services.business.deletePhoto(
      shop.owner.actor,
      shop.business.id,
      photo.id,
    );

    expect(
      await test.services.business.listPhotos(shop.owner.actor, shop.business.id),
    ).toEqual([]);
    expect(test.photos.read?.(photo.storagePath)).toBeNull();
  });

  it("a customer looking at the business sees its photos, cover first", async () => {
    const shop = await anEstablishedBusiness(test);
    for (const slot of [2, 0] as const) {
      await test.services.business.putPhoto(shop.owner.actor, shop.business.id, {
        slot,
        bytes: aPhoto(),
        contentType: "image/jpeg",
      });
    }

    const profile = await test.services.discovery.profile(
      { kind: "ANONYMOUS" },
      shop.business.id,
    );
    expect(profile.photos.map((photo) => photo.slot)).toEqual([0, 2]);
  });
});
