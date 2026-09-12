import { describe, expect, it } from "vitest";
import { EVENT_HUES, colourOf, hueIndexOf, markColourOf } from "./event-colour.ts";

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

  it("wraps a calendar's mark round the palette rather than running off it", () => {
    expect(markColourOf(0)).toBe("var(--event-1)");
    expect(markColourOf(EVENT_HUES)).toBe("var(--event-1)");
    expect(markColourOf(EVENT_HUES + 2)).toBe("var(--event-3)");
  });
});
