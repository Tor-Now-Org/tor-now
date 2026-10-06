import { describe, expect, it } from "vitest";
import { availableSlotsOn } from "./availability.ts";
import {
  aBlock,
  aBusiness,
  anOccupiedSpan,
  aResource,
  aService,
  at,
  dateOverride,
  onDate,
  workingHours,
} from "../testing/fixtures.ts";

// 2026-09-01 is a Tuesday (day 2); the shop works 09:00–17:00 on it unless a
// test says otherwise, and a service takes thirty minutes.
const TUESDAY = "2026-09-01";
const WEDNESDAY = "2026-09-02";

const request = (overrides: Partial<Parameters<typeof availableSlotsOn>[0]> = {}) => ({
  business: aBusiness({ minimumNoticeMinutes: 0 }),
  resource: aResource(),
  service: aService({ durationMinutes: 30, bufferMinutes: 0 }),
  date: onDate(TUESDAY),
  workingHours: [workingHours(2, "09:00", "17:00")],
  overrides: [],
  blocks: [],
  occupied: [],
  now: at("2026-08-25", "09:00"),
  ...overrides,
});

const reasonOf = (overrides: Partial<Parameters<typeof availableSlotsOn>[0]>) =>
  availableSlotsOn(request(overrides)).emptyReason;

describe("why an empty day is empty — closed", () => {
  it("is CLOSED when the calendar does not work that weekday", () => {
    expect(reasonOf({ workingHours: [workingHours(3, "09:00", "17:00")] })).toBe("CLOSED");
  });

  it("is CLOSED on a day taken off by an override", () => {
    expect(reasonOf({ overrides: [dateOverride(TUESDAY, [])] })).toBe("CLOSED");
  });

  it("is CLOSED, not too soon, on a day off that falls inside the notice", () => {
    // Three days' notice reaches past Wednesday, but nobody works Wednesday:
    // sending the customer to the phone about it would be sending them to ask
    // for a day the shop does not open.
    expect(
      reasonOf({
        date: onDate(WEDNESDAY),
        business: aBusiness({ minimumNoticeMinutes: 3 * 24 * 60 }),
        now: at(TUESDAY, "08:00"),
      }),
    ).toBe("CLOSED");
  });

  it("is CLOSED, not past the horizon, on a day off beyond the window", () => {
    expect(
      reasonOf({
        workingHours: [workingHours(3, "09:00", "17:00")],
        business: aBusiness({ bookingHorizonDays: 1 }),
        now: at("2026-08-20", "09:00"),
      }),
    ).toBe("CLOSED");
  });

  it("is CLOSED when no stretch of the day is long enough for the service", () => {
    expect(reasonOf({ workingHours: [workingHours(2, "09:00", "09:20")] })).toBe("CLOSED");
  });
});

describe("why an empty day is empty — over", () => {
  it("is DAY_OVER once today's hours have ended", () => {
    // The bug this replaces: the day read as fully booked, and the customer
    // was offered a waiting list for hours that had already gone.
    expect(reasonOf({ now: at(TUESDAY, "18:00") })).toBe("DAY_OVER");
  });

  it("is DAY_OVER when what is left of today cannot hold the service", () => {
    expect(reasonOf({ now: at(TUESDAY, "16:55") })).toBe("DAY_OVER");
  });

  it("is DAY_OVER for a day that has already passed", () => {
    expect(reasonOf({ now: at(WEDNESDAY, "10:00") })).toBe("DAY_OVER");
  });

  it("is DAY_OVER after the evening stretch of a split day has ended too", () => {
    expect(
      reasonOf({
        workingHours: [workingHours(2, "09:00", "12:00"), workingHours(2, "16:00", "19:00")],
        now: at(TUESDAY, "19:30"),
      }),
    ).toBe("DAY_OVER");
  });
});

describe("why an empty day is empty — too soon", () => {
  it("is TOO_SOON when the notice reaches into the day's hours", () => {
    // The bug this replaces: the day read as fully booked, and the customer was
    // offered the waiting list rather than the phone ADR 0012 promises.
    expect(
      reasonOf({
        business: aBusiness({ minimumNoticeMinutes: 10 * 60 }),
        now: at(TUESDAY, "08:00"),
      }),
    ).toBe("TOO_SOON");
  });

  it("is TOO_SOON for a whole open day inside a notice of several days", () => {
    expect(
      reasonOf({
        date: onDate(WEDNESDAY),
        workingHours: [workingHours(3, "09:00", "17:00")],
        business: aBusiness({ minimumNoticeMinutes: 3 * 24 * 60 }),
        now: at(TUESDAY, "08:00"),
      }),
    ).toBe("TOO_SOON");
  });

  it("is TOO_SOON late in the day while an appointment could still fit before closing", () => {
    // 16:10 with an hour's notice: the window opens at 17:15, after closing,
    // but 16:10–17:00 could hold a thirty-minute appointment if the business
    // agreed to it on the phone.
    expect(
      reasonOf({
        business: aBusiness({ minimumNoticeMinutes: 60 }),
        now: at(TUESDAY, "16:10"),
      }),
    ).toBe("TOO_SOON");
  });

  it("is TOO_SOON, not full, when the notice leaves only a sliver too short for the service", () => {
    // 15:50 + an hour = 16:50, offered from 16:55: five minutes before closing
    // can hold nothing, and the stretch it came from is the notice's.
    expect(
      reasonOf({
        business: aBusiness({ minimumNoticeMinutes: 60 }),
        now: at(TUESDAY, "15:50"),
      }),
    ).toBe("TOO_SOON");
  });

  it("is TOO_SOON when the morning has passed and the evening is inside the notice", () => {
    expect(
      reasonOf({
        workingHours: [workingHours(2, "09:00", "12:00"), workingHours(2, "16:00", "19:00")],
        business: aBusiness({ minimumNoticeMinutes: 6 * 60 }),
        now: at(TUESDAY, "13:00"),
      }),
    ).toBe("TOO_SOON");
  });
});

