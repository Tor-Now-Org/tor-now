import { beforeEach, describe, expect, it } from "vitest";
import { harness, type Harness } from "../infrastructure/testing/harness.ts";
import {
  aBooking,
  aPlan,
  aTwoCalendarShop,
  A_WHOLE_DAY,
  BUSINESS,
  calendar,
  offered,
  THURSDAY,
  WEDNESDAY,
  type Shop,
} from "../infrastructure/testing/change-fixtures.ts";
import { TUESDAY, TUESDAY_AT } from "../infrastructure/testing/scenarios.ts";

/**
 * "שינוי ביומן": each outcome for each scope, checked by what a customer is
 * offered afterwards and by what the list then says — not by which record
 * happened to be written.
 */

describe("a change, for each outcome and each scope", () => {
  let test: Harness;
  let shop: Shop;

  beforeEach(async () => {
    test = harness();
    shop = await aTwoCalendarShop(test);
  });

  const list = () => test.services.changes.list(shop.owner.actor, shop.business.id, TUESDAY, THURSDAY);

  it("starts from a day nobody changed", async () => {
    expect(await offered(test, shop, shop.resource.id)).toEqual(A_WHOLE_DAY);
    expect(await list()).toEqual([]);
  });

  it("one calendar not working all day: that calendar offers nothing, the other everything", async () => {
    const result = await test.services.changes.apply(
      shop.owner.actor, shop.business.id, aPlan(calendar(shop.resource.id), "OFF_ALL_DAY", [], { note: "חופשה" }), "KEEP", null,
    );
    expect(result).toEqual({ days: 1, calendars: 1, cancelled: 0 });
    expect(await offered(test, shop, shop.resource.id)).toEqual([]);
    expect(await offered(test, shop, shop.second.id)).toEqual(A_WHOLE_DAY);
    expect(await list()).toMatchObject([
      { scope: calendar(shop.resource.id), outcome: "OFF_ALL_DAY", fromDate: TUESDAY, toDate: TUESDAY, note: "חופשה" },
    ]);
  });

  it("one calendar not working part of the day: only those hours go", async () => {
    await test.services.changes.apply(
      shop.owner.actor, shop.business.id, aPlan(calendar(shop.resource.id), "OFF_PART", [{ start: "12:00", end: "13:00" }]), "KEEP", null,
    );
    const left = await offered(test, shop, shop.resource.id);
    expect(left).not.toContain("12:00");
    expect(left).not.toContain("12:30");
    expect(left).toContain("11:30");
    expect(left).toContain("13:00");
    expect(await offered(test, shop, shop.second.id)).toEqual(A_WHOLE_DAY);
    expect(await list()).toMatchObject([
      { outcome: "OFF_PART", scope: calendar(shop.resource.id), ranges: [{ start: 720, end: 780 }] },
    ]);
  });

  it("one calendar working other hours: the day is those hours", async () => {
    await test.services.changes.apply(
      shop.owner.actor, shop.business.id, aPlan(calendar(shop.resource.id), "OTHER_HOURS", [{ start: "09:00", end: "12:00" }]), "KEEP", null,
    );
    expect(await offered(test, shop, shop.resource.id)).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"]);
    expect(await offered(test, shop, shop.second.id)).toEqual(A_WHOLE_DAY);
    expect(await list()).toMatchObject([{ outcome: "OTHER_HOURS", scope: calendar(shop.resource.id) }]);
  });

  it("the whole business not working all day: every calendar offers nothing", async () => {
    const result = await test.services.changes.apply(
      shop.owner.actor, shop.business.id, aPlan(BUSINESS, "OFF_ALL_DAY", [], { note: "יום כיפור" }), "KEEP", null,
    );
    expect(result).toEqual({ days: 1, calendars: 2, cancelled: 0 });
    expect(await offered(test, shop, shop.resource.id)).toEqual([]);
    expect(await offered(test, shop, shop.second.id)).toEqual([]);
    expect(await list()).toMatchObject([
      { id: `closure:${TUESDAY}:${TUESDAY}`, scope: BUSINESS, outcome: "OFF_ALL_DAY", note: "יום כיפור" },
    ]);
  });

  it("the whole business not working part of the day: every calendar loses those hours, as one change", async () => {
    await test.services.changes.apply(
      shop.owner.actor, shop.business.id, aPlan(BUSINESS, "OFF_PART", [{ start: "13:00", end: "14:00" }], { note: "ישיבת צוות" }), "KEEP", null,
    );
    for (const resourceId of [shop.resource.id, shop.second.id]) {
      const left = await offered(test, shop, resourceId);
      expect(left).not.toContain("13:00");
      expect(left).not.toContain("13:30");
      expect(left).toContain("14:00");
    }
    const changes = await list();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ scope: BUSINESS, outcome: "OFF_PART", note: "ישיבת צוות" });
  });

  it("the whole business working other hours: every calendar keeps those hours", async () => {
    await test.services.changes.apply(
      shop.owner.actor, shop.business.id, aPlan(BUSINESS, "OTHER_HOURS", [{ start: "10:00", end: "11:00" }]), "KEEP", null,
    );
    expect(await offered(test, shop, shop.resource.id)).toEqual(["10:00", "10:30"]);
    expect(await offered(test, shop, shop.second.id)).toEqual(["10:00", "10:30"]);
    expect(await list()).toMatchObject([{ scope: BUSINESS, outcome: "OTHER_HOURS" }]);
  });

  it("covers every day it was made for, and only those", async () => {
    await test.services.changes.apply(
      shop.owner.actor, shop.business.id, aPlan(calendar(shop.resource.id), "OFF_ALL_DAY", [], { fromDate: TUESDAY, toDate: WEDNESDAY }), "KEEP", null,
    );
    expect(await offered(test, shop, shop.resource.id, TUESDAY)).toEqual([]);
    expect(await offered(test, shop, shop.resource.id, WEDNESDAY)).toEqual([]);
    expect(await offered(test, shop, shop.resource.id, THURSDAY)).toEqual(A_WHOLE_DAY);
    expect(await list()).toMatchObject([{ fromDate: TUESDAY, toDate: WEDNESDAY, days: [{ date: TUESDAY }, { date: WEDNESDAY }] }]);
  });

  it("keeps several stretches of one day apart", async () => {
    await test.services.changes.apply(
      shop.owner.actor, shop.business.id,
      aPlan(calendar(shop.resource.id), "OFF_PART", [{ start: "14:00", end: "15:00" }, { start: "10:00", end: "11:00" }]),
      "KEEP", null,
    );
    const left = await offered(test, shop, shop.resource.id);
    expect(left).not.toContain("10:00");
    expect(left).not.toContain("14:30");
    expect(left).toContain("12:00");
    expect((await list())[0]?.ranges).toEqual([{ start: 600, end: 660 }, { start: 840, end: 900 }]);
  });
});

