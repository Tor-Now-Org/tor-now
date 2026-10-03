import { beforeEach, describe, expect, it } from "vitest";
import { parseInstant, planTerms } from "@tor-now/domain";
import { FROZEN_NOW, harness, signIn, type Harness } from "../infrastructure/testing/harness.ts";
import { anEstablishedBusiness, TUESDAY_AT } from "../infrastructure/testing/scenarios.ts";

/** Places Statistics in the Team plan, as an administrator would in the Catalogue. */
const teamHasStatistics = (test: Harness) => {
  test.store.planVersions = test.store.planVersions.map((version) =>
    version.plan === "TEAM"
      ? { ...version, terms: planTerms({ ...version.terms, features: [...version.terms.features, "STATISTICS"] }) }
      : version,
  );
};

/** The in-memory store dates a business by the wall clock; this one opened when the test's clock says. */
const openedOnTheTestsClock = (test: Harness) => {
  test.store.businesses = test.store.businesses.map((business) => ({ ...business, createdAt: FROZEN_NOW }));
};

describe("a month of statistics", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  it("is refused while the plan does not include it", async () => {
    const shop = await anEstablishedBusiness(test);
    await expect(
      test.services.statistics.month(shop.owner.actor, shop.business.id, "2026-08-01", null),
    ).rejects.toMatchObject({ code: "NOT_ENTITLED" });
  });

  it("is the owner's alone", async () => {
    teamHasStatistics(test);
    const shop = await anEstablishedBusiness(test);
    const manager = await signIn(test, "+972500000056", "מנהלת");
    await test.services.business.inviteUser(shop.owner.actor, shop.business.id, {
      phone: "+972500000056",
      givenName: "מנהלת",
      familyName: null,
      role: "MANAGER",
      resourceIds: [],
    });
    await expect(
      test.services.statistics.month(manager.actor, shop.business.id, "2026-08-01", null),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("is refused to a worker, even for their own calendar", async () => {
    teamHasStatistics(test);
    const shop = await anEstablishedBusiness(test);
    openedOnTheTestsClock(test);
    const worker = await signIn(test, "+972500000057", "עובד");
    await test.services.business.inviteUser(shop.owner.actor, shop.business.id, {
      phone: "+972500000057",
      givenName: "עובד",
      familyName: null,
      role: "WORKER",
      resourceIds: [shop.resource.id],
    });
    await expect(
      test.services.statistics.month(worker.actor, shop.business.id, "2026-08-01", shop.resource.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("narrows to one calendar, and then has no per-calendar rows", async () => {
    teamHasStatistics(test);
    const shop = await anEstablishedBusiness(test);
    openedOnTheTestsClock(test);
    const second = await test.services.business.createResource(shop.owner.actor, shop.business.id, "שקד");

    const whole = await test.services.statistics.month(shop.owner.actor, shop.business.id, "2026-08-01", null);
    expect(whole.calendars.map((calendar) => calendar.name)).toEqual(["רן", "שקד"]);

    const one = await test.services.statistics.month(shop.owner.actor, shop.business.id, "2026-08-01", second.id);
    expect(one.calendars).toEqual([]);
  });

  it("runs from the month the business opened to this one", async () => {
    teamHasStatistics(test);
    const shop = await anEstablishedBusiness(test);
    openedOnTheTestsClock(test);
    for (const month of ["2026-07-01", "2026-09-01"]) {
      await expect(
        test.services.statistics.month(shop.owner.actor, shop.business.id, month, null),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
  });

  it("counts a visit once it is over, and names the customer", async () => {
    teamHasStatistics(test);
    const shop = await anEstablishedBusiness(test);
    openedOnTheTestsClock(test);
    const customer = await signIn(test, "+972500000077", "דנה");
    await test.services.booking.book(customer.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    });

    // Eight in the morning in Jerusalem: September has begun, the visit has not.
    test.travelTo(parseInstant("2026-09-01T05:00:00.000Z"));
    const before = await test.services.statistics.month(shop.owner.actor, shop.business.id, "2026-09-01", null);
    expect(before.totals.completed).toBe(0);
    expect(before.days.find((day) => day.date === "2026-09-01")?.upcoming).toBe(1);

    test.travelTo(parseInstant("2026-09-02T09:00:00.000Z"));
    const after = await test.services.statistics.month(shop.owner.actor, shop.business.id, "2026-09-01", null);
    expect(after.totals).toMatchObject({ completed: 1, revenue: 8000, newCustomers: 1 });
    expect(after.firstMonth).toBe("2026-08-01");
    expect(after.customers.top).toHaveLength(1);
    expect(Object.values(after.customerNames)).toEqual(["דנה"]);
  });
});
