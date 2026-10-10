import { describe, expect, it } from "vitest";
import { dayAndTime, dayOfMonth, monthAndYear, shortMonth, timeOnly, weekdayShort } from "./record-dates.ts";

const ZONE = "Asia/Jerusalem";

describe("the dates on a customer's page", () => {
  it("names the month a customer has been one since", () => {
    expect(monthAndYear("2026-09-04T08:00:00Z", ZONE, "he")).toBe("ספטמבר 2026");
    expect(monthAndYear("2026-09-04T08:00:00Z", ZONE, "en")).toBe("September 2026");
  });
  it("reads every date on the business's clock, not the device's", () => {
    // 22:30 on 30 September in UTC is already 1 October in Israel.
    expect(monthAndYear("2026-09-30T22:30:00Z", ZONE, "en")).toBe("October 2026");
    expect(dayOfMonth("2026-09-30T22:30:00Z", ZONE, "he")).toBe("1");
    expect(timeOnly("2026-09-30T22:30:00Z", ZONE, "he")).toBe("01:30");
  });
  it("gives a history row its day and short month", () => {
    expect(dayOfMonth("2026-10-12T13:00:00Z", ZONE, "he")).toBe("12");
    expect(shortMonth("2026-10-12T13:00:00Z", ZONE, "he")).toBe("אוק׳");
    expect(shortMonth("2026-10-12T13:00:00Z", ZONE, "en")).toBe("Oct");
  });
  it("names an upcoming appointment by its day and hour, on a 24-hour clock", () => {
    expect(dayAndTime("2026-10-12T13:00:00Z", ZONE, "he")).toBe("יום ב׳, 12 באוק׳ · 16:00");
    expect(dayAndTime("2026-10-12T13:00:00Z", ZONE, "en")).toBe("Mon 12 Oct · 16:00");
    expect(timeOnly("2026-10-12T21:05:00Z", ZONE, "en")).toBe("00:05");
  });
  it("names the weekday alone, for a row whose date stands beside it", () => {
    expect(weekdayShort("2026-10-12T13:00:00Z", ZONE, "he")).toBe("יום ב׳");
    expect(weekdayShort("2026-10-12T13:00:00Z", ZONE, "en")).toBe("Mon");
  });
});
