import { beforeEach, describe, expect, it } from "vitest";
import { displayName, parseInstant, parseLocalDate } from "@tor-now/domain";
import { harness, signIn, type Harness } from "../infrastructure/testing/harness.ts";
import { anEstablishedBusiness, TUESDAY_AT } from "../infrastructure/testing/scenarios.ts";

/**
 * ADR 0010's scope, and its edges. These run over the actor kind that bypasses
 * Row Level Security, so the checks below are the only thing standing between
 * a caller and every tenant's data — which is exactly why they are tested.
 */
describe("administrator scope", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  it("refuses every administrator action to an ordinary user", async () => {
    await anEstablishedBusiness(test);
    const ordinary = await signIn(test, "+972500000050");

    await expect(
      test.services.admin.listBusinesses(ordinary.actor),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      test.services.admin.listUsers(ordinary.actor, null),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      test.services.admin.auditLog(ordinary.actor),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      test.services.admin.readCustomerRecord(ordinary.actor, ordinary.user.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lists every business with its owner and subscription state", async () => {
    const shop = await anEstablishedBusiness(test, { plan: "SOLO" });
    const admin = await signIn(test, "+972500000000");

    const page = await test.services.admin.listBusinesses(admin.administrator);
    const summary = page.rows.find((row) => row.business.id === shop.business.id);
    expect(summary?.owner).toEqual({ name: "רן", phone: "+972500000001" });
    expect(summary?.standing).toEqual({ status: "TRIAL", nextDate: "2026-09-23", flags: [] });
    expect(summary?.planVersion.plan).toBe("SOLO");
    expect(page.total).toBe(1);
  });

  it("filters the directory on the server, over every Business, with a count per option", async () => {
    const shop = await anEstablishedBusiness(test);
    const admin = await signIn(test, "+972500000000");
    await test.services.admin.changePlan(admin.administrator, shop.business.id, "TEAM");
    const other = await signIn(test, "+972500000003", "נוי");
    await test.services.business.register(other.actor, {
      name: "סטודיו נוי",
      phone: "+972500000003",
      description: null,
      address: "רחוב הרצל 2",
      latitude: 32.0853,
      longitude: 34.7818,
      categories: ["barbershop"],
      resourceNames: ["נוי"],
      services: [{ name: "תספורת", durationMinutes: 30, priceMinor: 8000, bufferMinutes: null }],
      workingHours: [{ dayOfWeek: 2, start: "09:00", end: "17:00" }],
    });

    const teams = await test.services.admin.listBusinesses(admin.administrator, {
      query: null,
      statuses: ["TRIAL"],
      plan: "TEAM",
      edition: null,
      flags: [],
      feature: null,
      featureSource: "ANY",
    });
    expect(teams.rows.map((row) => row.business.name)).toEqual(["מספרת רן"]);
    expect(teams.counts.plans).toEqual({ SOLO: 1, TEAM: 1 });

    const byOwner = await test.services.admin.listBusinesses(admin.administrator, {
      query: "נוי",
      statuses: [],
      plan: null,
      edition: null,
      flags: [],
      feature: null,
      featureSource: "ANY",
    });
    expect(byOwner.rows.map((row) => row.business.name)).toEqual(["סטודיו נוי"]);

    const firstPage = await test.services.admin.listBusinesses(admin.administrator, undefined, {
      limit: 1,
      offset: 0,
    });
    expect(firstPage.rows).toHaveLength(1);
    expect(firstPage.total).toBe(2);
  });

  it("counts the statistics by the same five statuses the directory filters by", async () => {
    await anEstablishedBusiness(test, { plan: "SOLO" });
    const admin = await signIn(test, "+972500000000");
    const stats = await test.services.admin.platformStats(admin.administrator);
    expect(stats.statusCounts).toEqual({ TRIAL: 1, PAID: 0, IN_GRACE: 0, LAPSED: 0, DEACTIVATED: 0 });
  });

  it("deactivating removes a business from search and refuses new bookings", async () => {
    const shop = await anEstablishedBusiness(test);
    const admin = await signIn(test, "+972500000000");

    await test.services.admin.setBusinessActive(
      admin.administrator,
      shop.business.id,
      false,
    );

    expect(await test.services.discovery.search({ kind: "ANONYMOUS" }, "מספרת")).toEqual([]);
    expect(
      test.store.audit.some((entry) => entry.action === "BUSINESS_DEACTIVATED"),
    ).toBe(true);
  });

  it("audits an administrator merely reading a customer record", async () => {
    const shop = await anEstablishedBusiness(test);
    const admin = await signIn(test, "+972500000000");

    await test.services.admin.readCustomerRecord(admin.administrator, shop.owner.user.id);

    // ADR 0006: the read is the only oversight on this path, so it is logged.
    const read = test.store.audit.filter(
      (entry) => entry.action === "CUSTOMER_RECORD_READ",
    );
    expect(read).toHaveLength(1);
    expect(read[0]?.actorId).toBe(admin.user.id);
    expect(read[0]?.entityId).toBe(shop.owner.user.id);
  });

  it("records the reason when editing a business on its owner's behalf", async () => {
    const shop = await anEstablishedBusiness(test);
    const admin = await signIn(test, "+972500000000");

    await test.services.admin.updateBusiness(
      admin.administrator,
      shop.business.id,
      { phone: "+972500009999" },
      "הבעלים ביקש בטלפון",
    );

    const entry = test.store.audit.find(
      (candidate) =>
        candidate.action === "BUSINESS_UPDATED" &&
        (candidate.after as { reason?: string } | null)?.reason !== undefined,
    );
    expect(entry?.actorId).toBe(admin.user.id);
    expect((entry?.after as { reason: string }).reason).toBe("הבעלים ביקש בטלפון");
  });

  it("will not let an administrator revoke or deactivate themselves", async () => {
    const admin = await signIn(test, "+972500000000");
    await expect(
      test.services.admin.setAdministrator(admin.administrator, admin.user.id, false),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      test.services.admin.setUserActive(admin.administrator, admin.user.id, false),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("records a payment, keeping the rest of the Trial it was paid during", async () => {
    const shop = await anEstablishedBusiness(test, { plan: "SOLO" });
    const admin = await signIn(test, "+972500000000");
    const before = await test.services.admin.subscriptionFor(admin.administrator, shop.business.id);
    expect(before.subscription.paidThrough).toBeNull();
    expect(before.subscription.trialEndsOn).toBe("2026-09-23");

    await test.services.admin.recordPayment(admin.administrator, shop.business.id, {
      amountMinor: 4900,
      paidOn: "2026-09-10",
      note: null,
    });

    const after = await test.services.admin.subscriptionFor(admin.administrator, shop.business.id);
    expect(after.payments).toHaveLength(1);
    expect(after.subscription.paidThrough).toBe("2026-10-23");
    expect(after.state).toBe("CURRENT");
    expect(test.store.audit.some((entry) => entry.action === "PAYMENT_RECORDED")).toBe(true);
  });

  it("upgrades a Business at once, and audits who did it", async () => {
    const shop = await anEstablishedBusiness(test, { plan: "SOLO" });
    const admin = await signIn(test, "+972500000000");

    const view = await test.services.admin.changePlan(admin.administrator, shop.business.id, "TEAM");

    expect(view.planVersion.plan).toBe("TEAM");
    expect(view.subscription.scheduledMove).toBeNull();
    const entry = test.store.audit.find((candidate) => candidate.action === "SUBSCRIPTION_CHANGED");
    expect(entry?.actorId).toBe(admin.user.id);
  });

  it("downgrades a paying Business at its renewal, not before", async () => {
    const shop = await anEstablishedBusiness(test, { plan: "SOLO" });
    const admin = await signIn(test, "+972500000000");
    await test.services.admin.changePlan(admin.administrator, shop.business.id, "TEAM");
    await test.services.admin.recordPayment(admin.administrator, shop.business.id, {
      amountMinor: 8900,
      paidOn: "2026-09-10",
      note: null,
    });

    const view = await test.services.admin.changePlan(admin.administrator, shop.business.id, "SOLO");

    expect(view.planVersion.plan).toBe("TEAM");
    expect(view.scheduledVersion?.plan).toBe("SOLO");
    expect(view.subscription.scheduledMove?.effectiveOn).toBe("2026-10-24");
  });

  it("downgrades a Business in its Trial at once — nothing was paid to keep", async () => {
    const shop = await anEstablishedBusiness(test, { plan: "SOLO" });
    const admin = await signIn(test, "+972500000000");
    await test.services.admin.changePlan(admin.administrator, shop.business.id, "TEAM");

    const view = await test.services.admin.changePlan(admin.administrator, shop.business.id, "SOLO");

    expect(view.planVersion.plan).toBe("SOLO");
    expect(view.subscription.scheduledMove).toBeNull();
  });

  it("refuses a plan change to anyone but an administrator", async () => {
    const shop = await anEstablishedBusiness(test);
    await expect(
      test.services.admin.changePlan(shop.owner.actor, shop.business.id, "TEAM"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("counts only paid time as recurring revenue, never a Trial", async () => {
    const shop = await anEstablishedBusiness(test, { plan: "SOLO" });
    const admin = await signIn(test, "+972500000000");

    const trialling = await test.services.admin.platformStats(admin.administrator);
    expect(trialling.monthlyRecurringRevenueMinor).toBe(0);
    expect(trialling.planCounts).toEqual({ SOLO: 1, TEAM: 0 });

    await test.services.admin.recordPayment(admin.administrator, shop.business.id, {
      amountMinor: 4900,
      paidOn: "2026-08-25",
      note: null,
    });
    const paying = await test.services.admin.platformStats(admin.administrator);
    expect(paying.monthlyRecurringRevenueMinor).toBe(4900);
  });

  it("erases a person's details while keeping what refers to them", async () => {
    const shop = await anEstablishedBusiness(test);
    const admin = await signIn(test, "+972500000000");
    const customer = await signIn(test, "+972500000002", "דנה כהן");

    await test.services.booking.book(customer.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    });

    const erased = await test.services.admin.anonymiseUser(
      admin.administrator,
      customer.user.id,
      "בקשת מחיקה רשמית",
    );

    // ADR 0008: name, birth date and phone go; the row stays.
    expect(displayName(erased)).not.toBe("דנה כהן");
    expect(erased.phone).not.toBe("+972500000002");
    expect(erased.birthDate).toBeNull();
    expect(erased.anonymisedAt).not.toBeNull();

    // The appointment, and the business's count of it, are untouched.
    expect(test.store.appointments).toHaveLength(1);
    expect(test.store.appointments[0]?.customerId).toBe(customer.user.id);
  });

  it("releases the phone number so it can be used again", async () => {
    const admin = await signIn(test, "+972500000000");
    const person = await signIn(test, "+972500000002", "דנה");

    await test.services.admin.anonymiseUser(
      admin.administrator,
      person.user.id,
      "בקשת מחיקה",
    );

    // The other consequence ADR 0008 records: the number is no longer held.
    const again = await signIn(test, "+972500000002", "מישהו אחר");
    expect(again.user.id).not.toBe(person.user.id);
  });

  it("records that an erasure happened without recording what it erased", async () => {
    const admin = await signIn(test, "+972500000000");
    const person = await signIn(test, "+972500000002", "דנה כהן");

    await test.services.admin.anonymiseUser(
      admin.administrator,
      person.user.id,
      "בקשת מחיקה רשמית",
    );

    const entries = test.store.audit.filter(
      (entry) => entry.action === "USER_ANONYMISED",
    );
    expect(entries.length).toBeGreaterThan(0);
    // A trail that kept the erased values would defeat the erasure.
    const written = JSON.stringify(entries);
    expect(written).not.toContain("דנה כהן");
    expect(written).not.toContain("+972500000002");
    expect(written).toContain("בקשת מחיקה רשמית");
  });

  it("refuses an erasure with no reason, and refuses self-erasure", async () => {
    const admin = await signIn(test, "+972500000000");
    const person = await signIn(test, "+972500000002");

    await expect(
      test.services.admin.anonymiseUser(admin.administrator, person.user.id, "  "),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      test.services.admin.anonymiseUser(admin.administrator, admin.user.id, "למה לא"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("is not undone by restoring the account", async () => {
    const admin = await signIn(test, "+972500000000");
    const person = await signIn(test, "+972500000002", "דנה");

    await test.services.admin.anonymiseUser(admin.administrator, person.user.id, "בקשה");
    const restored = await test.services.admin.setUserActive(
      admin.administrator,
      person.user.id,
      true,
    );
    expect(restored.anonymisedAt).not.toBeNull();
    expect(displayName(restored)).not.toBe("דנה");
  });

  it("deactivates a paying business only once the grace period has elapsed", async () => {
    const shop = await anEstablishedBusiness(test);
    const paidThrough = (date: string) => {
      test.store.subscriptions = test.store.subscriptions.map((subscription) =>
        subscription.businessId === shop.business.id
          ? { ...subscription, trialEndsOn: null, paidThrough: parseLocalDate(date) }
          : subscription,
      );
    };

    // Inside the grace period: nothing happens.
    paidThrough("2026-08-20");
    expect(await test.services.admin.deactivateLapsedBusinesses({ kind: "SYSTEM" })).toEqual([]);

    // Past it: the business goes.
    paidThrough("2026-08-01");
    expect(await test.services.admin.deactivateLapsedBusinesses({ kind: "SYSTEM" })).toEqual([
      shop.business.id,
    ]);
  });

  it("deactivates an unpaid Trial the day after it ends, with no grace", async () => {
    const shop = await anEstablishedBusiness(test);

    test.travelTo(parseInstant("2026-09-23T20:00:00.000Z"));
    expect(await test.services.admin.deactivateLapsedBusinesses({ kind: "SYSTEM" })).toEqual([]);

    test.travelTo(parseInstant("2026-09-24T21:30:00.000Z"));
    expect(await test.services.admin.deactivateLapsedBusinesses({ kind: "SYSTEM" })).toEqual([
      shop.business.id,
    ]);
  });

  describe("a Payment after Deactivation", () => {
    const isActive = (businessId: string) =>
      test.store.businesses.find((business) => business.id === businessId)?.active;

    it("brings a lapsed Business back, as the banner promises", async () => {
      const shop = await anEstablishedBusiness(test);
      const admin = await signIn(test, "+972500000000");
      test.travelTo(parseInstant("2026-09-25T08:00:00.000Z"));
      await test.services.admin.deactivateLapsedBusinesses({ kind: "SYSTEM" });
      expect(isActive(shop.business.id)).toBe(false);

      await test.services.admin.recordPayment(admin.administrator, shop.business.id, {
        amountMinor: 4900,
        paidOn: "2026-09-25",
        note: null,
      });

      expect(isActive(shop.business.id)).toBe(true);
    });

    it("leaves off a Business an administrator switched off while it owed nothing", async () => {
      const shop = await anEstablishedBusiness(test);
      const admin = await signIn(test, "+972500000000");
      await test.services.admin.setBusinessActive(admin.administrator, shop.business.id, false);

      await test.services.admin.recordPayment(admin.administrator, shop.business.id, {
        amountMinor: 4900,
        paidOn: "2026-09-10",
        note: null,
      });

      expect(isActive(shop.business.id)).toBe(false);
    });

    it("leaves it off when the Payment, backdated, still does not cover today", async () => {
      const shop = await anEstablishedBusiness(test);
      const admin = await signIn(test, "+972500000000");
      test.travelTo(parseInstant("2026-12-20T08:00:00.000Z"));
      await test.services.admin.deactivateLapsedBusinesses({ kind: "SYSTEM" });

      await test.services.admin.recordPayment(admin.administrator, shop.business.id, {
        amountMinor: 4900,
        paidOn: "2026-10-01",
        note: null,
      });

      expect(isActive(shop.business.id)).toBe(false);
    });
  });
});
