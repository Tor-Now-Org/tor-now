import { describe, expect, it } from "vitest";
import { availableSlotsOn, occupiedSpanFor } from "./availability.ts";
import { fixedGranularity } from "./slots.ts";
import {
  aBlock,
  aBusiness,
  anOccupiedSpan,
  aResource,
  aService,
  at,
  dateOverride,
  JERUSALEM,
  onDate,
  workingHours,
} from "../testing/fixtures.ts";
import { instantToZoned } from "../time/zone.ts";
import { formatLocalTime } from "../time/local-time.ts";

// 2026-09-01 is a Tuesday (day 2).
const TUESDAY = "2026-09-01";

const times = (result: { slots: readonly { startAt: number }[] }) =>
  result.slots.map((slot) =>
    formatLocalTime(instantToZoned(slot.startAt as never, JERUSALEM).time),
  );

const aBusinessWithMinimumNotice = (minutes: number) =>
  aBusiness({ minimumNoticeMinutes: minutes });

const request = (overrides: Partial<Parameters<typeof availableSlotsOn>[0]> = {}) => ({
  business: aBusiness(),
  resource: aResource(),
  service: aService(),
  date: onDate(TUESDAY),
  workingHours: [workingHours(2, "09:00", "17:00")],
  overrides: [],
  blocks: [],
  occupied: [],
  // Well before the day, so the booking window never interferes by accident.
  now: at("2026-08-25", "09:00"),
  ...overrides,
});

describe("availableSlotsOn — the greedy walk", () => {
  it("packs a plain day in duration-sized steps", () => {
    const result = availableSlotsOn(
      request({ workingHours: [workingHours(2, "09:00", "11:00")] }),
    );
    expect(times(result)).toEqual([
      "09:00",
      "09:30",
      "10:00",
      "10:30",
    ]);
    expect(result.emptyReason).toBeNull();
  });

  it("steps by duration plus buffer, so starts drift off round times", () => {
    const result = availableSlotsOn(
      request({
        workingHours: [workingHours(2, "09:00", "11:00")],
        service: aService({ durationMinutes: 30, bufferMinutes: 5 }),
      }),
    );
    // 10:45 is not offered: it would end at 11:15, past closing.
    expect(times(result)).toEqual(["09:00", "09:35", "10:10"]);
  });

  it("offers a last slot whose buffer runs past closing time", () => {
    // 10:45 + 30 = 11:15 would exceed 11:00, so 10:45 is the last that fits;
    // its 5-minute buffer past 11:15 is nobody's time.
    const result = availableSlotsOn(
      request({
        workingHours: [workingHours(2, "09:00", "11:20")],
        service: aService({ durationMinutes: 30, bufferMinutes: 5 }),
      }),
    );
    expect(times(result).at(-1)).toBe("10:45");
  });

  it("restarts the walk in each range, so a break realigns the grid", () => {
    const result = availableSlotsOn(
      request({
        workingHours: [
          workingHours(2, "09:00", "10:00"),
          workingHours(2, "13:00", "14:00"),
        ],
      }),
    );
    expect(times(result)).toEqual(["09:00", "09:30", "13:00", "13:30"]);
  });
});

describe("availableSlotsOn — the schedule layers", () => {
  it("uses a date override in place of the weekday's hours", () => {
    const result = availableSlotsOn(
      request({ overrides: [dateOverride(TUESDAY, [["10:00", "11:00"]])] }),
    );
    expect(times(result)).toEqual(["10:00", "10:30"]);
  });

  it("reports a closed override as CLOSED", () => {
    const result = availableSlotsOn(
      request({ overrides: [dateOverride(TUESDAY, [])] }),
    );
    expect(result.slots).toEqual([]);
    expect(result.emptyReason).toBe("CLOSED");
  });

  it("reports a weekday with no hours as CLOSED", () => {
    const result = availableSlotsOn(
      request({ workingHours: [workingHours(3, "09:00", "17:00")] }),
    );
    expect(result.emptyReason).toBe("CLOSED");
  });

  it("subtracts a block from the middle of the day", () => {
    const result = availableSlotsOn(
      request({
        workingHours: [workingHours(2, "09:00", "11:00")],
        blocks: [aBlock(TUESDAY, "09:30", "10:30")],
      }),
    );
    expect(times(result)).toEqual(["09:00", "10:30"]);
  });

  it("subtracts a confirmed appointment", () => {
    const result = availableSlotsOn(
      request({
        workingHours: [workingHours(2, "09:00", "11:00")],
        occupied: [anOccupiedSpan(TUESDAY, "09:30", 30)],
      }),
    );
    expect(times(result)).toEqual(["09:00", "10:00", "10:30"]);
  });

  it("is told only about time that is actually occupied", () => {
    // Which Appointments occupy time is decided where they are read, using the
    // same predicate ADR 0003 puts on the exclusion constraint — so a cancelled
    // slot is rebookable at once. The engine never sees a status, and therefore
    // cannot disagree with the database about which rows count.
    const result = availableSlotsOn(
      request({ workingHours: [workingHours(2, "09:00", "11:00")], occupied: [] }),
    );
    expect(times(result)).toEqual(["09:00", "09:30", "10:00", "10:30"]);
  });

  it("reports a day filled by appointments as FULLY_BOOKED", () => {
    const result = availableSlotsOn(
      request({
        workingHours: [workingHours(2, "09:00", "10:00")],
        occupied: [anOccupiedSpan(TUESDAY, "09:00", 60)],
      }),
    );
    expect(result.emptyReason).toBe("FULLY_BOOKED");
  });
});

