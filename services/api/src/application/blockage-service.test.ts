import { beforeEach, describe, expect, it } from "vitest";
import type { ResourceId } from "@tor-now/domain";
import { harness, signIn, type Harness } from "../infrastructure/testing/harness.ts";
import { anEstablishedBusiness, TUESDAY_AT } from "../infrastructure/testing/scenarios.ts";

/**
 * Blocking out time, and the people already booked inside it.
 *
 * A blockage is as capable of stranding somebody as closing the shop is — it
 * just looked smaller. It used to be written straight over whatever was booked:
 * the hours were gone from the calendar, the appointments stayed on top of
 * them, and nobody was told either way.
 */
describe("blocking time out", () => {
  let test: Harness;
  let shop: Awaited<ReturnType<typeof anEstablishedBusiness>>;

  beforeEach(async () => {
    test = harness();
    shop = await anEstablishedBusiness(test);
  });

  const aBookingAt = async (phone: string, startAt: string) => {
    const customer = await signIn(test, phone, "דנה כהן");
    return test.services.booking.book(customer.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt,
      customerNote: null,
    });
  };

  it("warns by name about what a blockage would sit on top of", async () => {
    const appointment = await aBookingAt("+972500000002", TUESDAY_AT("09:00"));

    const impact = await test.services.calendar.blockPreview(
      shop.owner.actor,
      shop.business.id,
      shop.resource.id,
      [{ startAt: TUESDAY_AT("09:00"), endAt: TUESDAY_AT("12:00"), reason: "ספק" }],
    );

    expect(impact.appointments).toHaveLength(1);
    expect(impact.appointments[0]?.id).toBe(appointment.id);
    expect(impact.appointments[0]?.customerName).toBe("דנה כהן");
    expect(impact.days).toBe(1);
  });

  it("catches an appointment that began before the blockage and runs into it", async () => {
    // The one somebody would otherwise turn up for: it starts before the
    // stretch, so a query about the stretch alone never sees it.
    const appointment = await aBookingAt("+972500000002", TUESDAY_AT("10:00"));

    const impact = await test.services.calendar.blockPreview(
      shop.owner.actor,
      shop.business.id,
      shop.resource.id,
      [{ startAt: TUESDAY_AT("10:15"), endAt: TUESDAY_AT("12:00"), reason: "ספק" }],
    );
    expect(impact.appointments.map((one) => one.id)).toEqual([appointment.id]);
  });

  it("says nothing about an appointment the blockage does not touch", async () => {
    await aBookingAt("+972500000002", TUESDAY_AT("15:00"));

    const impact = await test.services.calendar.blockPreview(
      shop.owner.actor,
      shop.business.id,
      shop.resource.id,
      [{ startAt: TUESDAY_AT("09:00"), endAt: TUESDAY_AT("12:00"), reason: "ספק" }],
    );
    expect(impact.appointments).toHaveLength(0);
  });

  it("leaves the appointments standing unless it is asked not to", async () => {
    const appointment = await aBookingAt("+972500000002", TUESDAY_AT("09:00"));

    await test.services.calendar.createBlocks(
      shop.owner.actor,
      shop.business.id,
      shop.resource.id,
      [{ startAt: TUESDAY_AT("09:00"), endAt: TUESDAY_AT("12:00"), reason: "ספק" }],
      "KEEP",
    );

    expect(
      test.store.appointments.find((one) => one.id === appointment.id)?.status,
    ).toBe("CONFIRMED");
  });

  it("calls them off and tells the customers when it is", async () => {
    const appointment = await aBookingAt("+972500000002", TUESDAY_AT("09:00"));
    const other = await aBookingAt("+972500000003", TUESDAY_AT("11:00"));

    await test.services.calendar.createBlocks(
      shop.owner.actor,
      shop.business.id,
      shop.resource.id,
      [{ startAt: TUESDAY_AT("09:00"), endAt: TUESDAY_AT("12:00"), reason: "השתלמות" }],
      "CANCEL",
    );

    const stored = test.store.appointments.filter((one) =>
      [appointment.id, other.id].includes(one.id),
    );
    expect(stored.every((one) => one.status === "CANCELLED")).toBe(true);
    expect(stored.every((one) => one.cancelledBy === "BUSINESS")).toBe(true);
    const told = test.store.outbox.filter(
      (entry) => entry.message.template === "BOOKING_CANCELLED",
    );
    expect(told).toHaveLength(2);
  });

  it("makes the blockage even so, and takes the hours out of the day", async () => {
    await aBookingAt("+972500000002", TUESDAY_AT("09:00"));
    const made = await test.services.calendar.createBlocks(
      shop.owner.actor,
      shop.business.id,
      shop.resource.id,
      [{ startAt: TUESDAY_AT("09:00"), endAt: TUESDAY_AT("12:00"), reason: "השתלמות" }],
      "CANCEL",
    );
    expect(made).toHaveLength(1);
    expect(test.store.blocks).toHaveLength(1);
  });
});

