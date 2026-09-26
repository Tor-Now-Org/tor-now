import { beforeEach, describe, expect, it } from "vitest";
import {
  addMinutesToInstant,
  parseInstant,
  planTerms,
  type Feature,
  type Plan,
} from "@tor-now/domain";
import { REMINDERS } from "../config.ts";
import { harness, signIn, type Harness } from "../infrastructure/testing/harness.ts";
import { anEstablishedBusiness, TUESDAY, TUESDAY_AT } from "../infrastructure/testing/scenarios.ts";

/**
 * ADR 0019 carried out: each Feature is checked where something new starts
 * with it, the Resource Allowance where a calendar is added or shown again —
 * and nothing that already exists is touched by losing either.
 */

/** Takes a Feature out of a Plan's current edition, as a Catalogue change would. */
const withoutFeature = (test: Harness, plan: Plan, feature: Feature) => {
  test.store.planVersions = test.store.planVersions.map((version) =>
    version.plan === plan
      ? {
          ...version,
          terms: planTerms({
            ...version.terms,
            features: version.terms.features.filter((held) => held !== feature),
          }),
        }
      : version,
  );
};

/** Ends every Preview, as the day after one runs out. */
const previewsOver = (test: Harness) => {
  test.store.previews = [];
};

describe("the Resource Allowance", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  it("refuses a second calendar on Solo, naming the allowance", async () => {
    const shop = await anEstablishedBusiness(test, { plan: "SOLO" });
    await expect(
      test.services.business.createResource(shop.owner.actor, shop.business.id, "דנה"),
    ).rejects.toMatchObject({ code: "NOT_ENTITLED", details: { resourceAllowance: 1 } });
  });

  it("lets Team add calendars up to five, and no further", async () => {
    const shop = await anEstablishedBusiness(test);
    for (const name of ["ב", "ג", "ד", "ה"]) {
      await test.services.business.createResource(shop.owner.actor, shop.business.id, name);
    }
    await expect(
      test.services.business.createResource(shop.owner.actor, shop.business.id, "ו"),
    ).rejects.toMatchObject({ code: "NOT_ENTITLED", details: { resourceAllowance: 5 } });
  });

  it("counts showing a hidden calendar again as adding one", async () => {
    const shop = await anEstablishedBusiness(test);
    const second = await test.services.business.createResource(shop.owner.actor, shop.business.id, "דנה");
    await test.services.business.updateResource(shop.owner.actor, shop.business.id, second.id, { active: false });
    await test.services.admin.changePlan((await signIn(test, "+972500000000")).administrator, shop.business.id, "SOLO");

    await expect(
      test.services.business.updateResource(shop.owner.actor, shop.business.id, second.id, { active: true }),
    ).rejects.toMatchObject({ code: "NOT_ENTITLED" });
    // Renaming it is not adding anything.
    await expect(
      test.services.business.updateResource(shop.owner.actor, shop.business.id, second.id, { name: "דנה כהן" }),
    ).resolves.toMatchObject({ name: "דנה כהן" });
  });
});

