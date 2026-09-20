import { describe, expect, it } from "vitest";
import { parseInstant } from "../time/instant.ts";
import { timeZone } from "../time/zone.ts";
import type { ResourceId } from "../model/ids.ts";
import type { Slot } from "./slots.ts";
import { openingFor, waitsOn, type WaitingWant } from "./waiting.ts";

const JERUSALEM = timeZone("Asia/Jerusalem");
const chair = (name: string) => name as ResourceId;

const at = (local: string): Slot => ({
  startAt: parseInstant(local),
  endAt: parseInstant(local),
});

const want = (over: Partial<WaitingWant> = {}): WaitingWant => ({
  resourceIds: [chair("ran")],
  parts: ["MORNING"],
  ...over,
});

/**
 * Whether a freed stretch answers somebody's standing question.
 *
 * Everything hard about availability — Minimum Notice, Buffers, the Booking
 * Horizon, Blocks, Date Overrides — has already been decided by the time these
 * Slots exist. This is the last, small question: of the times this Resource is
 * now offering, is any of them in a part of the day somebody asked about?
 */
describe("what answers a Waiting Entry", () => {
  it("is answered by a slot in a part of the day that was asked for", () => {
    expect(
      openingFor(want({ parts: ["MORNING"] }), [at("2026-09-21T06:00:00.000Z")], JERUSALEM),
    ).not.toBeNull(); // 09:00 local
  });

  it("is not answered by a slot in a part that was not asked for", () => {
    expect(
      openingFor(want({ parts: ["MORNING"] }), [at("2026-09-21T15:00:00.000Z")], JERUSALEM),
    ).toBeNull(); // 18:00 local
  });

  it("is not answered by a day with no times at all", () => {
    expect(openingFor(want(), [], JERUSALEM)).toBeNull();
  });

  /**
   * The message names a part of the day, so it has to know which one — and
   * with several wanted parts free at once, the earliest is the one a person
   * would call "the opening".
   */
  it("reports the earliest answering time, and the part it falls in", () => {
    const opening = openingFor(
      want({ parts: ["MORNING", "EVENING"] }),
      [
        at("2026-09-21T15:00:00.000Z"), // 18:00, evening
        at("2026-09-21T06:30:00.000Z"), // 09:30, morning
        at("2026-09-21T07:00:00.000Z"), // 10:00, morning
      ],
      JERUSALEM,
    );

    expect(opening).not.toBeNull();
    expect(opening!.part).toBe("MORNING");
    expect(opening!.startAt).toBe(parseInstant("2026-09-21T06:30:00.000Z"));
  });

  it("ignores times in the middle of the day when only the ends were asked for", () => {
    expect(
      openingFor(
        want({ parts: ["MORNING", "EVENING"] }),
        [at("2026-09-21T11:00:00.000Z")], // 14:00, noon
        JERUSALEM,
      ),
    ).toBeNull();
  });

  /**
   * "Any time" is every part, so it is answered by whatever comes first. This
   * is the same code path, which is the point of not giving "any" its own
   * encoding.
   */
  it("treats wanting every part as wanting the first free hour", () => {
    const opening = openingFor(
      want({ parts: ["MORNING", "NOON", "EVENING"] }),
      [at("2026-09-21T11:00:00.000Z")],
      JERUSALEM,
    );
    expect(opening!.part).toBe("NOON");
  });

  describe("which calendars it accepts", () => {
    it("waits on a calendar it named", () => {
      expect(waitsOn(want({ resourceIds: [chair("ran"), chair("shimi")] }), chair("shimi")))
        .toBe(true);
    });

    it("does not wait on a calendar it did not name", () => {
      expect(waitsOn(want({ resourceIds: [chair("ran")] }), chair("shimi"))).toBe(false);
    });

    /**
     * A customer who said "either of them" is answered by whichever frees
     * first — one entry, several calendars, and the first one to open wins.
     * The alternative, an entry per calendar, would notify the same person
     * twice when a whole morning is cancelled.
     */
    it("is answered by whichever named calendar frees first", () => {
      const either = want({ resourceIds: [chair("ran"), chair("shimi")] });
      expect(waitsOn(either, chair("ran"))).toBe(true);
      expect(waitsOn(either, chair("shimi"))).toBe(true);
    });
  });
});