describe("the people already booked", () => {
  let test: Harness;
  let shop: Shop;

  beforeEach(async () => {
    test = harness();
    shop = await aTwoCalendarShop(test);
  });

  const preview = (plan: ReturnType<typeof aPlan>, replacing: string | null = null) =>
    test.services.changes.preview(shop.owner.actor, shop.business.id, plan, replacing);

  it("names whoever a day off would strand, on that calendar only", async () => {
    const mine = await aBooking(test, shop, shop.resource.id, "10:00", "דנה כהן");
    await aBooking(test, shop, shop.second.id, "10:00", "רון לוי");
    const impact = await preview(aPlan(calendar(shop.resource.id), "OFF_ALL_DAY"));
    expect(impact.appointments.map((one) => one.id)).toEqual([mine.id]);
    expect(impact.appointments[0]).toMatchObject({ customerName: "דנה כהן", serviceName: shop.service.name });
  });

  it("names only the ones inside the hours taken off, an overlap included", async () => {
    const inside = await aBooking(test, shop, shop.resource.id, "13:30");
    // 12:30–13:00 runs into a change from 12:45.
    const runsInto = await aBooking(test, shop, shop.resource.id, "12:30");
    await aBooking(test, shop, shop.resource.id, "09:00");
    const impact = await preview(aPlan(calendar(shop.resource.id), "OFF_PART", [{ start: "12:45", end: "15:00" }]));
    expect(impact.appointments.map((one) => one.id).sort()).toEqual([inside.id, runsInto.id].sort());
  });

  it("names only the ones the other hours no longer hold", async () => {
    const early = await aBooking(test, shop, shop.resource.id, "09:00");
    await aBooking(test, shop, shop.resource.id, "11:00");
    const impact = await preview(aPlan(calendar(shop.resource.id), "OTHER_HOURS", [{ start: "10:00", end: "17:00" }]));
    expect(impact.appointments.map((one) => one.id)).toEqual([early.id]);
  });

  it("names everybody across the business when it closes", async () => {
    await aBooking(test, shop, shop.resource.id, "10:00");
    await aBooking(test, shop, shop.second.id, "11:00");
    const impact = await preview(aPlan(BUSINESS, "OFF_ALL_DAY"));
    expect(impact.appointments).toHaveLength(2);
    expect(impact.calendars).toBe(2);
  });

  it("calls them off and tells each of them when asked to", async () => {
    const one = await aBooking(test, shop, shop.resource.id, "10:00");
    const two = await aBooking(test, shop, shop.second.id, "10:30");
    const result = await test.services.changes.apply(shop.owner.actor, shop.business.id, aPlan(BUSINESS, "OFF_ALL_DAY"), "CANCEL", null);
    expect(result.cancelled).toBe(2);
    const stored = test.store.appointments.filter((appointment) => [one.id, two.id].includes(appointment.id));
    expect(stored.every((appointment) => appointment.status === "CANCELLED" && appointment.cancelledBy === "BUSINESS")).toBe(true);
    expect(test.store.outbox.filter((entry) => entry.message.template === "BOOKING_CANCELLED")).toHaveLength(2);
  });

  it("leaves them standing when the owner will call them", async () => {
    const one = await aBooking(test, shop, shop.resource.id, "13:00");
    const result = await test.services.changes.apply(
      shop.owner.actor, shop.business.id, aPlan(calendar(shop.resource.id), "OFF_PART", [{ start: "13:00", end: "14:00" }]), "KEEP", null,
    );
    expect(result.cancelled).toBe(0);
    expect(test.store.appointments.find((appointment) => appointment.id === one.id)?.status).toBe("CONFIRMED");
    expect(test.store.outbox.filter((entry) => entry.message.template === "BOOKING_CANCELLED")).toHaveLength(0);
  });

  it("does not count what was cancelled already", async () => {
    const one = await aBooking(test, shop, shop.resource.id, "10:00");
    test.store.appointments = test.store.appointments.map((appointment) =>
      appointment.id === one.id ? { ...appointment, status: "CANCELLED" } : appointment,
    );
    expect((await preview(aPlan(calendar(shop.resource.id), "OFF_ALL_DAY"))).appointments).toEqual([]);
  });
});

