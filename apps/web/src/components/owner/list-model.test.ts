import { describe, expect, it } from "vitest";
import {
  byName,
  letterOf,
  LETTERS_FROM,
  MONTHS_FROM,
  serviceLine,
  standingCounts,
  UPCOMING_SHOWN,
  upcomingLine,
  upcomingShown,
  withLetters,
  withMonths,
} from "./list-model.ts";

const WORDS = {
  minutes: "{n} דק׳",
  noPrice: "בלי מחיר",
  recovery: "ועוד {n} דק׳ התאוששות",
  recoveryBusiness: "ועוד {n} דק׳ התאוששות של העסק",
};
const shekels = (minor: number) => `${minor / 100} ₪`;

describe("the line under a service", () => {
  it("says its length and price", () => {
    expect(serviceLine({ durationMinutes: 30, priceMinor: 8000, bufferMinutes: null }, 0, WORDS, shekels)).toBe("30 דק׳ · 80 ₪");
  });
  it("says a free service has no price, rather than a dash", () => {
    expect(serviceLine({ durationMinutes: 15, priceMinor: 0, bufferMinutes: null }, 0, WORDS, shekels)).toBe("15 דק׳ · בלי מחיר");
  });
  it("adds its own recovery time", () => {
    expect(serviceLine({ durationMinutes: 90, priceMinor: 25000, bufferMinutes: 15 }, 0, WORDS, shekels)).toBe(
      "90 דק׳ · 250 ₪ · ועוד 15 דק׳ התאוששות",
    );
  });
  it("says when the recovery is the business's, and only when there is some", () => {
    expect(serviceLine({ durationMinutes: 30, priceMinor: 8000, bufferMinutes: null }, 10, WORDS, shekels)).toBe(
      "30 דק׳ · 80 ₪ · ועוד 10 דק׳ התאוששות של העסק",
    );
    expect(serviceLine({ durationMinutes: 30, priceMinor: 8000, bufferMinutes: null }, 0, WORDS, shekels)).toBe("30 דק׳ · 80 ₪");
  });
  it("says nothing of recovery for a service set to none, whatever the business keeps", () => {
    expect(serviceLine({ durationMinutes: 30, priceMinor: 8000, bufferMinutes: 0 }, 10, WORDS, shekels)).toBe("30 דק׳ · 80 ₪");
  });
});

describe("a calendar's appointments still to come", () => {
  const words = { upcomingMany: "{n} תורים קרובים", upcomingOne: "תור קרוב אחד", upcomingNone: "אין תורים קרובים" };
  it("counts them, one, or none", () => {
    expect(upcomingLine(12, words)).toBe("12 תורים קרובים");
    expect(upcomingLine(2, words)).toBe("2 תורים קרובים");
    expect(upcomingLine(1, words)).toBe("תור קרוב אחד");
    expect(upcomingLine(0, words)).toBe("אין תורים קרובים");
  });
  it("says nothing when the count is unknown, rather than none", () => {
    expect(upcomingLine(undefined, words)).toBeNull();
  });
});

describe("people in order", () => {
  it("files Hebrew names the way a phone book does", () => {
    const sorted = byName([{ name: "גלית רז" }, { name: "אורי שמש" }, { name: "בן דוד" }, { name: "אביגיל פרץ" }], "he");
    expect(sorted.map((person) => person.name)).toEqual(["אביגיל פרץ", "אורי שמש", "בן דוד", "גלית רז"]);
  });
  it("ignores case, spaces around a name and accents, and counts numbers as numbers", () => {
    const sorted = byName([{ name: "dana" }, { name: "  Avi" }, { name: "Élan" }, { name: "Chair 10" }, { name: "Chair 2" }], "en");
    expect(sorted.map((person) => person.name)).toEqual(["  Avi", "Chair 2", "Chair 10", "dana", "Élan"]);
  });
  it("does not change the list it was given", () => {
    const people = [{ name: "ב" }, { name: "א" }];
    byName(people, "he");
    expect(people.map((person) => person.name)).toEqual(["ב", "א"]);
  });
});

