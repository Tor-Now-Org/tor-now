import { describe, expect, it } from "vitest";
import {
  BOX_MINIMUM,
  columnsOf,
  FOLD_HEIGHT,
  bandsOf,
  foldsIn,
  minutesOf,
  placeOf,
  scaleOf,
  sharedFree,
  spokenLength,
  swallowedBy,
  windowOf,
  withoutSpan,
} from "./day-model.ts";

const at = (clock: string) => minutesOf(clock);
const span = (from: string, to: string) => ({ start: at(from), end: at(to) });

describe("the window a day is drawn in", () => {
  it("is the hours worked, with an hour either side", () => {
    expect(windowOf([{ start: "09:00", end: "17:00" }], [])).toEqual({
      start: at("08:00"),
      end: at("18:00"),
    });
  });

  it("stretches to hold anything outside them", () => {
    // A blockage before opening is still part of the day being looked at.
    expect(windowOf([{ start: "09:00", end: "17:00" }], [span("07:30", "08:00")])).toEqual({
      start: at("06:00"),
      end: at("18:00"),
    });
  });

  it("has something to say about a day with no hours at all", () => {
    expect(windowOf([], [])).toEqual({ start: at("09:00"), end: at("17:00") });
  });
});

describe("what may fold", () => {
  const window = { start: at("08:00"), end: at("20:00") };

  it("is only time where nobody is busy", () => {
    // One calendar free all afternoon and another booked in it: folding would
    // hide the second one's appointment behind the first one's quiet.
    const busy = [span("09:00", "10:00"), span("14:00", "15:00")];
    const folds = foldsIn(window, busy, []);
    expect(folds).toEqual([
      { start: at("10:00"), end: at("14:00") },
      { start: at("15:00"), end: at("20:00") },
    ]);
    expect(sharedFree(window, busy)[0]).toEqual({ start: at("08:00"), end: at("09:00") });
  });

  it("leaves short gaps alone — an hour is not worth folding", () => {
    // 08:00–09:00 and 10:00–11:00 are an hour each, under the threshold.
    expect(foldsIn(window, [span("09:00", "10:00"), span("11:00", "20:00")], [])).toEqual([]);
  });

  it("stays open once it has been opened", () => {
    const busy = [span("12:00", "13:00")];
    // Both sides are long enough to fold; the morning has been opened by hand.
    expect(foldsIn(window, busy, [])).toHaveLength(2);
    expect(foldsIn(window, busy, [at("08:00")])).toEqual([
      { start: at("13:00"), end: at("20:00") },
    ]);
  });
});

describe("the scale every lane shares", () => {
  const window = { start: at("08:00"), end: at("20:00") };
  const folds = [{ start: at("10:00"), end: at("16:00") }];
  const scale = scaleOf(window, folds);

  it("is a pixel a minute where nothing is folded", () => {
    expect(scale.y(at("08:00"))).toBe(0);
    expect(scale.y(at("09:00"))).toBe(60);
  });

  it("spends one band's worth of height on a fold, however long it is", () => {
    // Six hours folded cost what the band costs, not 360 pixels.
    expect(scale.y(at("16:00"))).toBe(120 + FOLD_HEIGHT);
    expect(scale.y(at("17:00"))).toBe(120 + FOLD_HEIGHT + 60);
  });

  it("knows which hours the fold swallowed, so the rail can skip them", () => {
    expect(swallowedBy(folds, at("12:00"))).toBe(true);
    expect(swallowedBy(folds, at("10:00"))).toBe(false);
    expect(swallowedBy(folds, at("17:00"))).toBe(false);
  });

  it("is the same mapping for every lane, so an hour is level across them", () => {
    const another = scaleOf(window, folds);
    expect(another.y(at("17:00"))).toBe(scale.y(at("17:00")));
  });
});

describe("bands, and where they are drawn", () => {
  const window = { start: at("09:00"), end: at("12:00") };
  const items = [span("09:00", "09:45"), span("09:55", "10:55")];
  const bands = bandsOf(window, items);
  const scale = scaleOf(window, []);

  it("name the holes between things", () => {
    expect(bands.map((band) => band.kind)).toEqual(["item", "free", "item", "free"]);
    expect(bands[1]).toMatchObject({ start: at("09:45"), end: at("09:55") });
  });

  it("never reach into the space of the next one", () => {
    // The ten-minute gap is ten minutes tall, not the twenty-two a minimum
    // height would have given it — which is what used to climb onto 09:55.
    const gap = placeOf(bands, 1, scale);
    expect(gap.height).toBeLessThan(BOX_MINIMUM);
    const after = placeOf(bands, 2, scale);
    expect(gap.top + gap.height).toBeLessThanOrEqual(after.top);
  });

  it("hold their own length where there is room", () => {
    const first = placeOf(bands, 0, scale);
    expect(first.height).toBe(45 - 2);
  });

  it("stop at the end of the day", () => {
    const last = placeOf(bands, bands.length - 1, scale);
    expect(last.top + last.height).toBeLessThanOrEqual(scale.height);
  });
});