describe("who may block a calendar", () => {
  let test: Harness;
  let shop: Awaited<ReturnType<typeof anEstablishedBusiness>>;

  beforeEach(async () => {
    test = harness();
    shop = await anEstablishedBusiness(test);
  });

  const aWorkerOn = async (phone: string, resourceIds: readonly ResourceId[]) => {
    const worker = await signIn(test, phone, "עובד");
    await test.services.business.inviteUser(shop.owner.actor, shop.business.id, {
      phone,
      givenName: "עובד",
      familyName: null,
      role: "WORKER",
      resourceIds,
    });
    return worker;
  };

  it("lets a worker keep their own calendar, which the screen offers them", async () => {
    const worker = await aWorkerOn("+972500000044", [shop.resource.id]);

    const made = await test.services.calendar.createBlocks(
      worker.actor,
      shop.business.id,
      shop.resource.id,
      [{ startAt: TUESDAY_AT("09:00"), endAt: TUESDAY_AT("10:00"), reason: "רופא" }],
      "KEEP",
    );
    expect(made).toHaveLength(1);
  });

  it("refuses a worker a calendar that is not theirs", async () => {
    // A worker is always on some calendar; the point is that it is not this one.
    const theirs = await test.services.business.createResource(
      shop.owner.actor,
      shop.business.id,
      "כיסא שני",
    );
    const worker = await aWorkerOn("+972500000045", [theirs.id]);

    await expect(
      test.services.calendar.createBlocks(
        worker.actor,
        shop.business.id,
        shop.resource.id,
        [{ startAt: TUESDAY_AT("09:00"), endAt: TUESDAY_AT("10:00"), reason: "רופא" }],
        "KEEP",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a stranger outright", async () => {
    const stranger = await signIn(test, "+972500000077");
    await expect(
      test.services.calendar.blockPreview(
        stranger.actor,
        shop.business.id,
        shop.resource.id,
        [{ startAt: TUESDAY_AT("09:00"), endAt: TUESDAY_AT("10:00"), reason: "" }],
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("blocking time that is already blocked", () => {
  let test: Harness;
  let shop: Awaited<ReturnType<typeof anEstablishedBusiness>>;

  beforeEach(async () => {
    test = harness();
    shop = await anEstablishedBusiness(test);
  });

  const block = (
    spans: { startAt: string; endAt: string; reason?: string }[],
  ) =>
    test.services.calendar.createBlocks(
      shop.owner.actor,
      shop.business.id,
      shop.resource.id,
      spans.map((span) => ({ reason: "", ...span })),
      "KEEP",
    );

  it("keeps one blockage where two would have lain on top of each other", async () => {
    await block([{ startAt: TUESDAY_AT("14:00"), endAt: TUESDAY_AT("16:00") }]);
    await block([{ startAt: TUESDAY_AT("09:00"), endAt: TUESDAY_AT("18:00") }]);

    // Two blockages over the same hour is one hour kept free said twice, and
    // removing either of them would have given back nothing.
    expect(test.store.blocks).toHaveLength(1);
    expect(test.store.blocks[0]?.startAt).toBe(Date.parse(TUESDAY_AT("09:00")));
    expect(test.store.blocks[0]?.endAt).toBe(Date.parse(TUESDAY_AT("18:00")));
  });

  it("grows the one that is there to cover what the new one adds", async () => {
    await block([{ startAt: TUESDAY_AT("14:00"), endAt: TUESDAY_AT("18:00") }]);
    await block([{ startAt: TUESDAY_AT("12:00"), endAt: TUESDAY_AT("15:00") }]);

    expect(test.store.blocks).toHaveLength(1);
    expect(test.store.blocks[0]?.startAt).toBe(Date.parse(TUESDAY_AT("12:00")));
    expect(test.store.blocks[0]?.endAt).toBe(Date.parse(TUESDAY_AT("18:00")));
  });

  it("joins one that ends exactly where the new one starts", async () => {
    await block([{ startAt: TUESDAY_AT("14:00"), endAt: TUESDAY_AT("16:00") }]);
    await block([{ startAt: TUESDAY_AT("16:00"), endAt: TUESDAY_AT("18:00") }]);
    expect(test.store.blocks).toHaveLength(1);
  });

  it("leaves a blockage elsewhere in the day alone", async () => {
    await block([{ startAt: TUESDAY_AT("09:00"), endAt: TUESDAY_AT("10:00") }]);
    await block([{ startAt: TUESDAY_AT("14:00"), endAt: TUESDAY_AT("15:00") }]);
    expect(test.store.blocks).toHaveLength(2);
  });

  it("does not reach into another calendar's day", async () => {
    const other = await test.services.business.createResource(
      shop.owner.actor,
      shop.business.id,
      "כיסא שני",
    );
    await test.services.calendar.createBlocks(
      shop.owner.actor,
      shop.business.id,
      other.id,
      [{ startAt: TUESDAY_AT("09:00"), endAt: TUESDAY_AT("18:00"), reason: "" }],
      "KEEP",
    );
    await block([{ startAt: TUESDAY_AT("14:00"), endAt: TUESDAY_AT("16:00") }]);

    // One chair being away says nothing about the one beside it.
    expect(test.store.blocks).toHaveLength(2);
  });

  it("keeps the words somebody typed when the new one said nothing", async () => {
    await block([
      { startAt: TUESDAY_AT("14:00"), endAt: TUESDAY_AT("16:00"), reason: "שיניים" },
    ]);
    await block([{ startAt: TUESDAY_AT("09:00"), endAt: TUESDAY_AT("18:00") }]);
    expect(test.store.blocks[0]?.reason).toBe("שיניים");
  });

  it("prefers what the new decision said", async () => {
    await block([
      { startAt: TUESDAY_AT("14:00"), endAt: TUESDAY_AT("16:00"), reason: "שיניים" },
    ]);
    await block([
      { startAt: TUESDAY_AT("09:00"), endAt: TUESDAY_AT("18:00"), reason: "מילואים" },
    ]);
    expect(test.store.blocks[0]?.reason).toBe("מילואים");
  });

  it("gives the whole run back as one when it is removed", async () => {
    await block([{ startAt: TUESDAY_AT("14:00"), endAt: TUESDAY_AT("16:00") }]);
    const made = await block([{ startAt: TUESDAY_AT("09:00"), endAt: TUESDAY_AT("18:00") }]);

    const groupId = made[0]?.groupId ?? "";
    await test.services.calendar.deleteBlockGroup(
      shop.owner.actor,
      shop.business.id,
      groupId,
    );
    // Nothing survives it: the hour that was blocked twice is given back once.
    expect(test.store.blocks).toHaveLength(0);
  });
});