describe("over an earlier change", () => {
  let test: Harness;
  let shop: Shop;

  beforeEach(async () => {
    test = harness();
    shop = await aTwoCalendarShop(test);
  });

  const apply = (plan: ReturnType<typeof aPlan>, replacing: string | null = null) =>
    test.services.changes.apply(shop.owner.actor, shop.business.id, plan, "KEEP", replacing);
  const preview = (plan: ReturnType<typeof aPlan>, replacing: string | null = null) =>
    test.services.changes.preview(shop.owner.actor, shop.business.id, plan, replacing);
  const list = () => test.services.changes.list(shop.owner.actor, shop.business.id, TUESDAY, THURSDAY);

  it("says which other hours it replaces, and replaces them", async () => {
    await apply(aPlan(BUSINESS, "OTHER_HOURS", [{ start: "09:00", end: "14:00" }], { note: "ערב חג" }));
    const plan = aPlan(BUSINESS, "OTHER_HOURS", [{ start: "09:00", end: "13:00" }], { note: "ערב חג" });
    expect((await preview(plan)).replaces).toMatchObject([{ outcome: "OTHER_HOURS", note: "ערב חג", ranges: [{ start: 540, end: 840 }] }]);
    await apply(plan);
    expect(await list()).toMatchObject([{ outcome: "OTHER_HOURS", ranges: [{ start: 540, end: 780 }] }]);
    expect(await offered(test, shop, shop.resource.id)).not.toContain("13:00");
  });

  it("says a calendar's own hours would break into the business's day", async () => {
    await apply(aPlan(BUSINESS, "OFF_ALL_DAY", [], { note: "חג" }));
    expect((await preview(aPlan(calendar(shop.resource.id), "OTHER_HOURS", [{ start: "10:00", end: "12:00" }]))).replaces)
      .toMatchObject([{ scope: BUSINESS, note: "חג" }]);
  });

  it("names nothing when the new change only takes some hours off", async () => {
    await apply(aPlan(BUSINESS, "OTHER_HOURS", [{ start: "09:00", end: "14:00" }]));
    expect((await preview(aPlan(BUSINESS, "OFF_PART", [{ start: "10:00", end: "11:00" }]))).replaces).toEqual([]);
    expect((await preview(aPlan(calendar(shop.resource.id), "OFF_PART", [{ start: "10:00", end: "11:00" }]))).replaces).toEqual([]);
  });

  it("says a calendar's day off replaces the other hours it was given", async () => {
    await apply(aPlan(calendar(shop.resource.id), "OTHER_HOURS", [{ start: "09:00", end: "14:00" }], { note: "קצר" }));
    expect((await preview(aPlan(calendar(shop.resource.id), "OFF_ALL_DAY"))).replaces).toMatchObject([{ note: "קצר" }]);
    await apply(aPlan(calendar(shop.resource.id), "OFF_ALL_DAY"));
    expect(await list()).toMatchObject([{ outcome: "OFF_ALL_DAY", scope: calendar(shop.resource.id) }]);
    expect(await offered(test, shop, shop.resource.id)).toEqual([]);
  });

  it("names nothing on another calendar's days", async () => {
    await apply(aPlan(calendar(shop.second.id), "OTHER_HOURS", [{ start: "09:00", end: "12:00" }]));
    expect((await preview(aPlan(calendar(shop.resource.id), "OTHER_HOURS", [{ start: "10:00", end: "12:00" }]))).replaces).toEqual([]);
  });

  it("does not name the change being edited", async () => {
    await apply(aPlan(calendar(shop.resource.id), "OTHER_HOURS", [{ start: "09:00", end: "12:00" }]));
    const [old] = await list();
    expect((await preview(aPlan(calendar(shop.resource.id), "OTHER_HOURS", [{ start: "10:00", end: "12:00" }]), old!.id)).replaces).toEqual([]);
  });
});