describe("a length of time, said", () => {
  const words = {
    hour: "שעה",
    twoHours: "שעתיים",
    hours: "שעות",
    andHalf: "וחצי",
    minutes: "דק׳",
  };

  it("uses the dual, which Hebrew has and English does not", () => {
    expect(spokenLength(120, words)).toBe("שעתיים");
    expect(spokenLength(60, words)).toBe("שעה");
    expect(spokenLength(180, words)).toBe("3 שעות");
  });

  it("says a half rather than thirty minutes", () => {
    expect(spokenLength(90, words)).toBe("שעה וחצי");
  });

  it("says minutes when that is all there is", () => {
    expect(spokenLength(20, words)).toBe("20 דק׳");
  });
});

describe("closing part of a day", () => {
  const nineToFive = [{ start: "09:00", end: "17:00" }];

  it("keeps the hours either side, which is a break", () => {
    expect(withoutSpan(nineToFive, span("13:00", "14:00"))).toEqual([
      { start: "09:00", end: "13:00" },
      { start: "14:00", end: "17:00" },
    ]);
  });

  it("shortens the day when the stretch runs off an end", () => {
    expect(withoutSpan(nineToFive, span("15:00", "19:00"))).toEqual([
      { start: "09:00", end: "15:00" },
    ]);
    expect(withoutSpan(nineToFive, span("07:00", "11:00"))).toEqual([
      { start: "11:00", end: "17:00" },
    ]);
  });

  it("closes the day outright when the stretch covers it", () => {
    expect(withoutSpan(nineToFive, span("08:00", "18:00"))).toEqual([]);
  });

  it("leaves hours it does not touch alone", () => {
    const withBreak = [
      { start: "09:00", end: "13:00" },
      { start: "16:00", end: "20:00" },
    ];
    expect(withoutSpan(withBreak, span("17:00", "18:00"))).toEqual([
      { start: "09:00", end: "13:00" },
      { start: "16:00", end: "17:00" },
      { start: "18:00", end: "20:00" },
    ]);
  });
});

describe("things that overlap in a lane", () => {
  const window = { start: at("08:00"), end: at("20:00") };
  const scale = scaleOf(window, []);

  it("keeps a day-long blockage its own length, not the next appointment's", () => {
    // The bug this replaced: a day off drawn as if it ended at ten, because
    // that is when the first appointment inside it began.
    const items = [span("08:00", "20:00"), span("10:00", "10:30")];
    const bands = bandsOf(window, items);
    const blockage = bands.findIndex(
      (band) => band.kind === "item" && band.start === at("08:00"),
    );
    expect(placeOf(bands, blockage, scale).height).toBe(12 * 60 - 2);
  });

  it("still clamps free space, which must never climb onto its neighbour", () => {
    const bands = bandsOf(window, [span("09:00", "09:30"), span("09:40", "10:00")]);
    const gap = bands.findIndex((band) => band.kind === "free" && band.start === at("09:30"));
    const place = placeOf(bands, gap, scale);
    const after = placeOf(bands, gap + 1, scale);
    expect(place.top + place.height).toBeLessThanOrEqual(after.top);
  });

  it("shares the width between things happening at once", () => {
    const blockage = span("08:00", "20:00");
    const appointment = span("10:00", "10:30");
    const columns = columnsOf([blockage, appointment]);
    expect(columns.get(blockage)).toEqual({ column: 0, columns: 2 });
    expect(columns.get(appointment)).toEqual({ column: 1, columns: 2 });
  });

  it("gives the whole width to anything standing alone", () => {
    const one = span("09:00", "09:30");
    const two = span("11:00", "11:30");
    const columns = columnsOf([one, two]);
    expect(columns.get(one)).toEqual({ column: 0, columns: 1 });
    expect(columns.get(two)).toEqual({ column: 0, columns: 1 });
  });

  it("reuses a column once its last thing has finished", () => {
    // Three in a row inside one long blockage: they take turns in column two
    // rather than making the lane four columns wide.
    const all = [
      span("08:00", "20:00"),
      span("09:00", "09:30"),
      span("10:00", "10:30"),
      span("11:00", "11:30"),
    ];
    const columns = columnsOf(all);
    expect(new Set([...columns.values()].map((one) => one.columns))).toEqual(new Set([2]));
  });
});