describe("why an empty day is empty — full", () => {
  it("is FULLY_BOOKED when appointments fill the day", () => {
    expect(
      reasonOf({
        workingHours: [workingHours(2, "09:00", "10:00")],
        occupied: [anOccupiedSpan(TUESDAY, "09:00", 60)],
      }),
    ).toBe("FULLY_BOOKED");
  });

  it("is FULLY_BOOKED when a block covers the whole day", () => {
    expect(reasonOf({ blocks: [aBlock(TUESDAY, "09:00", "17:00")] })).toBe("FULLY_BOOKED");
  });

  it("is FULLY_BOOKED when what the notice leaves open is taken", () => {
    expect(
      reasonOf({
        business: aBusiness({ minimumNoticeMinutes: 60 }),
        now: at(TUESDAY, "15:00"),
        occupied: [anOccupiedSpan(TUESDAY, "16:00", 60)],
      }),
    ).toBe("FULLY_BOOKED");
  });

  it("is FULLY_BOOKED when what the horizon leaves open is taken", () => {
    expect(
      reasonOf({
        business: aBusiness({ bookingHorizonDays: 7 }),
        now: at("2026-08-25", "10:00"),
        occupied: [anOccupiedSpan(TUESDAY, "09:00", 60)],
      }),
    ).toBe("FULLY_BOOKED");
  });
});

describe("why an empty day is empty — beyond the horizon", () => {
  it("is BEYOND_HORIZON for an open day wholly past the window", () => {
    expect(
      reasonOf({
        business: aBusiness({ bookingHorizonDays: 1 }),
        now: at("2026-08-01", "09:00"),
      }),
    ).toBe("BEYOND_HORIZON");
  });

  it("is BEYOND_HORIZON when the window ends before the day opens", () => {
    expect(
      reasonOf({
        business: aBusiness({ bookingHorizonDays: 7 }),
        now: at("2026-08-25", "08:00"),
      }),
    ).toBe("BEYOND_HORIZON");
  });

  it("is BEYOND_HORIZON when the window leaves only a sliver too short for the service", () => {
    expect(
      reasonOf({
        business: aBusiness({ bookingHorizonDays: 7 }),
        now: at("2026-08-25", "09:10"),
      }),
    ).toBe("BEYOND_HORIZON");
  });
});

describe("the last day of the window, partly open", () => {
  const partly = (overrides: Partial<Parameters<typeof availableSlotsOn>[0]>) =>
    availableSlotsOn(request(overrides)).partlyBeyondHorizon;

  it("says so when the horizon cuts through the day's hours", () => {
    const result = availableSlotsOn(
      request({ business: aBusiness({ bookingHorizonDays: 7 }), now: at("2026-08-25", "12:00") }),
    );
    expect(result.slots.length).toBeGreaterThan(0);
    expect(result.emptyReason).toBeNull();
    expect(result.partlyBeyondHorizon).toBe(true);
  });

  it("says so for a day wholly past the window", () => {
    expect(partly({ business: aBusiness({ bookingHorizonDays: 1 }), now: at("2026-08-01", "09:00") })).toBe(true);
  });

  it("does not for an ordinary day well inside the window", () => {
    expect(partly({})).toBe(false);
  });

  it("does not when the horizon ends after closing", () => {
    expect(partly({ business: aBusiness({ bookingHorizonDays: 7 }), now: at("2026-08-25", "17:30") })).toBe(false);
  });

  it("does not when what lies past the horizon is too short for the service", () => {
    expect(partly({ business: aBusiness({ bookingHorizonDays: 7 }), now: at("2026-08-25", "16:50") })).toBe(false);
  });

  it("does not for a closed day", () => {
    expect(
      partly({
        workingHours: [workingHours(3, "09:00", "17:00")],
        business: aBusiness({ bookingHorizonDays: 1 }),
        now: at("2026-08-01", "09:00"),
      }),
    ).toBe(false);
  });
});
