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
  it("says nothing until the query is long enough to rank", async () => {
    const test = harness();
    await anEstablishedBusiness(test);
    expect(await test.services.discovery.search({ kind: "ANONYMOUS" }, "מ")).toEqual([]);
  });

  it("finds a business by part of its name", async () => {
    const test = harness();
    const shop = await anEstablishedBusiness(test);
    const found = await test.services.discovery.search({ kind: "ANONYMOUS" }, "מספרת");
    expect(found.map((business) => business.id)).toContain(shop.business.id);
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
