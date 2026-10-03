import { describe, expect, it } from "vitest";
import { asId } from "../model/ids.ts";
import { money } from "../model/money.ts";
import { aBlock, anAppointment, at, JERUSALEM, onDate, workingHours } from "../testing/fixtures.ts";
import { instant } from "../time/instant.ts";
import { monthlyStatistics, trendStartOf, type StatisticsCalendar, type StatisticsInput } from "./monthly.ts";

// Sunday to Thursday, nine to five: eight open hours a working day.
const WEEK = [0, 1, 2, 3, 4].map((day) => workingHours(day, "09:00", "17:00"));
const CHAIR: StatisticsCalendar = { id: asId("resource-1"), name: "רן", workingHours: WEEK, overrides: [], blocks: [] };
const OTHER: StatisticsCalendar = {
  ...CHAIR,
  id: asId("resource-2"),
  name: "שקד",
  workingHours: WEEK.map((hours) => ({ ...hours, resourceId: asId("resource-2") })),
};

const visit = (date: string, time: string, customer = "user-1", overrides = {}) =>
  anAppointment(date, time, 60, 0, {
    id: asId(`a-${date}-${time}-${customer}`),
    customerId: asId(customer),
    ...overrides,
  });

const statistics = (overrides: Partial<StatisticsInput> = {}) =>
  monthlyStatistics({
    month: onDate("2026-09-01"),
    firstMonth: onDate("2026-08-01"),
    timeZone: JERUSALEM,
    now: at("2026-09-10", "12:00"),
    appointments: [],
    calendars: [CHAIR],
    firstVisits: [],
    resourceId: null,
    ...overrides,
  });

