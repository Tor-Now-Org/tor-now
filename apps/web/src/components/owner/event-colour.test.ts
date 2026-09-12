import { describe, expect, it } from "vitest";
import { EVENT_HUES, LANE_COLOURS, colourOf, hueIndexOf, laneColourOf } from "./event-colour.ts";

describe("the colour a service keeps", () => {
  it("gives the same service the same colour every time it is asked", () => {
    expect(colourOf("תספורת")).toEqual(colourOf("תספורת"));
  });

  it("does not depend on what else is on that day", () => {
    // The whole bug: the colour used to be a position in the day's list, so a
    // haircut changed colour on the day a dye job was booked before it.
    const alone = colourOf("תספורת + זקן");
    const inCompany = ["צבע לשיער", "תספורת + זקן"].map(colourOf)[1];
    expect(inCompany).toEqual(alone);
  });

  it("names a hue that the stylesheet actually defines", () => {
    // The other half of the bug: --plum and --moss were never defined, so
    // every service after the first drew with no colour at all.
    const names = ["תספורת", "צבע", "פן", "עיצוב זקן", "החלקה", "טיפול פנים", "ציפורניים"];
    names.forEach((name) => {
      const { ground, rail } = colourOf(name);
      expect(rail).toMatch(/^var\(--event-[1-6]\)$/);
      expect(ground).toMatch(/^var\(--event-[1-6]-soft\)$/);
    });
  });

  it("keeps every hue inside the palette", () => {
    const indexes = Array.from({ length: 200 }, (_unused, at) => hueIndexOf(`service ${at}`));
    expect(Math.min(...indexes)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...indexes)).toBeLessThan(EVENT_HUES);
  });

  it("uses more than one of them across a realistic list", () => {
    const used = new Set(
      ["תספורת", "צבע לשיער", "פן", "החלקה", "זקן", "גוונים"].map(hueIndexOf),
    );
    expect(used.size).toBeGreaterThan(1);
  });

  it("ignores surrounding space, which a typed name often carries", () => {
    expect(hueIndexOf(" תספורת ")).toBe(hueIndexOf("תספורת"));
  });

  it("gives a calendar a colour from its own set, never a service's", () => {
    // A lane mark sits beside the appointments it marks; drawn from the same
    // palette it reads as one more service rather than as whose calendar it is.
    const lanes = Array.from({ length: LANE_COLOURS }, (_unused, at) => laneColourOf(at));
    lanes.forEach((lane) => expect(lane).toMatch(/^var\(--lane-[1-4]\)$/));
    expect(new Set(lanes).size).toBe(LANE_COLOURS);
  });

  it("wraps a calendar's colour round its set rather than running off it", () => {
    expect(laneColourOf(0)).toBe("var(--lane-1)");
    expect(laneColourOf(LANE_COLOURS)).toBe("var(--lane-1)");
    expect(laneColourOf(LANE_COLOURS + 2)).toBe("var(--lane-3)");
  });

  it("gives a calendar it does not recognise the first colour, not a crash", () => {
    // A blockage can belong to a chair this screen cannot see.
    expect(laneColourOf(-1)).toBe("var(--lane-1)");
  });
});
