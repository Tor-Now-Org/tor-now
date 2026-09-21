import { beforeEach, describe, expect, it } from "vitest";
import { harness, signIn, type Harness } from "../infrastructure/testing/harness.ts";
import { anEstablishedBusiness, TUESDAY, TUESDAY_AT } from "../infrastructure/testing/scenarios.ts";
import type { Actor } from "../ports/unit-of-work.ts";

/**
 * Who is refused, and with which words.
 *
 * ADR 0007 enforces isolation twice on purpose — Row Level Security is the
 * authority, and these checks exist so a caller gets "you do not own this
 * business" instead of an empty result. That makes the refusals themselves the
 * behaviour, which is what these cases hold: the paths through the checks are
 * shared and rearranged for the sake of reading the Business once, and a
 * rearrangement that quietly let somebody through would not fail anything else.
 */
describe("who may reach a business", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  /** A shop with two calendars and a WORKER put on the first of them. */
  const aShopWithAWorker = async () => {
    const shop = await anEstablishedBusiness(test);
    const second = await test.services.business.createResource(
      shop.owner.actor,
      shop.business.id,
      "יומן ב",
    );
    const worker = await signIn(test, "+972500000055", "עובד");
    await test.services.business.inviteUser(shop.owner.actor, shop.business.id, {
      phone: "+972500000055",
      givenName: "עובד",
      familyName: null,
      role: "WORKER",
      resourceIds: [shop.resource.id],
    });
    return { shop, second, worker };
  };

  it("lets a worker read the calendar they were put on", async () => {
    const { shop, worker } = await aShopWithAWorker();

    const day = await test.services.calendar.day(
      worker.actor,
      shop.business.id,
      shop.resource.id,
      "2026-09-01",
    );

    expect(day.date).toBe("2026-09-01");
  });

  it("refuses a worker the calendar they were not put on", async () => {
    const { shop, second, worker } = await aShopWithAWorker();

    await expect(
      test.services.calendar.day(worker.actor, shop.business.id, second.id, "2026-09-01"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses somebody who does not work there at all", async () => {
    const shop = await anEstablishedBusiness(test);
    const stranger = await signIn(test, "+972500000066", "זר");

    await expect(
      test.services.calendar.businessDay(stranger.actor, shop.business.id, "2026-09-01"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses an anonymous caller before anything else", async () => {
    const shop = await anEstablishedBusiness(test);

    await expect(
      test.services.calendar.businessDay({ kind: "ANONYMOUS" }, shop.business.id, "2026-09-01"),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("locks an owner out of their own business once it is deactivated", async () => {
    const shop = await anEstablishedBusiness(test);
    const administrator: Actor = {
      kind: "ADMINISTRATOR",
      userId: shop.owner.user.id,
    };
    await test.services.admin.setBusinessActive(administrator, shop.business.id, false);

    // Not only customers: an owner who could keep running a deactivated
    // business would make deactivating it pointless.
    await expect(
      test.services.calendar.businessDay(shop.owner.actor, shop.business.id, "2026-09-01"),
    ).rejects.toMatchObject({ code: "BUSINESS_INACTIVE" });
    await expect(
      test.services.calendar.customers(shop.owner.actor, shop.business.id),
    ).rejects.toMatchObject({ code: "BUSINESS_INACTIVE" });
  });

  it("lets an administrator reach a deactivated business anyway", async () => {
    const shop = await anEstablishedBusiness(test);
    const administrator: Actor = {
      kind: "ADMINISTRATOR",
      userId: shop.owner.user.id,
    };
    await test.services.admin.setBusinessActive(administrator, shop.business.id, false);

    // ADR 0010: reactivating is itself an administrator action, and cannot
    // happen from inside a lockout.
    const day = await test.services.calendar.businessDay(
      administrator,
      shop.business.id,
      "2026-09-01",
    );
    expect(day.date).toBe("2026-09-01");
  });

  /**
   * What a worker may undo.
   *
   * `roles.ts` states the rule the interface offers: "a worker keeps their own
   * calendar — blocking their own time is theirs". The server let them make a
   * blockage and a special day and then refused to let them remove either, so
   * the screen showed two buttons that existed to be refused.
   */
  it("lets a worker remove a blockage from their own calendar", async () => {
    const { shop, worker } = await aShopWithAWorker();
    const made = await test.services.calendar.createBlocks(
      worker.actor,
      shop.business.id,
      shop.resource.id,
      [{ startAt: TUESDAY_AT("10:00"), endAt: TUESDAY_AT("11:00"), reason: "רופא" }],
      "KEEP",
    );
    const [block] = made;

    await test.services.calendar.deleteBlock(
      worker.actor,
      shop.business.id,
      block!.id,
    );

    expect(test.store.blocks.find((one) => one.id === block!.id)).toBeUndefined();
  });

  it("lets a worker remove the whole blockage they made, by its group", async () => {
    const { shop, worker } = await aShopWithAWorker();
    const made = await test.services.calendar.createBlocks(
      worker.actor,
      shop.business.id,
      shop.resource.id,
      [{ startAt: TUESDAY_AT("10:00"), endAt: TUESDAY_AT("11:00"), reason: "רופא" }],
      "KEEP",
    );

    const removed = await test.services.calendar.deleteBlockGroup(
      worker.actor,
      shop.business.id,
      made[0]!.groupId,
    );

    expect(removed).toBe(1);
  });

  it("lets a worker remove a special day from their own calendar", async () => {
    const { shop, worker } = await aShopWithAWorker();
    const written = await test.services.business.putOverride(
      worker.actor,
      shop.business.id,
      shop.resource.id,
      { date: TUESDAY, note: null, ranges: [{ start: "10:00", end: "12:00" }] },
    );

    await test.services.business.deleteOverride(
      worker.actor,
      shop.business.id,
      written.id,
    );

    expect(test.store.dateOverrides.find((one) => one.id === written.id)).toBeUndefined();
  });

  it("refuses a worker the blockage on a calendar that is not theirs", async () => {
    const { shop, second, worker } = await aShopWithAWorker();
    const made = await test.services.calendar.createBlocks(
      shop.owner.actor,
      shop.business.id,
      second.id,
      [{ startAt: TUESDAY_AT("10:00"), endAt: TUESDAY_AT("11:00"), reason: "של מישהו אחר" }],
      "KEEP",
    );

    await expect(
      test.services.calendar.deleteBlock(worker.actor, shop.business.id, made[0]!.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      test.services.calendar.deleteBlockGroup(
        worker.actor,
        shop.business.id,
        made[0]!.groupId,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a worker the special day on a calendar that is not theirs", async () => {
    const { shop, second, worker } = await aShopWithAWorker();
    const written = await test.services.business.putOverride(
      shop.owner.actor,
      shop.business.id,
      second.id,
      { date: TUESDAY, note: null, ranges: [] },
    );

    await expect(
      test.services.business.deleteOverride(worker.actor, shop.business.id, written.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  /**
   * The schedule screen reads every calendar's special days to tell a chair's
   * own day from the shop's. What it is given has to be the calendars it was
   * given elsewhere — an owner all of them, a worker their own — or the
   * comparison that decides "the shop said so" is made against the wrong set.
   */
  it("gives an owner every calendar's special days over the span", async () => {
    const { shop, second } = await aShopWithAWorker();
    for (const resourceId of [shop.resource.id, second.id]) {
      await test.services.business.putOverride(shop.owner.actor, shop.business.id, resourceId, {
        date: TUESDAY,
        note: null,
        ranges: [],
      });
    }
    // Outside the span, so the window is doing something.
    await test.services.business.putOverride(
      shop.owner.actor,
      shop.business.id,
      shop.resource.id,
      { date: "2026-12-25", note: null, ranges: [] },
    );

    const held = await test.services.business.listAllOverrides(
      shop.owner.actor,
      shop.business.id,
      TUESDAY,
      TUESDAY,
    );

    expect([...held].map((one) => one.resourceId).sort()).toEqual(
      [shop.resource.id, second.id].sort(),
    );
  });

  it("gives a worker only their own calendar's special days", async () => {
    const { shop, second, worker } = await aShopWithAWorker();
    for (const resourceId of [shop.resource.id, second.id]) {
      await test.services.business.putOverride(shop.owner.actor, shop.business.id, resourceId, {
        date: TUESDAY,
        note: null,
        ranges: [],
      });
    }

    const held = await test.services.business.listAllOverrides(
      worker.actor,
      shop.business.id,
      TUESDAY,
      TUESDAY,
    );

    // The one they were put on, and not the colleague's.
    expect(held.map((one) => one.resourceId)).toEqual([shop.resource.id]);
  });

  it("refuses the whole business's special days to somebody who does not work there", async () => {
    const { shop } = await aShopWithAWorker();
    const stranger = await signIn(test, "+972500000077", "זר");

    await expect(
      test.services.business.listAllOverrides(
        stranger.actor,
        shop.business.id,
        TUESDAY,
        TUESDAY,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  /**
   * What the businesses list carries.
   *
   * The owner app cannot draw anything without the calendars and cannot ask for
   * them until it knows which business it is in, so they travel with the list.
   * What travels has to be what `listResources` would have answered — an owner
   * all of them, a worker their own — or the screens fed from it show the wrong
   * calendars while believing they are narrowed.
   */
  it("carries the same calendars the resources endpoint would have given", async () => {
    const { shop, worker } = await aShopWithAWorker();

    const [mine] = await test.services.business.listMine(shop.owner.actor);
    // Against the counted list, because that is what the endpoint sends and what
    // the screen that removes a calendar reads: a list without the count reads
    // as "nobody booked" on exactly the screen that must not believe that.
    const asked = await test.services.business.listResourcesWithUpcoming(
      shop.owner.actor,
      shop.business.id,
    );

    expect(mine?.resources).toEqual(asked);
    expect(mine?.role).toBe("OWNER");
    expect(mine?.resourceIds).toBeNull();

    const [theirs] = await test.services.business.listMine(worker.actor);
    const theyAsked = await test.services.business.listResourcesWithUpcoming(
      worker.actor,
      shop.business.id,
    );
    // The worker's own, and the same list the endpoint narrows to.
    expect(theirs?.resources).toEqual(theyAsked);
    expect(theirs?.resources.map((one) => one.resource.id)).toEqual([shop.resource.id]);
    expect(theirs?.role).toBe("WORKER");
  });

  it("says a business nobody has is not there, whoever asks", async () => {
    const shop = await anEstablishedBusiness(test);
    const administrator: Actor = {
      kind: "ADMINISTRATOR",
      userId: shop.owner.user.id,
    };
    const nobody = "00000000-0000-4000-8000-999999999999" as never;

    await expect(
      test.services.calendar.businessDay(administrator, nobody, "2026-09-01"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // An owner of another business is refused rather than told it is missing:
    // whether it exists is not theirs to learn.
    await expect(
      test.services.calendar.businessDay(shop.owner.actor, nobody, "2026-09-01"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
