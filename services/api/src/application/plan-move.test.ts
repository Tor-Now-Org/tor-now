import { beforeEach, describe, expect, it } from "vitest";
import { parseInstant } from "@tor-now/domain";
import { harness, signIn, type Harness } from "../infrastructure/testing/harness.ts";
import { anEstablishedBusiness } from "../infrastructure/testing/scenarios.ts";

/**
 * The owner choosing a Plan (ADR 0020), and the daily job that carries out
 * what was scheduled: an upgrade at once, a downgrade at the renewal unless
 * nothing was paid for — and, moving to room for fewer calendars, the owner
 * saying which stay.
 */
describe("an owner changing plan", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  /** A Team shop with three calendars, in its Trial. */
  const aTeamWithThreeCalendars = async () => {
    const shop = await anEstablishedBusiness(test);
    const dana = await test.services.business.createResource(shop.owner.actor, shop.business.id, "דנה");
    const yossi = await test.services.business.createResource(shop.owner.actor, shop.business.id, "יוסי");
    return { shop, dana, yossi };
  };

  const paid = async (shop: Awaited<ReturnType<typeof anEstablishedBusiness>>) => {
    const admin = await signIn(test, "+972500000000");
    await test.services.admin.recordPayment(admin.administrator, shop.business.id, {
      amountMinor: 8900,
      paidOn: "2026-08-25",
      note: null,
    });
  };

  it("upgrades at once, and the log says the owner did it", async () => {
    const shop = await anEstablishedBusiness(test, { plan: "SOLO" });

    const billing = await test.services.business.changePlan(shop.owner.actor, shop.business.id, "TEAM", undefined);

    expect(billing.planVersion.plan).toBe("TEAM");
    const entry = test.store.audit.find((candidate) => candidate.action === "SUBSCRIPTION_CHANGED");
    expect(entry?.actorId).toBe(shop.owner.user.id);
  });

  it("asks which calendars stay before moving to room for fewer", async () => {
    const { shop } = await aTeamWithThreeCalendars();
    await expect(
      test.services.business.changePlan(shop.owner.actor, shop.business.id, "SOLO", undefined),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { resourceAllowance: 1 } });
  });

  it("moves at once in a Trial, pausing every calendar not kept", async () => {
    const { shop, dana, yossi } = await aTeamWithThreeCalendars();

    const billing = await test.services.business.changePlan(shop.owner.actor, shop.business.id, "SOLO", [
      shop.resource.id,
    ]);

    expect(billing.planVersion.plan).toBe("SOLO");
    const paused = test.store.resources.filter((resource) => resource.pausedAt !== null).map((resource) => resource.id);
    expect(paused.sort()).toEqual([dana.id, yossi.id].sort());
  });

  it("schedules a paying owner's downgrade for the renewal, and marks the calendars to pause then", async () => {
    const { shop, dana, yossi } = await aTeamWithThreeCalendars();
    await paid(shop);

    const billing = await test.services.business.changePlan(shop.owner.actor, shop.business.id, "SOLO", [
      shop.resource.id,
    ]);

    expect(billing.planVersion.plan).toBe("TEAM");
    const on = billing.subscription.scheduledMove?.effectiveOn;
    expect(on).toBeDefined();
    const marked = test.store.resources.filter((resource) => resource.pauseOn === on).map((resource) => resource.id);
    expect(marked.sort()).toEqual([dana.id, yossi.id].sort());
    // Nothing pauses before the day.
    expect(test.store.resources.every((resource) => resource.pausedAt === null)).toBe(true);
  });

  it("carries the move out on its day, pausing what was marked", async () => {
    const { shop, dana } = await aTeamWithThreeCalendars();
    await paid(shop);
    const billing = await test.services.business.changePlan(shop.owner.actor, shop.business.id, "SOLO", [
      shop.resource.id,
    ]);
    const on = billing.subscription.scheduledMove?.effectiveOn ?? "";

    test.travelTo(parseInstant(`${on}T06:00:00.000Z`));
    const report = await test.services.admin.applyDueMoves({ kind: "SYSTEM" });

    expect(report.moved).toEqual([shop.business.id]);
    const after = await test.services.business.subscription(shop.owner.actor, shop.business.id);
    expect(after.planVersion.plan).toBe("SOLO");
    expect(after.subscription.scheduledMove).toBeNull();
    const danaNow = test.store.resources.find((resource) => resource.id === dana.id);
    expect(danaNow?.pausedAt).not.toBeNull();
    expect(danaNow?.pauseOn).toBeNull();
  });

  it("withdraws a scheduled move when the owner chooses their plan again, and unmarks the calendars", async () => {
    const { shop } = await aTeamWithThreeCalendars();
    await paid(shop);
    await test.services.business.changePlan(shop.owner.actor, shop.business.id, "SOLO", [shop.resource.id]);

    const billing = await test.services.business.changePlan(shop.owner.actor, shop.business.id, "TEAM", undefined);

    expect(billing.subscription.scheduledMove).toBeNull();
    expect(test.store.resources.every((resource) => resource.pauseOn === null)).toBe(true);
  });

  it("leaves the plan to the owner: a manager is refused", async () => {
    const shop = await anEstablishedBusiness(test);
    await test.services.business.inviteUser(shop.owner.actor, shop.business.id, {
      phone: "+972500000044",
      givenName: "מנהלת",
      role: "MANAGER",
      resourceIds: [],
    });
    const manager = await signIn(test, "+972500000044");
    await expect(
      test.services.business.changePlan(manager.actor, shop.business.id, "SOLO", [shop.resource.id]),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets an administrator move a Business over its allowance and settle the calendars after", async () => {
    const { shop } = await aTeamWithThreeCalendars();
    const admin = await signIn(test, "+972500000000");
    const view = await test.services.admin.changePlan(admin.administrator, shop.business.id, "SOLO");
    expect(view.planVersion.plan).toBe("SOLO");
    expect(view.standing.flags).toContain("OVER_ALLOWANCE");
  });
});
