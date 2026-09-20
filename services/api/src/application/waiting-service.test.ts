import { beforeEach, describe, expect, it } from "vitest";
import { parseInstant } from "@tor-now/domain";
import { harness, signIn, type Harness } from "../infrastructure/testing/harness.ts";
import { anEstablishedBusiness, TUESDAY, TUESDAY_AT } from "../infrastructure/testing/scenarios.ts";

/**
 * ADR 0018's waiting list.
 *
 * A Waiting Entry holds no time: it is a standing question, and what answers
 * it is recomputed by the ordinary availability code. So the things worth
 * proving here are about the seam rather than about scheduling — that a
 * question is only answered when the day really has something to offer, that
 * every rule availability already obeys is obeyed here by inheritance, and
 * that the job is safe to run twice.
 */
describe("waiting for a time", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  const openings = () =>
    test.store.outbox.filter(
      (entry) => entry.message.template === "WAITING_LIST_OPENING",
    );

  /**
   * A shop whose Tuesday really is taken, and somebody waiting for a morning
   * on it.
   *
   * Its own business rather than the shared scenario's: four hours and a
   * sixty-minute service make exactly four slots, so "nothing left" is
   * reachable in four bookings. The shared shop is open eight hours to a
   * half-hour service, where booking every hour leaves the half-hours free —
   * a day that looks full and is not, which is precisely the mistake this
   * feature must not make.
   */
  const aFullTuesday = async () => {
    const owner = await signIn(test, "+972500000001", "רן");
    const business = await test.services.business.register(owner.actor, {
      name: "מספרת רן",
      phone: "+972500000001",
      description: null,
      address: "רחוב הרצל 1",
      latitude: 32.0853,
      longitude: 34.7818,
      category: "barbershop",
      resourceNames: ["רן"],
      services: [
        { name: "תספורת", durationMinutes: 60, priceMinor: 8000, bufferMinutes: 0 },
      ],
      workingHours: [{ dayOfWeek: 2, start: "09:00", end: "13:00" }],
    });
    const [service] = await test.services.business.listServices(owner.actor, business.id);
    const [resource] = await test.services.business.listResources(owner.actor, business.id);
    const shop = { owner, business, service: service!, resource: resource! };

    // One customer per hour: the product refuses a second appointment for the
    // same Service on the same day, which makes "one person books out the
    // shop" an unreachable fixture.
    const booked = [];
    const sitters = [];
    for (const [nth, time] of ["09:00", "10:00", "11:00", "12:00"].entries()) {
      const sitter = await signIn(test, `+97250000010${nth}`, `לקוח ${nth}`);
      sitters.push(sitter);
      booked.push(
        await test.services.booking.book(sitter.actor, {
          businessId: shop.business.id,
          serviceId: shop.service.id,
          resourceId: shop.resource.id,
          startAt: TUESDAY_AT(time),
          customerNote: null,
        }),
      );
    }

    const waiting = await signIn(test, "+972500000003", "דנה");
    const entry = await test.services.waiting.join(waiting.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceIds: [shop.resource.id],
      onDate: TUESDAY,
      parts: ["MORNING"],
    });

    return { shop, taken: sitters[0]!, sitters, waiting, booked, entry };
  };

  describe("joining", () => {
    it("records the question, and hands it back to the customer who asked", async () => {
      const { waiting, entry, shop } = await aFullTuesday();

      expect(entry.parts).toEqual(["MORNING"]);
      expect(entry.onDate).toBe(TUESDAY);

      const mine = await test.services.waiting.mine(waiting.actor);
      expect(mine).toHaveLength(1);
      expect(mine[0]!.id).toBe(entry.id);
      expect(mine[0]!.businessName).toBe(shop.business.name);
      expect(mine[0]!.serviceName).toBe(shop.service.name);
    });

    it("refuses a part of the day that is not one", async () => {
      const shop = await anEstablishedBusiness(test);
      const customer = await signIn(test, "+972500000004", "נועם");
      await expect(
        test.services.waiting.join(customer.actor, {
          businessId: shop.business.id,
          serviceId: shop.service.id,
          resourceIds: [shop.resource.id],
          onDate: TUESDAY,
          parts: ["LUNCHTIME"],
        }),
      ).rejects.toThrow(/LUNCHTIME/);
    });

    it("refuses a calendar belonging to another business", async () => {
      const mine = await anEstablishedBusiness(test);
      const owner = await signIn(test, "+972500000009", "שרה");
      const theirs = await test.services.business.register(owner.actor, {
        name: "מספרה אחרת",
        phone: "+972500000009",
        description: null,
        address: "רחוב אחר 2",
        latitude: 32.09,
        longitude: 34.78,
        category: "barbershop",
        resourceNames: ["כיסא"],
        services: [
          { name: "תספורת", durationMinutes: 30, priceMinor: 8000, bufferMinutes: null },
        ],
        workingHours: [{ dayOfWeek: 2, start: "09:00", end: "17:00" }],
      });
      const [elsewhere] = await test.services.business.listResources(owner.actor, theirs.id);
      const customer = await signIn(test, "+972500000005", "עומר");

      await expect(
        test.services.waiting.join(customer.actor, {
          businessId: mine.business.id,
          serviceId: mine.service.id,
          resourceIds: [elsewhere!.id],
          onDate: TUESDAY,
          parts: ["MORNING"],
        }),
      ).rejects.toThrow();
    });

    it("lets somebody change their mind rather than wait twice", async () => {
      const { waiting, entry, shop } = await aFullTuesday();

      const again = await test.services.waiting.join(waiting.actor, {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceIds: [shop.resource.id],
        onDate: TUESDAY,
        parts: ["EVENING"],
      });

      expect(again.id).toBe(entry.id);
      expect(again.parts).toEqual(["EVENING"]);
      expect(await test.services.waiting.mine(waiting.actor)).toHaveLength(1);
    });

    it("lets the customer withdraw, and nobody else", async () => {
      const { waiting, taken, entry } = await aFullTuesday();

      await expect(
        test.services.waiting.withdraw(taken.actor, entry.id),
      ).rejects.toThrow();

      await test.services.waiting.withdraw(waiting.actor, entry.id);
      expect(await test.services.waiting.mine(waiting.actor)).toEqual([]);
    });
  });

  describe("when time frees", () => {
    it("tells somebody waiting for the part of the day that opened", async () => {
      const { booked, taken } = await aFullTuesday();

      await test.services.booking.cancel(taken.actor, booked[0]!.id);
      await test.services.waiting.publishOpenings();

      expect(openings()).toHaveLength(1);
      const message = openings()[0]!.message;
      expect(message.recipientPhone).toBe("+972500000003");
      expect(message.payload.partOfDay).toBe("MORNING");
      expect(message.payload.resourceName).toBe("רן");
    });

    it("says nothing when the hour that freed is not one anybody asked about", async () => {
      const { booked, sitters } = await aFullTuesday();

      // 12:00 is the middle of the day; the entry asked for a morning.
      await test.services.booking.cancel(sitters[3]!.actor, booked[3]!.id);
      await test.services.waiting.publishOpenings();

      expect(openings()).toEqual([]);
    });

    it("says nothing at all while the day is still full", async () => {
      await aFullTuesday();
      await test.services.waiting.publishOpenings();
      expect(openings()).toEqual([]);
    });

    /**
     * The job may be run at any time and as often as anyone likes. The stamp
     * on the entry is what makes that safe, exactly as ADR 0013's does for a
     * reminder — and running it again with nothing new to say must be silent.
     */
    it("does not tell the same person twice about the same day", async () => {
      const { booked, taken } = await aFullTuesday();

      await test.services.booking.cancel(taken.actor, booked[0]!.id);
      await test.services.waiting.publishOpenings();
      await test.services.waiting.publishOpenings();

      expect(openings()).toHaveLength(1);
    });

    it("stops telling somebody who has withdrawn", async () => {
      const { booked, taken, waiting, entry } = await aFullTuesday();

      await test.services.waiting.withdraw(waiting.actor, entry.id);
      await test.services.booking.cancel(taken.actor, booked[0]!.id);
      await test.services.waiting.publishOpenings();

      expect(openings()).toEqual([]);
    });

    /**
     * Somebody who has booked the thing they were waiting for should not then
     * be told it is available.
     */
    it("closes an entry once its customer books that day", async () => {
      const { booked, taken, waiting, shop } = await aFullTuesday();

      await test.services.booking.cancel(taken.actor, booked[0]!.id);
      await test.services.booking.book(waiting.actor, {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: shop.resource.id,
        startAt: TUESDAY_AT("09:00"),
        customerNote: null,
      });

      expect(await test.services.waiting.mine(waiting.actor)).toEqual([]);
      await test.services.waiting.publishOpenings();
      expect(openings()).toEqual([]);
    });

    /**
     * The owner's switch on the cancel sheet. Keeping the hour writes no mark,
     * so there is nothing for the job to find — the feature is off for that
     * hour without anything having to remember it was.
     */
    it("keeps the hour to itself when the business cancels without publishing", async () => {
      const { booked, shop } = await aFullTuesday();

      await test.services.booking.cancel(shop.owner.actor, booked[0]!.id, {
        publishFreedTime: false,
      });
      await test.services.waiting.publishOpenings();

      expect(openings()).toEqual([]);
    });

    it("publishes when the business cancels and says so", async () => {
      const { booked, shop } = await aFullTuesday();

      await test.services.booking.cancel(shop.owner.actor, booked[0]!.id, {
        publishFreedTime: true,
      });
      await test.services.waiting.publishOpenings();

      expect(openings()).toHaveLength(1);
    });

    /**
     * Time frees in more ways than a cancellation. This is the one that a
     * "hook the cancellation" design would have missed entirely.
     */
    it("notices a blockage being lifted", async () => {
      const shop = await anEstablishedBusiness(test);
      const waiting = await signIn(test, "+972500000006", "גיא");

      const [block] = await test.services.calendar.createBlocks(
        shop.owner.actor,
        shop.business.id,
        shop.resource.id,
        [{ startAt: TUESDAY_AT("09:00"), endAt: TUESDAY_AT("12:00"), reason: "מילואים" }],
      );

      await test.services.waiting.join(waiting.actor, {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceIds: [shop.resource.id],
        onDate: TUESDAY,
        parts: ["MORNING"],
      });
      // Nothing yet: the morning is blocked.
      await test.services.waiting.publishOpenings();
      expect(openings()).toEqual([]);

      await test.services.calendar.deleteBlock(
        shop.owner.actor,
        shop.business.id,
        block!.id,
      );
      await test.services.waiting.publishOpenings();

      expect(openings()).toHaveLength(1);
    });

    it("leaves the mark alone until it has been looked at, then clears it", async () => {
      const { booked, taken } = await aFullTuesday();

      await test.services.booking.cancel(taken.actor, booked[0]!.id);
      expect(test.store.waitingRechecks).toHaveLength(1);

      await test.services.waiting.publishOpenings();
      expect(test.store.waitingRechecks).toEqual([]);
    });

    it("forgets an entry whose day has gone by", async () => {
      const { waiting } = await aFullTuesday();
      expect(await test.services.waiting.mine(waiting.actor)).toHaveLength(1);

      // The Wednesday after. A single date needs no expiry sweep: it stops
      // being open by being over.
      test.travelTo(parseInstant("2026-09-02T08:00:00.000Z"));
      expect(await test.services.waiting.mine(waiting.actor)).toEqual([]);
    });
  });
});
