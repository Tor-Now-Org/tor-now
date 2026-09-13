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
    const inCompany = ["צבע לשיער", "תספורת + זקן"].map((one) => colourOf(one))[1];
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
    // The list the business itself offers, which is what a colour is taken
    // from: six services, six colours, no two alike. A hash of the name was
    // the first answer and it put צבע לשיער and פן on the same blue.
    const offered = ["תספורת", "צבע לשיער", "פן", "החלקה", "זקן", "גוונים"];
    const used = new Set(offered.map((one) => hueIndexOf(one, offered)));
    expect(used.size).toBe(offered.length);
  });

  it("ignores surrounding space, which a typed name often carries", () => {
    expect(hueIndexOf(" תספורת ")).toBe(hueIndexOf("תספורת"));
    expect(hueIndexOf(" פן ", ["תספורת", "פן"])).toBe(1);
  });

  it("falls back to the name for a service the list has never heard of", () => {
    // An appointment keeps the name it was booked under, so a service since
    // renamed or removed still turns up on a day and still needs a colour.
    const offered = ["תספורת", "פן"];
    expect(colourOf("שירות שנמחק", offered)).toEqual(colourOf("שירות שנמחק"));
  });

  it("keeps a service's colour the same whatever else is on the day", () => {
    const offered = ["תספורת", "צבע לשיער", "פן"];
    expect(colourOf("פן", offered)).toEqual(colourOf("פן", offered));
    // And the position is the business's list, not the day's — so a day with
    // only "פן" on it draws it the same colour as a day full of everything.
    expect(hueIndexOf("פן", offered)).toBe(2);
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
