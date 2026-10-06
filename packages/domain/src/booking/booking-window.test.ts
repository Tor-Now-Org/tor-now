import { describe, expect, it } from "vitest";
import {
  bookingWindowFor,
  leavesRoomToBook,
  OFFER_BOUNDARY_MINUTES,
  requireRoomToBook,
} from "./booking-window.ts";
import { MINUTES_PER_DAY } from "../shared/constants.ts";
import { DomainError } from "../shared/errors.ts";
import { at } from "../testing/fixtures.ts";

const DAY = MINUTES_PER_DAY;

describe("leavesRoomToBook — a window somebody can book in", () => {
  it("accepts the defaults", () => {
    expect(leavesRoomToBook({ minimumNoticeMinutes: 60, bookingHorizonDays: 60 })).toBe(true);
  });

  it("accepts no notice with a single day ahead", () => {
    expect(leavesRoomToBook({ minimumNoticeMinutes: 0, bookingHorizonDays: 1 })).toBe(true);
  });

  it("refuses a notice longer than the horizon", () => {
    expect(leavesRoomToBook({ minimumNoticeMinutes: 7 * DAY, bookingHorizonDays: 5 })).toBe(false);
  });

  it("refuses a notice exactly as long as the horizon", () => {
    expect(leavesRoomToBook({ minimumNoticeMinutes: 3 * DAY, bookingHorizonDays: 3 })).toBe(false);
  });

  it("draws the line where the offer's rounding would close the window", () => {
    // The offer starts up to five minutes after now + notice, so a notice
    // within five minutes of the horizon leaves a window that can be empty.
    const horizon = 2;
    const last = horizon * DAY - OFFER_BOUNDARY_MINUTES - 1;
    expect(leavesRoomToBook({ minimumNoticeMinutes: last, bookingHorizonDays: horizon })).toBe(true);
    expect(leavesRoomToBook({ minimumNoticeMinutes: last + 1, bookingHorizonDays: horizon })).toBe(false);
  });

  it("agrees with the window itself at every moment of the day", () => {
    const horizon = 1;
    const accepted = { minimumNoticeMinutes: horizon * DAY - OFFER_BOUNDARY_MINUTES - 1, bookingHorizonDays: horizon };
    for (const clock of ["00:00", "00:01", "09:02", "13:04", "23:59"]) {
      const window = bookingWindowFor(accepted, at("2026-09-01", clock));
      expect(window.start).toBeLessThan(window.end);
    }
  });
});

describe("requireRoomToBook", () => {
  it("passes a bookable window through quietly", () => {
    expect(() => requireRoomToBook({ minimumNoticeMinutes: 60, bookingHorizonDays: 60 })).not.toThrow();
  });

  it("refuses an impossible one with a reason the screen can name", () => {
    try {
      requireRoomToBook({ minimumNoticeMinutes: 7 * DAY, bookingHorizonDays: 5 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("VALIDATION_FAILED");
      expect((error as DomainError).details).toEqual({ reason: "NOTICE_BEYOND_HORIZON" });
    }
  });
});
