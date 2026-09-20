import { beforeEach, describe, expect, it } from "vitest";
import { harness, signIn, type Harness } from "../infrastructure/testing/harness.ts";
import { anEstablishedBusiness } from "../infrastructure/testing/scenarios.ts";
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
