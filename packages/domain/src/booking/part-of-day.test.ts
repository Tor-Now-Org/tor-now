import { describe, expect, it } from "vitest";
import { parseInstant } from "../time/instant.ts";
import { interval } from "../time/interval.ts";
import { localTimeOf } from "../time/local-time.ts";
import { timeZone } from "../time/zone.ts";
import {
  PARTS_OF_DAY,
  partOfDayAt,
  partsOfDayOpen,
  wantedPartsOfDay,
  type PartOfDay,
} from "./part-of-day.ts";

const JERUSALEM = timeZone("Asia/Jerusalem");
const LONDON = timeZone("Europe/London");

/**
 * Morning, noon and evening are what the customer's slot grid has always been
 * grouped into. They stop being presentation the moment a Waiting Entry is
 * expressed in them — "tell me if a morning opens" is a claim about which
 * hours count as morning, and the answer has to be the same on both sides of
 * the wire.
 */
describe("parts of the day", () => {
  it("splits the day at noon and at five", () => {
    const partAt = (local: string): PartOfDay =>
      partOfDayAt(parseInstant(local), JERUSALEM);

    expect(partAt("2026-09-21T05:00:00.000Z")).toBe("MORNING"); // 08:00
    expect(partAt("2026-09-21T08:59:00.000Z")).toBe("MORNING"); // 11:59
    expect(partAt("2026-09-21T09:00:00.000Z")).toBe("NOON"); //    12:00
    expect(partAt("2026-09-21T13:59:00.000Z")).toBe("NOON"); //    16:59
    expect(partAt("2026-09-21T14:00:00.000Z")).toBe("EVENING"); // 17:00
    expect(partAt("2026-09-21T20:00:00.000Z")).toBe("EVENING"); // 23:00
  });

  /**
   * The whole point of taking a zone: the same instant is a morning in one
   * place and an evening in another, and a Waiting Entry means the Business's
   * morning, not the server's.
   */
  it("answers in the zone it is asked about, not in UTC", () => {
    const early = parseInstant("2026-09-21T09:30:00.000Z");
    expect(partOfDayAt(early, JERUSALEM)).toBe("NOON"); // 12:30 local
    expect(partOfDayAt(early, LONDON)).toBe("MORNING"); // 10:30 local
  });

  it("puts the very first minute of the day in the morning", () => {
    expect(partOfDayAt(parseInstant("2026-09-20T21:00:00.000Z"), JERUSALEM)).toBe(
      "MORNING",
    ); // midnight local
  });

  describe("what a customer asked for", () => {
    it("keeps the parts it recognises, in the day's own order", () => {
      expect(wantedPartsOfDay(["EVENING", "MORNING"])).toEqual([
        "MORNING",
        "EVENING",
      ]);
    });

    it("drops duplicates rather than waiting twice for one morning", () => {
      expect(wantedPartsOfDay(["MORNING", "MORNING"])).toEqual(["MORNING"]);
    });

    /**
     * "Any time" is every part rather than none. An empty set would have to
     * mean "all" by convention somewhere, and a convention like that is read
     * backwards exactly once before it sends a message to everybody.
     */
    it("refuses an empty want", () => {
      expect(() => wantedPartsOfDay([])).toThrow(/at least one/i);
    });

    it("refuses something that is not a part of the day", () => {
      expect(() => wantedPartsOfDay(["LUNCHTIME"])).toThrow(/LUNCHTIME/);
    });

    it("accepts every part, which is what 'any time' means", () => {
      expect(wantedPartsOfDay([...PARTS_OF_DAY])).toEqual([...PARTS_OF_DAY]);
    });
  });

  /** A part the calendar never works has nothing to wait for. */
  describe("which parts a calendar works", () => {
    const hours = (from: number, to: number) =>
      interval(localTimeOf(from, 0), localTimeOf(to, 0));

    it("leaves out the evening when the day ends at five", () => {
      expect(partsOfDayOpen([hours(9, 17)])).toEqual(["MORNING", "NOON"]);
    });

    it("counts a part touched by even a little of the hours", () => {
      expect(partsOfDayOpen([hours(11, 12), hours(16, 18)])).toEqual([
        "MORNING",
        "NOON",
        "EVENING",
      ]);
    });

    it("has nothing on a closed day", () => {
      expect(partsOfDayOpen([])).toEqual([]);
    });
  });
});