describe("availableSlotsOn — buffers never produce an unbookable slot", () => {
  it("keeps a new booking's buffer clear of the next appointment", () => {
    // Open 09:00–11:00, existing appointment at 10:00. A 30-minute service
    // with a 10-minute buffer must not be offered at 09:30: it would end at
    // 10:00 and its buffer would run into the appointment.
    const result = availableSlotsOn(
      request({
        workingHours: [workingHours(2, "09:00", "11:30")],
        service: aService({ durationMinutes: 30, bufferMinutes: 10 }),
        occupied: [anOccupiedSpan(TUESDAY, "10:00", 30, 10)],
      }),
    );
    // 09:30 is withheld — it would end where the appointment starts, leaving
    // its 10-minute buffer overlapping. 10:40 is the first start after the
    // appointment's own buffer clears.
    expect(times(result)).toEqual(["09:00", "10:40"]);
  });

  it("still allows a booking that ends exactly where an appointment starts when there is no buffer", () => {
    const result = availableSlotsOn(
      request({
        workingHours: [workingHours(2, "09:00", "11:00")],
        service: aService({ durationMinutes: 30, bufferMinutes: 0 }),
        occupied: [anOccupiedSpan(TUESDAY, "10:00", 30)],
      }),
    );
    expect(times(result)).toContain("09:30");
  });

  it("falls back to the business default buffer when the service has none", () => {
    const result = availableSlotsOn(
      request({
        business: aBusiness({ defaultBufferMinutes: 15 }),
        workingHours: [workingHours(2, "09:00", "11:00")],
        service: aService({ durationMinutes: 30, bufferMinutes: null }),
      }),
    );
    expect(times(result)).toEqual(["09:00", "09:45", "10:30"]);
  });
});

describe("availableSlotsOn — the booking window", () => {
  it("trims the near end by the minimum notice", () => {
    const result = availableSlotsOn(
      request({
        workingHours: [workingHours(2, "09:00", "11:00")],
        business: aBusiness({ minimumNoticeMinutes: 60 }),
        now: at(TUESDAY, "09:15"),
      }),
    );
    // 09:15 + 60 minutes of notice = 10:15, rounded up to the next offer
    // boundary. 10:15 itself is unbookable: confirming it takes time, and by
    // then it is inside the hour's notice the business asked for.
    expect(times(result)).toEqual(["10:20"]);
  });

  it("reports TOO_SOON when notice consumes the rest of the day", () => {
    const result = availableSlotsOn(
      request({
        workingHours: [workingHours(2, "09:00", "11:00")],
        business: aBusiness({ minimumNoticeMinutes: 60 }),
        now: at(TUESDAY, "23:00"),
      }),
    );
    expect(result.emptyReason).toBe("TOO_SOON");
  });

  it("reports BEYOND_HORIZON past the booking horizon", () => {
    const result = availableSlotsOn(
      request({
        business: aBusiness({ bookingHorizonDays: 1 }),
        now: at("2026-08-01", "09:00"),
      }),
    );
    expect(result.emptyReason).toBe("BEYOND_HORIZON");
  });

  it("still allows same-day booking once notice has passed", () => {
    const result = availableSlotsOn(
      request({
        workingHours: [workingHours(2, "09:00", "17:00")],
        business: aBusiness({ minimumNoticeMinutes: 60 }),
        now: at(TUESDAY, "08:00"),
      }),
    );
    // Opening time is 09:00 and notice expires at 09:00 exactly, so the first
    // offer is the boundary after it. Same-day booking still works, which is
    // what this is about.
    expect(times(result)[0]).toBe("09:05");
  });

  it("never offers a start that the notice would refuse a moment later", async () => {
    // The failure this guards against is quiet and constant: a first slot on
    // the notice boundary is drawn, read, chosen and then refused, because
    // `now` moved while the customer was deciding.
    const now = at(TUESDAY, "08:03");
    const result = availableSlotsOn(
      request({
        workingHours: [workingHours(2, "06:00", "20:00")],
        business: aBusinessWithMinimumNotice(60),
        now,
      }),
    );
    const first = result.slots[0];
    expect(first).toBeDefined();
    expect(first!.startAt - now).toBeGreaterThan(60 * 60 * 1000);
  });
});

describe("the strategy seam", () => {
  it("accepts a different strategy without touching constraint gathering", () => {
    const result = availableSlotsOn(
      request({
        workingHours: [workingHours(2, "09:00", "10:00")],
        service: aService({ durationMinutes: 30 }),
      }),
      fixedGranularity(15),
    );
    expect(times(result)).toEqual(["09:00", "09:15", "09:30"]);
  });
});

describe("occupiedSpanFor", () => {
  it("occupies the duration plus the buffer", () => {
    const start = at(TUESDAY, "09:00");
    const span = occupiedSpanFor(
      { durationMinutes: 30, bufferMinutes: 10 },
      { defaultBufferMinutes: 0 },
      start,
    );
    expect(span.endAt).toBe(at(TUESDAY, "09:30"));
    expect(span.occupiedUntil).toBe(at(TUESDAY, "09:40"));
  });
});
