import { parseInstant } from "@tor-now/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { harness, signIn, type Harness } from "../infrastructure/testing/harness.ts";
import { anEstablishedBusiness, TUESDAY, TUESDAY_AT } from "../infrastructure/testing/scenarios.ts";

const at = (day: { slots: readonly { startAt: string }[] }) =>
  day.slots.map((slot) => slot.startAt);

describe("availability", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  const forDay = async (shop: Awaited<ReturnType<typeof anEstablishedBusiness>>) =>
    test.services.availability.forRange(
      { kind: "ANONYMOUS" },
      {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: shop.resource.id,
        from: TUESDAY as never,
        to: TUESDAY as never,
      },
    );

  it("offers the day to someone with no session at all", async () => {
    const shop = await anEstablishedBusiness(test);
    const [day] = await forDay(shop);
    expect(day?.slots.length).toBeGreaterThan(0);
    expect(day?.emptyReason).toBeNull();
  });

  it("returns start times and nothing else about the business's bookings", async () => {
    const shop = await anEstablishedBusiness(test);
    const customer = await signIn(test, "+972500000002", "דנה");
    await test.services.booking.book(customer.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    });

    const [day] = await forDay(shop);
    // ADR 0007: only free start times cross the wire.
    const serialised = JSON.stringify(day);
    expect(serialised).not.toContain("דנה");
    expect(serialised).not.toContain(customer.user.id);
    expect(Object.keys(day?.slots[0] ?? {})).toEqual(["startAt", "endAt"]);
  });

  it("withholds a slot once it is taken, and offers it again once cancelled", async () => {
    const shop = await anEstablishedBusiness(test);
    const customer = await signIn(test, "+972500000002");

    const before = at((await forDay(shop))[0]!);
    const appointment = await test.services.booking.book(customer.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    });

    const during = at((await forDay(shop))[0]!);
    expect(during).not.toContain(TUESDAY_AT("09:00"));
    expect(during).toHaveLength(before.length - 1);

    await test.services.booking.cancel(customer.actor, appointment.id);
    expect(at((await forDay(shop))[0]!)).toEqual(before);
  });

  it("a customer sees the same availability as a stranger, not only their own bookings", async () => {
    // The failure this guards against is silent: if the reader could only see
    // its own appointments, someone else's booking would look like free time.
    const shop = await anEstablishedBusiness(test);
    const booker = await signIn(test, "+972500000002");
    await test.services.booking.book(booker.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    });

    const other = await signIn(test, "+972500000003");
    const [asStranger] = await forDay(shop);
    const [asOther] = await test.services.availability.forRange(other.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      from: TUESDAY as never,
      to: TUESDAY as never,
    });

    expect(at(asOther!)).toEqual(at(asStranger!));
    expect(at(asOther!)).not.toContain(TUESDAY_AT("09:00"));
  });

  it("says why a day is empty rather than merely that it is", async () => {
    const shop = await anEstablishedBusiness(test);
    // The Wednesday has no working hours at all.
    const [day] = await test.services.availability.forRange(
      { kind: "ANONYMOUS" },
      {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: shop.resource.id,
        from: "2026-09-02" as never,
        to: "2026-09-02" as never,
      },
    );
    expect(day?.slots).toEqual([]);
    expect(day?.emptyReason).toBe("CLOSED");
  });

  it("refuses a service that belongs to another business", async () => {
    const shop = await anEstablishedBusiness(test);
    const otherOwner = await signIn(test, "+972500000007");
    const other = await test.services.business.register(otherOwner.actor, {
      name: "אחר",
      phone: "+972500000007",
      description: null,
      address: "רחוב אחר 2",
      latitude: 32.0853,
      longitude: 34.7818,
      category: "barbershop",
      resourceNames: ["א"],
      services: [{ name: "ש", durationMinutes: 30, priceMinor: 0, bufferMinutes: null }],
      workingHours: [{ dayOfWeek: 2, start: "09:00", end: "17:00" }],
    });
    const [otherService] = await test.services.business.listServices(
      otherOwner.actor,
      other.id,
    );

    await expect(
      test.services.availability.forRange(
        { kind: "ANONYMOUS" },
        {
          businessId: shop.business.id,
          serviceId: otherService!.id,
          resourceId: shop.resource.id,
          from: TUESDAY as never,
          to: TUESDAY as never,
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("discovery", () => {
  it("browses every business while the query is too short to rank", async () => {
    const test = harness();
    const shop = await anEstablishedBusiness(test);
    const found = await test.services.discovery.search({ kind: "ANONYMOUS" }, "מ");
    expect(found.map((result) => result.business.id)).toContain(shop.business.id);
  });

  it("finds a business by part of its name", async () => {
    const test = harness();
    const shop = await anEstablishedBusiness(test);
    const found = await test.services.discovery.search({ kind: "ANONYMOUS" }, "מספרת");
    expect(found.map((result) => result.business.id)).toContain(shop.business.id);
  });

  it("marks a business open when the moment falls inside a Resource's working hours", async () => {
    const test = harness();
    const shop = await anEstablishedBusiness(test);
    test.travelTo(parseInstant(TUESDAY_AT("10:00")));

    const [found] = await test.services.discovery.search({ kind: "ANONYMOUS" }, "מספרת");
    expect(found?.business.id).toBe(shop.business.id);
    expect(found?.openNow).toBe(true);
  });

  it("marks a business closed once the moment falls outside every Resource's hours", async () => {
    const test = harness();
    const shop = await anEstablishedBusiness(test);
    test.travelTo(parseInstant(TUESDAY_AT("20:00")));

    const [found] = await test.services.discovery.search({ kind: "ANONYMOUS" }, "מספרת");
    expect(found?.business.id).toBe(shop.business.id);
    expect(found?.openNow).toBe(false);
  });

  /**
   * The three things "open now" is actually made of, each of which a page-wide
   * read could get wrong while the simple case above still passed: the Date
   * Override for today, a withdrawn calendar, and the fact that "today" is the
   * Business's own date and not the server's.
   */
  it("marks a business closed when today's override takes the day away", async () => {
    const test = harness();
    const shop = await anEstablishedBusiness(test);
    test.travelTo(parseInstant(TUESDAY_AT("10:00")));

    // Inside the week's hours, and shut anyway: an Override with no ranges
    // replaces the weekday entirely (ADR 0002).
    await test.services.business.putOverride(
      shop.owner.actor,
      shop.business.id,
      shop.resource.id,
      { date: TUESDAY, note: null, ranges: [] },
    );

    const [found] = await test.services.discovery.search({ kind: "ANONYMOUS" }, "מספרת");
    expect(found?.openNow).toBe(false);
  });

  it("does not count a withdrawn calendar as somebody who could see you", async () => {
    const test = harness();
    const shop = await anEstablishedBusiness(test);
    test.travelTo(parseInstant(TUESDAY_AT("10:00")));

    // A second calendar, so the one with these hours can be let go — a business
    // must always keep one. A new calendar inherits the week, so this one is
    // given an evening of its own that says nothing about ten in the morning.
    const evenings = await test.services.business.createResource(
      shop.owner.actor,
      shop.business.id,
      "ב",
    );
    await test.services.business.replaceWorkingHours(
      shop.owner.actor,
      shop.business.id,
      evenings.id,
      [{ dayOfWeek: 2, start: "18:00", end: "20:00" }],
    );
    // Now the calendar that keeps these hours is off the shop: the hours still
    // exist, and there is nobody to walk in to.
    await test.services.business.updateResource(
      shop.owner.actor,
      shop.business.id,
      shop.resource.id,
      { active: false },
    );

    const [found] = await test.services.discovery.search({ kind: "ANONYMOUS" }, "מספרת");
    // Ten in the morning: inside the withdrawn calendar's hours, outside the
    // one calendar still on offer.
    expect(found?.openNow).toBe(false);
  });

  it("judges each result by its own zone's date, not by one date for the page", async () => {
    const test = harness();
    const owner = await signIn(test, "+972500000001", "רן");
    const common = {
      description: null,
      address: "רחוב הרצל 1",
      latitude: 32.0853,
      longitude: 34.7818,
      category: "barbershop" as const,
      resourceNames: ["א"],
      services: [
        { name: "תספורת", durationMinutes: 30, priceMinor: 8000, bufferMinutes: null },
      ],
      // Tuesday, which 2026-09-01 is.
      workingHours: [{ dayOfWeek: 2, start: "09:00", end: "17:00" }],
    };
    await test.services.business.register(owner.actor, {
      ...common, name: "מספרה ישראל", phone: "+972500001201",
    });
    const there = await test.services.business.register(owner.actor, {
      ...common, name: "מספרה קליפורניה", phone: "+972500001202",
    });
    await test.services.business.update(owner.actor, there.id, {
      timeZone: "America/Los_Angeles",
    });

    // One instant, two dates: Tuesday afternoon in California, Wednesday small
    // hours in Israel. A page that picked one date for everybody would read the
    // wrong day for one of them.
    test.travelTo(parseInstant("2026-09-01T23:00:00.000Z"));

    const found = await test.services.discovery.search({ kind: "ANONYMOUS" }, "מספרה");
    const byName = new Map(found.map((result) => [result.business.name, result.openNow]));

    // The two answers have to differ, which is what makes this test bite: one
    // date for the whole page gets one of them wrong whichever date it picks.
    // California is at Tuesday 16:00, inside its week.
    expect(byName.get("מספרה קליפורניה")).toBe(true);
    // Israel is at Wednesday 02:00, a day it does not work at all.
    expect(byName.get("מספרה ישראל")).toBe(false);
  });

  it("drops a deactivated business out of search but keeps its profile reachable", async () => {
    const test = harness();
    const shop = await anEstablishedBusiness(test);
    await test.services.admin.setBusinessActive(
      { kind: "ADMINISTRATOR", userId: shop.owner.user.id },
      shop.business.id,
      false,
    );

    expect(await test.services.discovery.search({ kind: "ANONYMOUS" }, "מספרת")).toEqual([]);
    const profile = await test.services.discovery.profile(
      { kind: "ANONYMOUS" },
      shop.business.id,
    );
    expect(profile.business.active).toBe(false);
  });

  it("offers only the services and calendars a customer can actually book", async () => {
    const test = harness();
    const shop = await anEstablishedBusiness(test);
    await test.services.business.updateService(
      shop.owner.actor,
      shop.business.id,
      shop.service.id,
      { active: false },
    );

    const profile = await test.services.discovery.profile(
      { kind: "ANONYMOUS" },
      shop.business.id,
    );
    expect(profile.services).toEqual([]);
  });
});