describe("editing a change", () => {
  let test: Harness;
  let shop: Shop;

  beforeEach(async () => {
    test = harness();
    shop = await aTwoCalendarShop(test);
  });

  const list = () => test.services.changes.list(shop.owner.actor, shop.business.id, TUESDAY, THURSDAY);

  it("switches its outcome and its scope in one replacement", async () => {
    await test.services.changes.apply(
      shop.owner.actor, shop.business.id, aPlan(calendar(shop.resource.id), "OFF_PART", [{ start: "12:00", end: "13:00" }]), "KEEP", null,
    );
    const [old] = await list();
    await test.services.changes.apply(
      shop.owner.actor, shop.business.id, aPlan(BUSINESS, "OTHER_HOURS", [{ start: "09:00", end: "11:00" }], { note: "ערב חג" }), "KEEP", old!.id,
    );
    expect(await list()).toMatchObject([{ scope: BUSINESS, outcome: "OTHER_HOURS", note: "ערב חג" }]);
    expect(await list()).toHaveLength(1);
    expect(test.store.blocks).toHaveLength(0);
    // The hours the old change took are back where the new one keeps them.
    expect(await offered(test, shop, shop.resource.id)).toEqual(["09:00", "09:30", "10:00", "10:30"]);
  });

  it("changes its days", async () => {
    await test.services.changes.apply(shop.owner.actor, shop.business.id, aPlan(BUSINESS, "OFF_ALL_DAY"), "KEEP", null);
    const [old] = await list();
    await test.services.changes.apply(
      shop.owner.actor, shop.business.id, aPlan(BUSINESS, "OFF_ALL_DAY", [], { fromDate: WEDNESDAY, toDate: THURSDAY }), "KEEP", old!.id,
    );
    expect(await list()).toMatchObject([{ fromDate: WEDNESDAY, toDate: THURSDAY }]);
    expect(await offered(test, shop, shop.resource.id, TUESDAY)).toEqual(A_WHOLE_DAY);
  });

  it("leaves the old change as it was when the new one is refused", async () => {
    await test.services.changes.apply(shop.owner.actor, shop.business.id, aPlan(calendar(shop.resource.id), "OFF_ALL_DAY"), "KEEP", null);
    const before = await list();
    await expect(
      test.services.changes.apply(
        shop.owner.actor, shop.business.id, aPlan(calendar(shop.resource.id), "OTHER_HOURS", [{ start: "12:00", end: "10:00" }]), "KEEP", before[0]!.id,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await list()).toEqual(before);
  });

  it("keeps the days of it that have already been lived", async () => {
    await test.services.changes.apply(
      shop.owner.actor, shop.business.id, aPlan(calendar(shop.resource.id), "OTHER_HOURS", [{ start: "09:00", end: "12:00" }], { fromDate: TUESDAY, toDate: THURSDAY }), "KEEP", null,
    );
    const [old] = await list();
    // Wednesday morning: Tuesday is behind us.
    test.travelTo(Date.parse(`${WEDNESDAY}T07:00:00.000Z`) as never);
    await test.services.changes.apply(
      shop.owner.actor, shop.business.id, aPlan(calendar(shop.resource.id), "OTHER_HOURS", [{ start: "10:00", end: "12:00" }], { fromDate: WEDNESDAY, toDate: THURSDAY }), "KEEP", old!.id,
    );
    const after = await list();
    expect(after.map((change) => [change.fromDate, change.toDate, change.ranges])).toEqual([
      [TUESDAY, TUESDAY, [{ start: 540, end: 720 }]],
      [WEDNESDAY, THURSDAY, [{ start: 600, end: 720 }]],
    ]);
  });

  it("refuses an id that names nothing", async () => {
    await expect(
      test.services.changes.apply(shop.owner.actor, shop.business.id, aPlan(BUSINESS, "OFF_ALL_DAY"), "KEEP", "blocks:nope"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      test.services.changes.apply(shop.owner.actor, shop.business.id, aPlan(BUSINESS, "OFF_ALL_DAY"), "KEEP", "nonsense"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("removing a change", () => {
  let test: Harness;
  let shop: Shop;

  beforeEach(async () => {
    test = harness();
    shop = await aTwoCalendarShop(test);
  });

  const list = () => test.services.changes.list(shop.owner.actor, shop.business.id, TUESDAY, THURSDAY);
  const threeDays = { fromDate: TUESDAY, toDate: THURSDAY };

  it.each([
    ["a calendar's days off", () => aPlan(calendar(shop.resource.id), "OFF_ALL_DAY", [], threeDays)],
    ["a business's part of the day", () => aPlan(BUSINESS, "OFF_PART", [{ start: "12:00", end: "13:00" }], threeDays)],
    ["a calendar's other hours", () => aPlan(calendar(shop.resource.id), "OTHER_HOURS", [{ start: "09:00", end: "12:00" }], threeDays)],
    ["the business closed", () => aPlan(BUSINESS, "OFF_ALL_DAY", [], threeDays)],
    ["the business on other hours", () => aPlan(BUSINESS, "OTHER_HOURS", [{ start: "09:00", end: "12:00" }], threeDays)],
  ])("gives back %s, whole", async (_name, plan) => {
    await test.services.changes.apply(shop.owner.actor, shop.business.id, plan(), "KEEP", null);
    const [change] = await list();
    expect(await test.services.changes.remove(shop.owner.actor, shop.business.id, change!.id, null)).toBe(3);
    expect(await list()).toEqual([]);
    for (const date of [TUESDAY, WEDNESDAY, THURSDAY]) {
      expect(await offered(test, shop, shop.resource.id, date)).toEqual(A_WHOLE_DAY);
    }
  });

  it.each([
    ["a calendar's days off", () => aPlan(calendar(shop.resource.id), "OFF_ALL_DAY", [], threeDays)],
    ["a business's part of the day", () => aPlan(BUSINESS, "OFF_PART", [{ start: "12:00", end: "13:00" }], threeDays)],
    ["a calendar's other hours", () => aPlan(calendar(shop.resource.id), "OTHER_HOURS", [{ start: "09:00", end: "12:00" }], threeDays)],
    ["the business closed", () => aPlan(BUSINESS, "OFF_ALL_DAY", [], threeDays)],
  ])("gives back one day of %s, the rest still in force", async (_name, plan) => {
    await test.services.changes.apply(shop.owner.actor, shop.business.id, plan(), "KEEP", null);
    const [change] = await list();
    expect(await test.services.changes.remove(shop.owner.actor, shop.business.id, change!.id, WEDNESDAY)).toBe(1);
    expect(await offered(test, shop, shop.resource.id, WEDNESDAY)).toEqual(A_WHOLE_DAY);
    expect(await offered(test, shop, shop.resource.id, TUESDAY)).not.toEqual(A_WHOLE_DAY);
    expect(await offered(test, shop, shop.resource.id, THURSDAY)).not.toEqual(A_WHOLE_DAY);
    const left = (await list()).flatMap((one) => one.days.map((day) => day.date));
    expect(left.sort()).toEqual([TUESDAY, THURSDAY]);
  });

  it("keeps one blockage, one decision, after a day of it is given back", async () => {
    await test.services.changes.apply(shop.owner.actor, shop.business.id, aPlan(calendar(shop.resource.id), "OFF_PART", [{ start: "12:00", end: "13:00" }], threeDays), "KEEP", null);
    const [change] = await list();
    await test.services.changes.remove(shop.owner.actor, shop.business.id, change!.id, WEDNESDAY);
    expect((await list()).map((one) => one.id)).toEqual([change!.id]);
  });

  it("cuts a day out of a blockage made as one span across days", async () => {
    // Made before blockages were per day: Tuesday ten o'clock to Thursday noon.
    await test.services.calendar.createBlocks(
      shop.owner.actor, shop.business.id, shop.resource.id,
      [{ startAt: TUESDAY_AT("10:00"), endAt: `${THURSDAY}T09:00:00.000Z`, reason: "" }], "KEEP",
    );
    const [change] = await list();
    await test.services.changes.remove(shop.owner.actor, shop.business.id, change!.id, WEDNESDAY);
    expect(await offered(test, shop, shop.resource.id, WEDNESDAY)).toEqual(A_WHOLE_DAY);
    expect(await offered(test, shop, shop.resource.id, TUESDAY)).toEqual(["09:00", "09:30"]);
    expect(await offered(test, shop, shop.resource.id, THURSDAY)).toEqual(A_WHOLE_DAY.filter((time) => time >= "12:00"));
  });

  it("asks the waiting list to look at the days it frees", async () => {
    await test.services.changes.apply(shop.owner.actor, shop.business.id, aPlan(BUSINESS, "OFF_ALL_DAY"), "KEEP", null);
    const [change] = await list();
    test.store.waitingRechecks = [];
    await test.services.changes.remove(shop.owner.actor, shop.business.id, change!.id, null);
    expect(test.store.waitingRechecks.map((mark) => mark.onDate)).toContain(TUESDAY);
  });

  it("refuses a day that is not part of it, and an id that names nothing", async () => {
    await test.services.changes.apply(shop.owner.actor, shop.business.id, aPlan(BUSINESS, "OFF_ALL_DAY"), "KEEP", null);
    const [change] = await list();
    await expect(test.services.changes.remove(shop.owner.actor, shop.business.id, change!.id, WEDNESDAY))
      .rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(test.services.changes.remove(shop.owner.actor, shop.business.id, "closure:2026-09-05:2026-09-05", null))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("what the waiting list is asked to look at", () => {
  let test: Harness;
  let shop: Shop;

  beforeEach(async () => {
    test = harness();
    shop = await aTwoCalendarShop(test);
    test.store.waitingRechecks = [];
  });

  it("other hours, which can hand time back, on every day and calendar they cover", async () => {
    await test.services.changes.apply(
      shop.owner.actor, shop.business.id, aPlan(BUSINESS, "OTHER_HOURS", [{ start: "07:00", end: "20:00" }], { toDate: WEDNESDAY }), "KEEP", null,
    );
    expect(test.store.waitingRechecks.map((mark) => `${mark.resourceId}@${mark.onDate}`).sort()).toEqual(
      [shop.resource.id, shop.second.id].flatMap((id) => [`${id}@${TUESDAY}`, `${id}@${WEDNESDAY}`]).sort(),
    );
  });

  it("nothing for a day off or some hours off, which only take time away", async () => {
    await test.services.changes.apply(shop.owner.actor, shop.business.id, aPlan(BUSINESS, "OFF_ALL_DAY"), "KEEP", null);
    await test.services.changes.apply(
      shop.owner.actor, shop.business.id, aPlan(calendar(shop.resource.id), "OFF_PART", [{ start: "10:00", end: "11:00" }], { fromDate: WEDNESDAY }), "KEEP", null,
    );
    expect(test.store.waitingRechecks).toEqual([]);
  });
});
