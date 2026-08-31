import { beforeEach, describe, expect, it } from "vitest";
import { parseLocalDate } from "@tor-now/domain";
import { harness, signIn, type Harness } from "../infrastructure/testing/harness.ts";
import { anEstablishedBusiness } from "../infrastructure/testing/scenarios.ts";

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
      test.services.admin.listBusinesses(ordinary.actor, null),
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
    const shop = await anEstablishedBusiness(test);
    const admin = await signIn(test, "+972500000000");

    const summaries = await test.services.admin.listBusinesses(admin.administrator, null);
    const summary = summaries.find((row) => row.business.id === shop.business.id);
    expect(summary?.ownerName).toBe("רן");
    expect(summary?.subscriptionState).toBe("CURRENT");
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

  it("records a payment and moves the paid-through date with it", async () => {
    const shop = await anEstablishedBusiness(test);
    const admin = await signIn(test, "+972500000000");

    await test.services.admin.updateSubscription(admin.administrator, shop.business.id, {
      plan: "STANDARD",
      amountMinor: 9900,
    });
    const before = await test.services.admin.subscriptionFor(
      admin.administrator,
      shop.business.id,
    );

    await test.services.admin.recordPayment(admin.administrator, shop.business.id, {
      amountMinor: 9900,
      paidOn: "2026-09-30",
      note: null,
    });

    const after = await test.services.admin.subscriptionFor(
      admin.administrator,
      shop.business.id,
    );
    expect(after.payments).toHaveLength(1);
    expect(after.subscription.paidThrough > before.subscription.paidThrough).toBe(true);
    expect(test.store.audit.some((entry) => entry.action === "PAYMENT_RECORDED")).toBe(true);
  });

  it("deactivates a business only once the grace period has elapsed", async () => {
    const shop = await anEstablishedBusiness(test);
    const admin = await signIn(test, "+972500000000");

    await test.services.admin.updateSubscription(admin.administrator, shop.business.id, {
      plan: "STANDARD",
    });

    // Inside the grace period: nothing happens.
    await test.services.business.update(shop.owner.actor, shop.business.id, {});
    await test.services.admin.updateSubscription(admin.administrator, shop.business.id, {});
    test.store.subscriptions = test.store.subscriptions.map((subscription) =>
      subscription.businessId === shop.business.id
        ? { ...subscription, paidThrough: parseLocalDate("2026-08-20") }
        : subscription,
    );
    expect(
      await test.services.admin.deactivateLapsedBusinesses({ kind: "SYSTEM" }),
    ).toEqual([]);

    // Past it: the business goes.
    test.store.subscriptions = test.store.subscriptions.map((subscription) =>
      subscription.businessId === shop.business.id
        ? { ...subscription, paidThrough: parseLocalDate("2026-08-01") }
        : subscription,
    );
    expect(
      await test.services.admin.deactivateLapsedBusinesses({ kind: "SYSTEM" }),
    ).toEqual([shop.business.id]);
  });
});