describe("a month in numbers", () => {
  it("counts an appointment as completed or upcoming, never both", () => {
    const result = statistics({
      appointments: [
        visit("2026-09-08", "10:00"),
        // Still in the chair at noon: upcoming until it ends.
        visit("2026-09-10", "11:30"),
        visit("2026-09-15", "10:00"),
      ],
    });

    expect(result.totals.completed).toBe(1);
    expect(result.totals.revenue).toBe(8000);
    const upcoming = result.days.reduce((sum, day) => sum + day.upcoming, 0);
    const completed = result.days.reduce((sum, day) => sum + day.completed, 0);
    expect([completed, upcoming]).toEqual([1, 2]);
  });

  it("sets a running month against the same stretch of the one before", () => {
    const result = statistics({
      appointments: [
        visit("2026-08-03", "10:00"),
        // After the ninth and a half days September has had so far.
        visit("2026-08-20", "10:00"),
        visit("2026-09-03", "10:00"),
      ],
    });

    expect(result.previous?.completed).toBe(1);
    expect(result.totals.completed).toBe(1);
  });

  it("compares a finished month with the whole month before", () => {
    const result = statistics({
      now: at("2026-10-05", "12:00"),
      appointments: [visit("2026-08-03", "10:00"), visit("2026-08-20", "10:00")],
    });
    expect(result.previous?.completed).toBe(2);
  });

  it("goes back no further than the month the business opened", () => {
    const result = statistics({ month: onDate("2026-08-01") });
    expect(result.previous).toBeNull();
    expect(result.trend.map((entry) => entry.month)).toEqual(["2026-08-01"]);
    expect(trendStartOf(onDate("2027-03-01"), onDate("2026-01-01"))).toBe("2026-10-01");
  });

  it("measures utilization against the open time that has passed, without blocks", () => {
    // 1–10 September up to noon: 7 full working days (56h) and a half-day on the 10th (3h) = 59h.
    // A three-hour block on the 8th leaves 56h open; two hours were booked.
    const result = statistics({
      calendars: [{ ...CHAIR, blocks: [aBlock("2026-09-08", "13:00", "16:00")] }],
      appointments: [
        visit("2026-09-08", "10:00"),
        visit("2026-09-09", "10:00", "user-2", { status: "NO_SHOW" }),
      ],
    });
    expect(result.totals.utilization).toBeCloseTo(2 / 56);
  });

  it("has no utilization for a stretch with no open time", () => {
    expect(statistics({ calendars: [{ ...CHAIR, workingHours: [] }] }).totals.utilization).toBeNull();
  });

  it("splits what happened to appointments, and names repeated misses", () => {
    const result = statistics({
      appointments: [
        visit("2026-09-01", "09:00"),
        visit("2026-09-01", "10:00", "user-2", { status: "NO_SHOW" }),
        visit("2026-09-02", "10:00", "user-2", {
          status: "CANCELLED", cancelledBy: "CUSTOMER", lateCancellation: true, cancelledAt: instant(0),
        }),
        visit("2026-09-03", "10:00", "user-3", { status: "CANCELLED", cancelledBy: "CUSTOMER", cancelledAt: instant(0) }),
        visit("2026-09-03", "11:00", "user-3", { status: "CANCELLED", cancelledBy: "BUSINESS", cancelledAt: instant(0) }),
      ],
    });

    expect(result.outcomes).toEqual({
      completed: 1, noShow: 1, lateCancellation: 1, cancelledOnTime: 1, cancelledByBusiness: 1,
    });
    expect(result.repeatMisses).toEqual([{ customerId: "user-2", times: 2 }]);
  });

  it("tells new customers from returning ones by their first visit", () => {
    const result = statistics({
      appointments: [visit("2026-09-01", "09:00", "user-1"), visit("2026-09-02", "09:00", "user-2")],
      firstVisits: [{ customerId: asId("user-2"), resourceId: asId("resource-1"), firstAt: at("2026-09-02", "09:00") }],
    });
    expect(result.customers).toMatchObject({ seen: 2, new: 1, returning: 1 });
  });

  it("narrows everything to one calendar when asked", () => {
    const result = statistics({
      calendars: [CHAIR, OTHER],
      resourceId: asId("resource-2"),
      appointments: [
        visit("2026-09-01", "09:00"),
        visit("2026-09-01", "09:00", "user-2", { resourceId: asId("resource-2"), price: money(5000) }),
      ],
    });
    expect(result.totals.revenue).toBe(5000);
    expect(result.calendars).toEqual([]);
  });

  it("buckets how far ahead people booked, leaving out cancellations", () => {
    const result = statistics({
      appointments: [
        visit("2026-09-08", "10:00", "user-1", { createdAt: at("2026-09-08", "08:00") }),
        visit("2026-09-08", "11:00", "user-1", { createdAt: at("2026-09-01", "08:00") }),
        visit("2026-09-08", "12:00", "user-1", {
          createdAt: at("2026-09-07", "08:00"), status: "CANCELLED", cancelledBy: "CUSTOMER", cancelledAt: instant(0),
        }),
      ],
    });
    expect(result.leadTime).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("gives each calendar its own row: what it did, earned, missed and filled", () => {
    const result = statistics({
      calendars: [CHAIR, OTHER],
      appointments: [
        visit("2026-09-01", "09:00"),
        visit("2026-09-01", "10:00"),
        visit("2026-09-01", "09:00", "user-2", { resourceId: asId("resource-2"), status: "NO_SHOW" }),
      ],
    });
    expect(result.calendars).toEqual([
      { resourceId: "resource-1", name: "רן", completed: 2, revenue: 16000, noShows: 0, utilization: 2 / 59 },
      { resourceId: "resource-2", name: "שקד", completed: 0, revenue: 0, noShows: 1, utilization: 1 / 59 },
    ]);
  });

  it("draws the trend from the month the business opened, one point a month", () => {
    const result = statistics({
      month: onDate("2026-10-01"),
      now: at("2026-10-20", "12:00"),
      appointments: [visit("2026-08-03", "10:00"), visit("2026-09-03", "10:00"), visit("2026-09-08", "10:00")],
    });
    expect(result.trend.map((entry) => [entry.month, entry.totals.completed])).toEqual([
      ["2026-08-01", 1],
      ["2026-09-01", 2],
      ["2026-10-01", 0],
    ]);
  });

  it("ranks the most frequent customers, three at most", () => {
    const result = statistics({
      appointments: [
        ...["09:00", "10:00", "11:00"].map((time) => visit("2026-09-01", time, "user-1")),
        ...["09:00", "10:00"].map((time) => visit("2026-09-02", time, "user-2")),
        visit("2026-09-03", "09:00", "user-3"),
        visit("2026-09-03", "10:00", "user-4"),
      ],
    });
    expect(result.customers.top.map((entry) => [entry.customerId, entry.visits]).slice(0, 2)).toEqual([
      ["user-1", 3],
      ["user-2", 2],
    ]);
    expect(result.customers.top).toHaveLength(3);
    expect(result.customers.seen).toBe(4);
  });

  it("adds revenue up by the service it was booked as, at the price it was booked at", () => {
    const result = statistics({
      appointments: [
        visit("2026-09-01", "09:00", "user-1", { serviceName: "צבע", price: money(25000) }),
        visit("2026-09-01", "10:00", "user-1", { price: money(9000) }),
        visit("2026-09-01", "11:00"),
        // Upcoming: earns nothing yet.
        visit("2026-09-20", "11:00", "user-1", { serviceName: "צבע", price: money(25000) }),
      ],
    });
    expect(result.services).toEqual([
      { name: "צבע", revenue: 25000, completed: 1 },
      { name: "תספורת", revenue: 17000, completed: 2 },
    ]);
  });

  it("marks the days nobody was open", () => {
    const result = statistics();
    // 5 September 2026 is a Saturday.
    expect(result.days.find((day) => day.date === "2026-09-05")?.open).toBe(false);
    expect(result.days.find((day) => day.date === "2026-09-06")?.open).toBe(true);
  });
});
