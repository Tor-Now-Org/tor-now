import { describe, expect, it } from "vitest";
import {
  END_OF_DAY,
  formatLocalTime,
  hourOf,
  localTimeOf,
  minuteOf,
  parseLocalTime,
  shiftLocalTime,
} from "./local-time.ts";
import { DomainError } from "../shared/errors.ts";

describe("LocalTime", () => {
  it("parses and formats the HH:MM round trip", () => {
    expect(formatLocalTime(parseLocalTime("09:30"))).toBe("09:30");
    expect(formatLocalTime(parseLocalTime("00:00"))).toBe("00:00");
    expect(formatLocalTime(parseLocalTime("23:59"))).toBe("23:59");
  });

  it("represents midnight at the end of the day as 24:00", () => {
    expect(END_OF_DAY).toBe(24 * 60);
    expect(formatLocalTime(END_OF_DAY)).toBe("24:00");
  });

  it("exposes hour and minute components", () => {
    const time = parseLocalTime("14:05");
    expect(hourOf(time)).toBe(14);
    expect(minuteOf(time)).toBe(5);
  });

  it("rejects malformed text", () => {
    expect(() => parseLocalTime("9:30")).toThrow(DomainError);
    expect(() => parseLocalTime("09:60")).toThrow(DomainError);
    expect(() => parseLocalTime("")).toThrow(DomainError);
  });

  it("rejects times outside the day", () => {
    expect(() => localTimeOf(24, 1)).toThrow(DomainError);
    expect(() => localTimeOf(-1, 0)).toThrow(DomainError);
  });

  it("clamps shifts to the bounds of the day", () => {
    expect(shiftLocalTime(parseLocalTime("23:30"), 60)).toBe(END_OF_DAY);
    expect(shiftLocalTime(parseLocalTime("00:30"), -60)).toBe(0);
  });
});
