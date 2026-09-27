import { beforeEach, describe, expect, it } from "vitest";
import { addDays, asId, parseInstant, type NoticeKind } from "@tor-now/domain";
import { harness, signIn, type Harness } from "../infrastructure/testing/harness.ts";
import { isBillingNotice } from "../ports/notifier.ts";
import { anEstablishedBusiness } from "../infrastructure/testing/scenarios.ts";

/**
 * Notices (ADR 0020): what the owner is told about their Subscription, from
 * every act that tells them something, and what of it goes to WhatsApp — only
 * what is about paying.
 *
 * The harness opens every Business on 25 August 2026, so its Trial runs to
 * 23 September.
 */
describe("Notices", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  type Shop = Awaited<ReturnType<typeof anEstablishedBusiness>>;

  const kinds = (shop: Shop): NoticeKind[] =>
    test.store.notices
      .filter((entry) => entry.notice.businessId === shop.business.id)
      .map((entry) => entry.notice.facts.kind);

  const noticeOf = (shop: Shop, kind: NoticeKind) =>
    test.store.notices.find((entry) => entry.notice.businessId === shop.business.id && entry.notice.facts.kind === kind)
      ?.notice;

  const whatsapps = () => test.store.outbox.map((entry) => entry.message).filter(isBillingNotice);
  const whatsappKinds = () => whatsapps().map((message) => message.payload.facts.kind);

  const anAdministrator = () => signIn(test, "+972500000000");

  const dailyRun = async () => {
    await test.services.admin.applyDueMoves({ kind: "SYSTEM" });
    await test.services.admin.deactivateLapsedBusinesses({ kind: "SYSTEM" });
    return test.services.admin.announceDueNotices({ kind: "SYSTEM" });
  };

  const on = (date: string) => test.travelTo(parseInstant(`${date}T06:00:00.000Z`));

  const pay = async (shop: Shop, paidOn = "2026-08-25") =>
    test.services.admin.recordPayment((await anAdministrator()).administrator, shop.business.id, {
      amountMinor: 8900,
      paidOn,
      note: null,
    });

  describe("the Trial", () => {
    it("is announced when a Business opens, in the list and not on WhatsApp", async () => {
      const shop = await anEstablishedBusiness(test);

      expect(noticeOf(shop, "TRIAL_STARTED")?.facts).toEqual({
        kind: "TRIAL_STARTED",
        plan: "TEAM",
        trialEndsOn: "2026-09-23",
      });
      expect(whatsapps()).toEqual([]);
    });

    it("warns a week before it ends, once, on WhatsApp to the owner", async () => {
      const shop = await anEstablishedBusiness(test);

      on("2026-09-15");
      expect(await dailyRun()).toBe(0);
      on("2026-09-16");
      expect(await dailyRun()).toBe(1);
      on("2026-09-17");
      expect(await dailyRun()).toBe(0);

      expect(kinds(shop)).toEqual(["TRIAL_STARTED", "TRIAL_ENDING"]);
      // The start's banner gives way to the warning.
      expect(noticeOf(shop, "TRIAL_STARTED")?.clearedAt).not.toBeNull();
      expect(whatsapps()).toHaveLength(1);
      expect(whatsapps()[0]).toMatchObject({
        businessId: shop.business.id,
        recipientPhone: "+972500000001",
        payload: {
          businessName: "מספרת רן",
          facts: { kind: "TRIAL_ENDING", trialEndsOn: "2026-09-23" },
        },
      });
    });

    it("ends unpaid with the Business out of search, told on WhatsApp", async () => {
      const shop = await anEstablishedBusiness(test);
      on("2026-09-24");

      await dailyRun();

      expect(noticeOf(shop, "DEACTIVATED")?.facts).toEqual({ kind: "DEACTIVATED", on: "2026-09-24" });
      expect(whatsappKinds()).toEqual(["DEACTIVATED"]);
    });
  });

  describe("paying", () => {
    it("is acknowledged on WhatsApp, and ends every banner that asked for it", async () => {
      const shop = await anEstablishedBusiness(test);
      on("2026-09-16");
      await dailyRun();

      await pay(shop, "2026-09-16");

      expect(noticeOf(shop, "PAYMENT_RECORDED")?.facts).toEqual({ kind: "PAYMENT_RECORDED", paidThrough: "2026-10-23" });
      expect(noticeOf(shop, "TRIAL_ENDING")?.clearedAt).not.toBeNull();
      expect(whatsappKinds()).toEqual(["TRIAL_ENDING", "PAYMENT_RECORDED"]);
    });

    it("says when it is late, through the Grace Period, once", async () => {
      const shop = await anEstablishedBusiness(test);
      await pay(shop);
      const paidThrough = test.store.subscriptions.find((s) => s.businessId === shop.business.id)?.paidThrough;
      if (paidThrough === null || paidThrough === undefined) throw new Error("Not paid");

      on(addDays(paidThrough, 1));
      await dailyRun();
      on(addDays(paidThrough, 2));
      await dailyRun();

      expect(kinds(shop).filter((kind) => kind === "PAYMENT_LATE")).toHaveLength(1);
      expect(noticeOf(shop, "PAYMENT_LATE")?.facts).toEqual({
        kind: "PAYMENT_LATE",
        graceEndsOn: addDays(paidThrough, 14),
      });
      expect(whatsappKinds()).toContain("PAYMENT_LATE");
    });
  });

  describe("moving between Plans", () => {
    /** A Team shop with three calendars, paid, so a downgrade waits for the renewal. */
    const aPayingTeamOfThree = async () => {
      const shop = await anEstablishedBusiness(test);
      await test.services.business.createResource(shop.owner.actor, shop.business.id, "דנה");
      await test.services.business.createResource(shop.owner.actor, shop.business.id, "יוסי");
      await pay(shop);
      return shop;
    };

    it("tells an owner what their upgrade gave, and brings back what it has room for", async () => {
      const shop = await anEstablishedBusiness(test, { plan: "SOLO" });
      const admin = await anAdministrator();
      await test.services.business.changePlan(shop.owner.actor, shop.business.id, "TEAM", undefined);
      await test.services.business.createResource(shop.owner.actor, shop.business.id, "דנה");
      // Back to Solo by an administrator, keeping Ran: Dana pauses, and the owner hears of it.
      await test.services.admin.changePlan(admin.administrator, shop.business.id, "SOLO", [shop.resource.id]);
      expect(noticeOf(shop, "CALENDARS_PAUSED")?.facts).toEqual({
        kind: "CALENDARS_PAUSED",
        names: ["דנה"],
        resourceAllowance: 1,
      });

      await test.services.business.changePlan(shop.owner.actor, shop.business.id, "TEAM", undefined);

      const changes = test.store.notices
        .map((entry) => entry.notice.facts)
        .filter((facts) => facts.kind === "PLAN_CHANGED");
      expect(changes.at(-1)).toMatchObject({
        plan: "TEAM",
        by: "OWNER",
        priceMinor: 8900,
        resourceAllowance: 5,
        gained: ["CUSTOMER_HISTORY", "CUSTOMER_BLOCKING", "TEAM_ROLES"],
        lost: [],
      });
      expect(changes.map((facts) => facts.kind === "PLAN_CHANGED" && facts.by)).toEqual(["OWNER", "ADMINISTRATOR", "OWNER"]);
      expect(noticeOf(shop, "CALENDARS_RESUMED")?.facts).toEqual({ kind: "CALENDARS_RESUMED", names: ["דנה"] });
      // Coming back ends the banner that said they paused.
      expect(noticeOf(shop, "CALENDARS_PAUSED")?.clearedAt).not.toBeNull();
      expect(whatsapps()).toEqual([]);
    });

    it("schedules a downgrade, reminds a week ahead, and says what it did on the day", async () => {
      const shop = await aPayingTeamOfThree();
      const billing = await test.services.business.changePlan(shop.owner.actor, shop.business.id, "SOLO", [
        shop.resource.id,
      ]);
      const effectiveOn = billing.subscription.scheduledMove?.effectiveOn;
      if (effectiveOn === undefined) throw new Error("Not scheduled");
      expect(noticeOf(shop, "MOVE_SCHEDULED")?.facts).toEqual({
        kind: "MOVE_SCHEDULED",
        plan: "SOLO",
        by: "OWNER",
        effectiveOn,
        pausing: ["דנה", "יוסי"],
      });

      on(addDays(effectiveOn, -7));
      await dailyRun();
      expect(noticeOf(shop, "MOVE_SOON")?.facts).toEqual({
        kind: "MOVE_SOON",
        plan: "SOLO",
        effectiveOn,
        pausing: ["דנה", "יוסי"],
      });

      on(effectiveOn);
      await dailyRun();
      expect(noticeOf(shop, "MOVE_APPLIED")?.facts).toEqual({ kind: "MOVE_APPLIED", plan: "SOLO", paused: ["דנה", "יוסי"] });
      expect(noticeOf(shop, "MOVE_SOON")?.clearedAt).not.toBeNull();
      // News, all of it: nothing about a move goes to WhatsApp. What did go
      // was about paying — the payment, and the renewal now due.
      expect(whatsappKinds()).toEqual(["PAYMENT_RECORDED", "PAYMENT_LATE"]);
    });

    it("ends the reminder when the owner withdraws the move, and tells nothing new", async () => {
      const shop = await aPayingTeamOfThree();
      const billing = await test.services.business.changePlan(shop.owner.actor, shop.business.id, "SOLO", [
        shop.resource.id,
      ]);
      const effectiveOn = billing.subscription.scheduledMove?.effectiveOn;
      if (effectiveOn === undefined) throw new Error("Not scheduled");
      on(addDays(effectiveOn, -3));
      await dailyRun();
      const before = kinds(shop).length;

      await test.services.business.changePlan(shop.owner.actor, shop.business.id, "TEAM", undefined);

      expect(kinds(shop)).toHaveLength(before);
      expect(noticeOf(shop, "MOVE_SOON")?.clearedAt).not.toBeNull();
    });

    it("tells the owner which calendars an administrator paused", async () => {
      const shop = await aPayingTeamOfThree();
      const admin = await anAdministrator();
      await test.services.admin.changePlan(admin.administrator, shop.business.id, "SOLO");
      // Moved first; the calendars are settled after, with the owner.
      expect(noticeOf(shop, "CALENDARS_PAUSED")).toBeUndefined();

      await test.services.admin.keepCalendars(admin.administrator, shop.business.id, [shop.resource.id]);

      expect(noticeOf(shop, "CALENDARS_PAUSED")?.facts).toEqual({
        kind: "CALENDARS_PAUSED",
        names: ["דנה", "יוסי"],
        resourceAllowance: 5,
      });
    });
  });

  describe("the owner's board", () => {
    it("stands one banner, counts the rest, and lets the owner read and acknowledge", async () => {
      const shop = await anEstablishedBusiness(test);
      on("2026-09-16");
      await dailyRun();

      const board = await test.services.notices.board(shop.owner.actor, shop.business.id);
      expect(board.notices.map((notice) => notice.facts.kind)).toEqual(["TRIAL_ENDING", "TRIAL_STARTED"]);
      const ending = board.notices[0];
      expect(board.banner).toEqual({ noticeId: ending?.id, othersUnread: 1 });

      const read = await test.services.notices.markAllRead(shop.owner.actor, shop.business.id);
      expect(read.notices.every((notice) => notice.readAt !== null)).toBe(true);
      expect(read.banner).toEqual({ noticeId: ending?.id, othersUnread: 0 });

      const acknowledged = await test.services.notices.acknowledge(shop.owner.actor, shop.business.id, ending!.id);
      expect(acknowledged.banner).toBeNull();
      expect(acknowledged.notices).toHaveLength(2);
    });

    it("is the owner's alone", async () => {
      const shop = await anEstablishedBusiness(test);
      await test.services.business.inviteUser(shop.owner.actor, shop.business.id, {
        phone: "+972500000044",
        givenName: "מנהלת",
        role: "MANAGER",
        resourceIds: [],
      });
      const manager = await signIn(test, "+972500000044");

      await expect(test.services.notices.board(manager.actor, shop.business.id)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(test.services.notices.markAllRead(manager.actor, shop.business.id)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("refuses to acknowledge a Notice that is not the Business's", async () => {
      const shop = await anEstablishedBusiness(test);
      await expect(
        test.services.notices.acknowledge(shop.owner.actor, shop.business.id, asId("00000000-0000-4000-8000-000000000999")),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