describe("letters before each first letter", () => {
  const named = (...names: string[]) => names.map((name) => ({ name }));

  it("are left out of a short list", () => {
    const short = named(...Array.from({ length: LETTERS_FROM - 1 }, (_unused, i) => `א${i}`));
    expect(withLetters(short).every((entry) => entry.kind === "row")).toBe(true);
  });
  it("head each new letter once the list is long", () => {
    const long = named("אבי", "אורי", "בן", "ברק", "גל", "דנה", "הדר", "ורד", "זיו", "חן", "טל", "יעל", "כרמל");
    const out = withLetters(long);
    expect(out.filter((entry) => entry.kind === "letter").map((entry) => (entry.kind === "letter" ? entry.text : ""))).toEqual([
      "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט", "י", "כ",
    ]);
    expect(out[0]).toEqual({ kind: "letter", text: "א" });
    expect(out[1]).toEqual({ kind: "row", item: { name: "אבי" } });
    expect(out.filter((entry) => entry.kind === "row")).toHaveLength(long.length);
  });
  it("file a name that does not start with a letter under #, and Latin names by capital", () => {
    expect(letterOf("  dana")).toBe("D");
    expect(letterOf("Élan")).toBe("É");
    expect(letterOf("123 שירות")).toBe("#");
    expect(letterOf("")).toBe("#");
    expect(letterOf("“דנה”")).toBe("#");
  });
});

describe("the filter's counts", () => {
  it("say how many each holds", () => {
    expect(standingCounts([{ blocked: false }, { blocked: true }, { blocked: false }])).toEqual({ all: 3, active: 2, blocked: 1 });
    expect(standingCounts([])).toEqual({ all: 0, active: 0, blocked: 0 });
  });
});

describe("upcoming appointments on a customer's page", () => {
  const upcoming = (n: number) => Array.from({ length: n }, (_unused, i) => i + 1);

  it("has nothing to show with none", () => {
    expect(upcomingShown([], false)).toEqual({ next: null, rest: [], folded: 0, foldable: false });
  });
  it("shows all of up to three, with nothing to fold", () => {
    expect(upcomingShown(upcoming(1), false)).toEqual({ next: 1, rest: [], folded: 0, foldable: false });
    expect(upcomingShown(upcoming(UPCOMING_SHOWN), false)).toEqual({ next: 1, rest: [2, 3], folded: 0, foldable: false });
  });
  it("shows three and folds the rest past three", () => {
    expect(upcomingShown(upcoming(4), false)).toEqual({ next: 1, rest: [2, 3], folded: 1, foldable: true });
    expect(upcomingShown(upcoming(7), false)).toEqual({ next: 1, rest: [2, 3], folded: 4, foldable: true });
  });
  it("shows them all once opened, and stays foldable", () => {
    expect(upcomingShown(upcoming(7), true)).toEqual({ next: 1, rest: [2, 3, 4, 5, 6, 7], folded: 0, foldable: true });
  });
  it("ignores opening when there is nothing to fold", () => {
    expect(upcomingShown(upcoming(2), true)).toEqual({ next: 1, rest: [2], folded: 0, foldable: false });
  });
});

describe("a history by month", () => {
  const month = (item: { month: string }) => item.month;
  it("is a plain list while it is short", () => {
    const short = Array.from({ length: MONTHS_FROM - 1 }, () => ({ month: "אוקטובר" }));
    expect(withMonths(short, month).every((entry) => entry.kind === "row")).toBe(true);
  });
  it("heads each month once it is long, in the order it was given", () => {
    const long = [
      ...Array.from({ length: 5 }, () => ({ month: "אוקטובר 2026" })),
      ...Array.from({ length: 6 }, () => ({ month: "ספטמבר 2026" })),
      ...Array.from({ length: 2 }, () => ({ month: "אוגוסט 2026" })),
    ];
    const out = withMonths(long, month);
    expect(out.filter((entry) => entry.kind === "month").map((entry) => (entry.kind === "month" ? entry.text : ""))).toEqual([
      "אוקטובר 2026", "ספטמבר 2026", "אוגוסט 2026",
    ]);
    expect(out).toHaveLength(long.length + 3);
    expect(out[0]).toEqual({ kind: "month", text: "אוקטובר 2026" });
    expect(out[6]).toEqual({ kind: "month", text: "ספטמבר 2026" });
  });
});
