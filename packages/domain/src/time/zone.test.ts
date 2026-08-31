import { describe, expect, it } from "vitest";
import { formatInstant, parseInstant } from "./instant.ts";
import { parseLocalDate } from "./local-date.ts";
import { formatLocalTime, parseLocalTime } from "./local-time.ts";
import { instantToZoned, timeZone, zonedToInstant } from "./zone.ts";
import { DomainError } from "../shared/errors.ts";

const jerusalem = timeZone("Asia/Jerusalem");

describe("TimeZone", () => {
  it("rejects an unknown identifier", () => {
    expect(() => timeZone("Mars/Olympus")).toThrow(DomainError);
  });

  it("resolves a winter wall clock to its instant (UTC+2)", () => {
    const at = zonedToInstant(
      parseLocalDate("2026-01-15"),
      parseLocalTime("09:00"),
      jerusalem,
    );
    expect(formatInstant(at)).toBe("2026-01-15T07:00:00.000Z");
  });

  it("resolves a summer wall clock to its instant (UTC+3)", () => {
    const at = zonedToInstant(
      parseLocalDate("2026-07-15"),
      parseLocalTime("09:00"),
      jerusalem,
    );
    expect(formatInstant(at)).toBe("2026-07-15T06:00:00.000Z");
  });

  it("round trips an instant through the zone and back", () => {
    const original = parseInstant("2026-07-15T06:00:00.000Z");
    const zoned = instantToZoned(original, jerusalem);
    expect(zoned.date).toBe("2026-07-15");
    expect(formatLocalTime(zoned.time)).toBe("09:00");
    expect(zonedToInstant(zoned.date, zoned.time, jerusalem)).toBe(original);
  });

  it("reads midnight as 00:00 rather than 24:00", () => {
    const zoned = instantToZoned(
      parseInstant("2026-07-14T21:00:00.000Z"),
      jerusalem,
    );
    expect(formatLocalTime(zoned.time)).toBe("00:00");
    expect(zoned.date).toBe("2026-07-15");
  });

  it("keeps a wall clock stable across the spring transition", () => {
    // Israel springs forward on the Friday before the last Sunday of March.
    const before = zonedToInstant(
      parseLocalDate("2026-03-26"),
      parseLocalTime("12:00"),
      jerusalem,
    );
    const after = zonedToInstant(
      parseLocalDate("2026-03-30"),
      parseLocalTime("12:00"),
      jerusalem,
    );
    expect(formatInstant(before)).toBe("2026-03-26T10:00:00.000Z");
    expect(formatInstant(after)).toBe("2026-03-30T09:00:00.000Z");
  });

  it("agrees with UTC in a zone that has no offset", () => {
    const utc = timeZone("UTC");
    const at = zonedToInstant(
      parseLocalDate("2026-01-15"),
      parseLocalTime("09:00"),
      utc,
    );
    expect(formatInstant(at)).toBe("2026-01-15T09:00:00.000Z");
  });
});
