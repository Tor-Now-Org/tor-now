import { beforeEach, describe, expect, it } from "vitest";
import { harness, signIn, type Harness } from "../infrastructure/testing/harness.ts";
import {
  aMember,
  aPlan,
  aTwoCalendarShop,
  BUSINESS,
  calendar,
  THURSDAY,
  WEDNESDAY,
  type Shop,
} from "../infrastructure/testing/change-fixtures.ts";
import { TUESDAY, TUESDAY_AT } from "../infrastructure/testing/scenarios.ts";

/**
 * Who may change what, what is refused before anything is written, and how the
 * records already there read as changes. Permissions narrow the choices, never
 * the sheet: a worker keeps their own calendars with every outcome, and the
 * whole business is an owner's or a manager's.
 */

describe("who may change what", () => {
  let test: Harness;
  let shop: Shop;

  beforeEach(async () => {
    test = harness();
    shop = await aTwoCalendarShop(test);
  });

  it("lets a manager close the whole business", async () => {
    const manager = await aMember(test, shop, "MANAGER", []);
    await expect(
      test.services.changes.apply(manager.actor, shop.business.id, aPlan(BUSINESS, "OFF_ALL_DAY"), "KEEP", null),
    ).resolves.toMatchObject({ calendars: 2 });
  });

  it.each(["OFF_ALL_DAY", "OFF_PART", "OTHER_HOURS"] as const)(
    "lets a worker change their own calendar: %s",
    async (outcome) => {
      const worker = await aMember(test, shop, "WORKER", [shop.resource.id]);
      const ranges = outcome === "OFF_ALL_DAY" ? [] : [{ start: "10:00", end: "12:00" }];
      await expect(
        test.services.changes.apply(worker.actor, shop.business.id, aPlan(calendar(shop.resource.id), outcome, ranges), "KEEP", null),
      ).resolves.toMatchObject({ calendars: 1 });
    },
  );

  it.each(["OFF_ALL_DAY", "OFF_PART", "OTHER_HOURS"] as const)(
    "refuses a worker the whole business, even to preview: %s",
    async (outcome) => {
      const worker = await aMember(test, shop, "WORKER", [shop.resource.id, shop.second.id]);
      const ranges = outcome === "OFF_ALL_DAY" ? [] : [{ start: "10:00", end: "12:00" }];
      await expect(
        test.services.changes.apply(worker.actor, shop.business.id, aPlan(BUSINESS, outcome, ranges), "KEEP", null),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        test.services.changes.preview(worker.actor, shop.business.id, aPlan(BUSINESS, outcome, ranges), null),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(test.store.dateOverrides).toHaveLength(0);
      expect(test.store.blocks).toHaveLength(0);
    },
  );

  it("refuses a worker a calendar that is not theirs", async () => {
    const worker = await aMember(test, shop, "WORKER", [shop.resource.id]);
    await expect(
      test.services.changes.apply(worker.actor, shop.business.id, aPlan(calendar(shop.second.id), "OFF_ALL_DAY"), "KEEP", null),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("shows a worker the business's changes and their own, never another calendar's", async () => {
    await test.services.changes.apply(shop.owner.actor, shop.business.id, aPlan(BUSINESS, "OFF_ALL_DAY", [], { fromDate: WEDNESDAY }), "KEEP", null);
    await test.services.changes.apply(shop.owner.actor, shop.business.id, aPlan(calendar(shop.resource.id), "OFF_ALL_DAY"), "KEEP", null);
    await test.services.changes.apply(shop.owner.actor, shop.business.id, aPlan(calendar(shop.second.id), "OFF_ALL_DAY", [], { fromDate: THURSDAY }), "KEEP", null);
    const worker = await aMember(test, shop, "WORKER", [shop.resource.id]);
    const seen = await test.services.changes.list(worker.actor, shop.business.id, TUESDAY, THURSDAY);
    expect(seen.map((change) => [change.scope.kind, change.fromDate])).toEqual([
      ["CALENDAR", TUESDAY],
      ["BUSINESS", WEDNESDAY],
    ]);
    // An owner sees all three.
    expect(await test.services.changes.list(shop.owner.actor, shop.business.id, TUESDAY, THURSDAY)).toHaveLength(3);
  });

  it("lets a worker read the business's change, and neither edit nor remove it", async () => {
    await test.services.changes.apply(shop.owner.actor, shop.business.id, aPlan(BUSINESS, "OFF_ALL_DAY"), "KEEP", null);
    const [change] = await test.services.changes.list(shop.owner.actor, shop.business.id, TUESDAY, TUESDAY);
    const worker = await aMember(test, shop, "WORKER", [shop.resource.id]);
    await expect(test.services.changes.get(worker.actor, shop.business.id, change!.id)).resolves.toMatchObject({ scope: BUSINESS });
    await expect(test.services.changes.remove(worker.actor, shop.business.id, change!.id, null)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      test.services.changes.apply(worker.actor, shop.business.id, aPlan(calendar(shop.resource.id), "OFF_ALL_DAY"), "KEEP", change!.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await test.services.changes.list(shop.owner.actor, shop.business.id, TUESDAY, TUESDAY)).toEqual([change]);
  });

  it("does not let a worker find another calendar's change by its id", async () => {
    await test.services.changes.apply(shop.owner.actor, shop.business.id, aPlan(calendar(shop.second.id), "OFF_ALL_DAY"), "KEEP", null);
    const [change] = await test.services.changes.list(shop.owner.actor, shop.business.id, TUESDAY, TUESDAY);
    const worker = await aMember(test, shop, "WORKER", [shop.resource.id]);
    await expect(test.services.changes.get(worker.actor, shop.business.id, change!.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(test.services.changes.remove(worker.actor, shop.business.id, change!.id, null)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lets a worker edit and remove their own calendar's change", async () => {
    const worker = await aMember(test, shop, "WORKER", [shop.resource.id]);
    await test.services.changes.apply(worker.actor, shop.business.id, aPlan(calendar(shop.resource.id), "OFF_ALL_DAY"), "KEEP", null);
    const [change] = await test.services.changes.list(worker.actor, shop.business.id, TUESDAY, TUESDAY);
    await test.services.changes.apply(
      worker.actor, shop.business.id, aPlan(calendar(shop.resource.id), "OFF_PART", [{ start: "10:00", end: "11:00" }]), "KEEP", change!.id,
    );
    const [edited] = await test.services.changes.list(worker.actor, shop.business.id, TUESDAY, TUESDAY);
    expect(edited).toMatchObject({ outcome: "OFF_PART" });
    expect(await test.services.changes.remove(worker.actor, shop.business.id, edited!.id, null)).toBe(1);
  });

  it("refuses somebody who does not work there", async () => {
    const stranger = await signIn(test, "+972500009999", "זר");
    await expect(
      test.services.changes.apply(stranger.actor, shop.business.id, aPlan(calendar(shop.resource.id), "OFF_ALL_DAY"), "KEEP", null),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(test.services.changes.list(stranger.actor, shop.business.id, TUESDAY, TUESDAY)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("what is refused before anything is written", () => {
  let test: Harness;
  let shop: Shop;

  beforeEach(async () => {
    test = harness();
    shop = await aTwoCalendarShop(test);
  });

  const refused = async (plan: ReturnType<typeof aPlan>, code = "VALIDATION_FAILED") => {
    await expect(test.services.changes.apply(shop.owner.actor, shop.business.id, plan, "KEEP", null)).rejects.toMatchObject({ code });
    expect(test.store.dateOverrides).toHaveLength(0);
    expect(test.store.blocks).toHaveLength(0);
  };

  it("a change that ends before it starts", () =>
    refused(aPlan(BUSINESS, "OFF_ALL_DAY", [], { fromDate: WEDNESDAY, toDate: TUESDAY })));

  it("a day that has passed", () => refused(aPlan(BUSINESS, "OFF_ALL_DAY", [], { fromDate: "2026-08-24" })));

  it("more than a year at once", () =>
    refused(aPlan(BUSINESS, "OFF_ALL_DAY", [], { fromDate: TUESDAY, toDate: "2027-09-03" })));

  it("hours on a day off", () => refused(aPlan(BUSINESS, "OFF_ALL_DAY", [{ start: "10:00", end: "11:00" }])));

  it("part of the day with no hours", () => refused(aPlan(calendar(shop.resource.id), "OFF_PART")));

  it("other hours with no hours", () => refused(aPlan(BUSINESS, "OTHER_HOURS")));

  it("hours that end before they start, or as they start", async () => {
    await refused(aPlan(BUSINESS, "OTHER_HOURS", [{ start: "13:00", end: "12:00" }]));
    await refused(aPlan(BUSINESS, "OTHER_HOURS", [{ start: "12:00", end: "12:00" }]));
  });

  it("hours that overlap each other", () =>
    refused(aPlan(calendar(shop.resource.id), "OFF_PART", [{ start: "10:00", end: "12:00" }, { start: "11:00", end: "13:00" }])));

  it("a calendar that is not on offer, or not the business's", async () => {
    await test.services.business.updateResource(shop.owner.actor, shop.business.id, shop.second.id, { active: false });
    await refused(aPlan(calendar(shop.second.id), "OFF_ALL_DAY"), "NOT_FOUND");
    await refused(aPlan(calendar("00000000-0000-4000-8000-000000000000" as never), "OFF_ALL_DAY"), "NOT_FOUND");
  });

  it("closes only the calendars still on offer", async () => {
    await test.services.business.updateResource(shop.owner.actor, shop.business.id, shop.second.id, { active: false });
    await expect(
      test.services.changes.apply(shop.owner.actor, shop.business.id, aPlan(BUSINESS, "OFF_ALL_DAY"), "KEEP", null),
    ).resolves.toMatchObject({ calendars: 1 });
  });

  it("allows today, and other hours outside the usual day", async () => {
    await expect(
      test.services.changes.apply(
        shop.owner.actor, shop.business.id, aPlan(BUSINESS, "OTHER_HOURS", [{ start: "06:00", end: "22:00" }], { fromDate: "2026-08-25" }), "KEEP", null,
      ),
    ).resolves.toMatchObject({ days: 1 });
  });
});

describe("the records already there, read as changes", () => {
  let test: Harness;
  let shop: Shop;

  beforeEach(async () => {
    test = harness();
    shop = await aTwoCalendarShop(test);
  });

  const list = (from = TUESDAY, to = THURSDAY) => test.services.changes.list(shop.owner.actor, shop.business.id, from, to);

  it("reads a closure, a blockage and a special day made the old ways, with nothing moved", async () => {
    await test.services.closures.close(shop.owner.actor, shop.business.id, { fromDate: THURSDAY, toDate: THURSDAY, note: "חג", ranges: [] }, "KEEP");
    await test.services.calendar.createBlocks(
      shop.owner.actor, shop.business.id, shop.resource.id, [{ startAt: TUESDAY_AT("12:00"), endAt: TUESDAY_AT("13:00"), reason: "רופא" }], "KEEP",
    );
    await test.services.business.putOverride(shop.owner.actor, shop.business.id, shop.second.id, {
      date: WEDNESDAY, note: "קצר", ranges: [{ start: "09:00", end: "12:00" }],
    });
    expect((await list()).map((change) => [change.scope.kind, change.outcome, change.fromDate, change.note])).toEqual([
      ["CALENDAR", "OFF_PART", TUESDAY, "רופא"],
      ["CALENDAR", "OTHER_HOURS", WEDNESDAY, "קצר"],
      ["BUSINESS", "OFF_ALL_DAY", THURSDAY, "חג"],
    ]);
  });

  it("lists a change reaching past the dates asked for whole", async () => {
    await test.services.changes.apply(shop.owner.actor, shop.business.id, aPlan(BUSINESS, "OFF_ALL_DAY", [], { fromDate: TUESDAY, toDate: THURSDAY }), "KEEP", null);
    const [change] = await list(WEDNESDAY, WEDNESDAY);
    expect(change).toMatchObject({ fromDate: TUESDAY, toDate: THURSDAY });
    // And by the id that list gave, it is still found.
    await expect(test.services.changes.get(shop.owner.actor, shop.business.id, change!.id)).resolves.toEqual(change);
  });

  it("leaves out changes outside the dates asked for", async () => {
    await test.services.changes.apply(shop.owner.actor, shop.business.id, aPlan(BUSINESS, "OFF_ALL_DAY", [], { fromDate: THURSDAY }), "KEEP", null);
    expect(await list(TUESDAY, WEDNESDAY)).toEqual([]);
  });

  it("refuses dates that end before they start, or more than a year of them", async () => {
    await expect(list(WEDNESDAY, TUESDAY)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(list(TUESDAY, "2027-09-03")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("what a plan would do, asked before it is made", () => {
  let test: Harness;
  let shop: Shop;

  beforeEach(async () => {
    test = harness();
    shop = await aTwoCalendarShop(test);
  });

  it("says what the day usually keeps, for a calendar and for the business", async () => {
    await test.services.business.replaceWorkingHours(shop.owner.actor, shop.business.id, shop.second.id, [
      { dayOfWeek: 2, start: "12:00", end: "19:00" },
    ]);
    const forOne = await test.services.changes.preview(
      shop.owner.actor, shop.business.id, { ...aPlan(calendar(shop.resource.id), "OFF_ALL_DAY"), outcome: null }, null,
    );
    expect(forOne).toMatchObject({ days: 1, calendars: 1, appointments: [], replaces: [], usual: [{ start: 540, end: 1020 }] });
    const forAll = await test.services.changes.preview(
      shop.owner.actor, shop.business.id, { ...aPlan(BUSINESS, "OFF_ALL_DAY"), outcome: null }, null,
    );
    // The business is open from the first calendar's opening to the last one's closing.
    expect(forAll.usual).toEqual([{ start: 540, end: 1140 }]);
  });

  it("says nothing is usual on a day nobody works", async () => {
    const preview = await test.services.changes.preview(
      shop.owner.actor, shop.business.id, { ...aPlan(BUSINESS, "OFF_ALL_DAY", [], { fromDate: "2026-09-05" }), outcome: null }, null,
    );
    expect(preview.usual).toEqual([]);
  });

  it("counts the days and the calendars", async () => {
    const preview = await test.services.changes.preview(
      shop.owner.actor, shop.business.id, aPlan(BUSINESS, "OFF_ALL_DAY", [], { fromDate: TUESDAY, toDate: THURSDAY }), null,
    );
    expect(preview).toMatchObject({ days: 3, calendars: 2 });
  });
});