describe("pausing calendars over the Allowance", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  /** A Team shop with three calendars, moved to Solo during its Trial. */
  const overTheAllowance = async () => {
    const shop = await anEstablishedBusiness(test);
    const dana = await test.services.business.createResource(shop.owner.actor, shop.business.id, "דנה");
    const yossi = await test.services.business.createResource(shop.owner.actor, shop.business.id, "יוסי");
    const admin = await signIn(test, "+972500000000");
    await test.services.admin.changePlan(admin.administrator, shop.business.id, "SOLO");
    return { shop, dana, yossi, admin };
  };

  it("shows the administrator how far over it is, and what each calendar has booked", async () => {
    const { shop, admin } = await overTheAllowance();
    const view = await test.services.admin.calendarsOf(admin.administrator, shop.business.id);
    expect(view.resourceAllowance).toBe(1);
    expect(view.overBy).toBe(2);
    expect(view.calendars.map((calendar) => calendar.upcoming)).toEqual([0, 0, 0]);
  });

  it("keeps the calendar chosen and pauses the rest, each pause audited", async () => {
    const { shop, dana, yossi, admin } = await overTheAllowance();

    await test.services.admin.keepCalendars(admin.administrator, shop.business.id, [shop.resource.id]);

    const paused = test.store.resources.filter((resource) => resource.pausedAt !== null).map((r) => r.id);
    expect(paused.sort()).toEqual([dana.id, yossi.id].sort());
    expect(test.store.audit.filter((entry) => entry.action === "RESOURCE_PAUSED")).toHaveLength(2);
    expect((await test.services.admin.calendarsOf(admin.administrator, shop.business.id)).overBy).toBe(0);
  });

  it("takes a paused calendar out of what customers see and can book", async () => {
    const { shop, dana, admin } = await overTheAllowance();
    await test.services.admin.keepCalendars(admin.administrator, shop.business.id, [shop.resource.id]);
    const customer = await signIn(test, "+972500000002", "דנה");

    const profile = await test.services.discovery.profile(customer.actor, shop.business.id);
    expect(profile.resources.map((resource) => resource.id)).toEqual([shop.resource.id]);
    await expect(
      test.services.booking.book(customer.actor, {
        businessId: shop.business.id,
        serviceId: shop.service.id,
        resourceId: dana.id,
        startAt: TUESDAY_AT("09:00"),
        customerNote: null,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("keeps a paused calendar in front of its owner", async () => {
    const { shop, admin } = await overTheAllowance();
    await test.services.admin.keepCalendars(admin.administrator, shop.business.id, [shop.resource.id]);
    const mine = await test.services.business.listResources(shop.owner.actor, shop.business.id);
    expect(mine).toHaveLength(3);
  });

  it("refuses a choice the Allowance cannot hold, an empty one, or a calendar not on offer", async () => {
    const { shop, dana, admin } = await overTheAllowance();
    await expect(
      test.services.admin.keepCalendars(admin.administrator, shop.business.id, [shop.resource.id, dana.id]),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { resourceAllowance: 1 } });
    await expect(
      test.services.admin.keepCalendars(admin.administrator, shop.business.id, []),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await test.services.admin.keepCalendars(admin.administrator, shop.business.id, [shop.resource.id]);
    await expect(
      test.services.admin.keepCalendars(admin.administrator, shop.business.id, [dana.id]),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("lets the owner remove a paused calendar, but never the last one on offer", async () => {
    const { shop, dana, admin } = await overTheAllowance();
    await test.services.admin.keepCalendars(admin.administrator, shop.business.id, [shop.resource.id]);

    await test.services.business.deleteResource(shop.owner.actor, shop.business.id, dana.id);
    await expect(
      test.services.business.deleteResource(shop.owner.actor, shop.business.id, shop.resource.id),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("brings paused calendars back by themselves on an upgrade", async () => {
    const { shop, admin } = await overTheAllowance();
    await test.services.admin.keepCalendars(admin.administrator, shop.business.id, [shop.resource.id]);

    await test.services.admin.changePlan(admin.administrator, shop.business.id, "TEAM");

    expect(test.store.resources.every((resource) => resource.pausedAt === null)).toBe(true);
    expect(test.store.audit.filter((entry) => entry.action === "RESOURCE_RESUMED")).toHaveLength(2);
  });

  it("refuses pausing to anyone but an administrator", async () => {
    const { shop } = await overTheAllowance();
    await expect(
      test.services.admin.keepCalendars(shop.owner.actor, shop.business.id, [shop.resource.id]),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("the team", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  const invite = (shop: Awaited<ReturnType<typeof anEstablishedBusiness>>) =>
    test.services.business.inviteUser(shop.owner.actor, shop.business.id, {
      phone: "+972500000042",
      givenName: "יעל",
      role: "WORKER",
      resourceIds: [shop.resource.id],
    });

  it("refuses adding a worker on Solo", async () => {
    const shop = await anEstablishedBusiness(test, { plan: "SOLO" });
    await expect(invite(shop)).rejects.toMatchObject({ code: "NOT_ENTITLED", details: { feature: "TEAM_ROLES" } });
  });

  it("keeps whoever is already on the team when the plan stops including it", async () => {
    const shop = await anEstablishedBusiness(test);
    await invite(shop);
    withoutFeature(test, "TEAM", "TEAM_ROLES");

    const team = await test.services.business.listUsers(shop.owner.actor, shop.business.id);
    expect(team.some((member) => member.user.phone === "+972500000042")).toBe(true);
  });
});

describe("customer history and blocking", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  const aCustomerWithABooking = async (plan: Plan) => {
    const shop = await anEstablishedBusiness(test, { plan });
    const customer = await signIn(test, "+972500000002", "דנה");
    await test.services.booking.book(customer.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    });
    return { shop, customer };
  };

  it("opens the record on Solo with what is coming, and without the history", async () => {
    const { shop, customer } = await aCustomerWithABooking("SOLO");
    const record = await test.services.calendar.customerRecord(shop.owner.actor, shop.business.id, customer.user.id);
    expect(record.historyIncluded).toBe(false);
    expect(record.appointments).toHaveLength(1);
    expect(record.noShows).toBeNull();
    expect(record.lateCancellations).toBeNull();
  });

  it("gives the whole history on Team", async () => {
    const { shop, customer } = await aCustomerWithABooking("TEAM");
    const record = await test.services.calendar.customerRecord(shop.owner.actor, shop.business.id, customer.user.id);
    expect(record.historyIncluded).toBe(true);
    expect(record.noShows).toBe(0);
  });

  it("refuses blocking on Solo, but always lets a block be lifted", async () => {
    const { shop, customer } = await aCustomerWithABooking("TEAM");
    await test.services.calendar.setCustomerBlocked(shop.owner.actor, shop.business.id, customer.user.id, true);
    withoutFeature(test, "TEAM", "CUSTOMER_BLOCKING");

    await expect(
      test.services.calendar.setCustomerBlocked(shop.owner.actor, shop.business.id, customer.user.id, true),
    ).rejects.toMatchObject({ code: "NOT_ENTITLED", details: { feature: "CUSTOMER_BLOCKING" } });
    await expect(
      test.services.calendar.setCustomerBlocked(shop.owner.actor, shop.business.id, customer.user.id, false),
    ).resolves.toBeDefined();
  });
});

describe("the waiting list", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  const join = (shop: Awaited<ReturnType<typeof anEstablishedBusiness>>, actor: Awaited<ReturnType<typeof signIn>>["actor"]) =>
    test.services.waiting.join(actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceIds: [shop.resource.id],
      onDate: TUESDAY,
      parts: ["MORNING"],
    });

  it("is offered to customers while its Preview runs", async () => {
    const shop = await anEstablishedBusiness(test, { plan: "SOLO" });
    const customer = await signIn(test, "+972500000002", "דנה");
    expect((await test.services.discovery.profile(customer.actor, shop.business.id)).waitingList).toBe(true);
    await expect(join(shop, customer.actor)).resolves.toBeDefined();
  });

  it("is neither offered nor joinable once no plan it is on includes it", async () => {
    const shop = await anEstablishedBusiness(test, { plan: "SOLO" });
    previewsOver(test);
    const customer = await signIn(test, "+972500000002", "דנה");

    expect((await test.services.discovery.profile(customer.actor, shop.business.id)).waitingList).toBe(false);
    await expect(join(shop, customer.actor)).rejects.toMatchObject({
      code: "NOT_ENTITLED",
      details: { feature: "WAITING_LIST" },
    });
  });

  it("stops telling people already waiting, without removing what they asked", async () => {
    const shop = await anEstablishedBusiness(test, { plan: "SOLO" });
    const waiting = await signIn(test, "+972500000002", "דנה");
    await join(shop, waiting.actor);
    const other = await signIn(test, "+972500000003", "נוי");
    const booking = await test.services.booking.book(other.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    });
    previewsOver(test);
    await test.services.booking.cancel(other.actor, booking.id);

    const report = await test.services.waiting.publishOpenings();

    expect(report.told).toBe(0);
    expect(await test.services.waiting.mine(waiting.actor)).toHaveLength(1);
  });
});

describe("reminders", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  it("sends none for a Business whose plan no longer includes them, and does not owe them later", async () => {
    const shop = await anEstablishedBusiness(test);
    const customer = await signIn(test, "+972500000002", "דנה");
    await test.services.booking.book(customer.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    });
    withoutFeature(test, "TEAM", "REMINDERS");
    test.travelTo(addMinutesToInstant(parseInstant(TUESDAY_AT("09:00")), -REMINDERS.leadMinutes - 1));

    const first = await test.services.reminders.send();
    expect(first).toMatchObject({ considered: 1, enqueued: 0 });

    const second = await test.services.reminders.send();
    expect(second.considered).toBe(0);
  });
});

describe("what staff are told the plan allows", () => {
  it("comes with each Business they work at", async () => {
    const test = harness();
    const shop = await anEstablishedBusiness(test, { plan: "SOLO" });
    const [mine] = await test.services.business.listMine(shop.owner.actor);
    expect(mine?.entitlement.resourceAllowance).toBe(1);
    expect(mine?.entitlement.features).toContain("WAITING_LIST");
    expect(mine?.entitlement.features).not.toContain("CUSTOMER_HISTORY");
  });
});
