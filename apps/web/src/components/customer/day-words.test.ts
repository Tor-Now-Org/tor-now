import { describe, expect, it } from "vitest";
import { DICTIONARIES } from "@/lib/i18n/dictionaries.ts";
import { dayName, markAria, markText, openingText } from "./day-words.ts";
import type { Mark } from "./days-model.ts";

const he = DICTIONARIES.days.he;
const en = DICTIONARIES.days.en;
const WEEKDAYS_HE = DICTIONARIES.customer.he.days;

describe("markText — the line under a date", () => {
  it.each<[Mark, string, string]>([
    [{ kind: "free", count: 7 }, "7 פנויים", "7 free"],
    [{ kind: "free", count: 1 }, "1 פנוי", "1 free"],
    [{ kind: "full" }, "מלא", "Full"],
    [{ kind: "closed" }, "סגור", "Closed"],
    [{ kind: "call" }, "בטלפון", "By phone"],
    [{ kind: "over" }, "הסתיים", "Over"],
    [{ kind: "later", when: { kind: "today" } }, "נפתח היום", "Opens today"],
    [{ kind: "later", when: { kind: "tomorrow" } }, "נפתח מחר", "Opens tomorrow"],
    [{ kind: "later", when: { kind: "on", date: "2026-10-21" } }, "נפתח 21.10", "Opens 21/10"],
    [{ kind: "loading" }, "", ""],
  ])("%j", (mark, hebrew, english) => {
    expect(markText(mark, he, "he")).toBe(hebrew);
    expect(markText(mark, en, "en")).toBe(english);
  });
});

describe("markAria — what a screen reader hears", () => {
  it.each<[Mark, string, string]>([
    [{ kind: "free", count: 7 }, "7 תורים פנויים", "7 free times"],
    [{ kind: "free", count: 1 }, "תור פנוי אחד", "one free time"],
    [{ kind: "full" }, "אין תורים פנויים", "no free times"],
    [{ kind: "closed" }, "העסק סגור", "closed"],
    [{ kind: "call" }, "קרוב מדי לקביעה באתר", "too soon to book online"],
    [{ kind: "over" }, "היום הסתיים", "over for today"],
    [{ kind: "later", when: { kind: "tomorrow" } }, "ייפתח לקביעה מחר", "opens for booking tomorrow"],
    [{ kind: "later", when: { kind: "today" } }, "ייפתח לקביעה בהמשך היום", "opens for booking later today"],
    [{ kind: "loading" }, "בודקים מה פנוי", "checking what is free"],
  ])("%j", (mark, hebrew, english) => {
    expect(markAria(mark, he, "he")).toBe(hebrew);
    expect(markAria(mark, en, "en")).toBe(english);
  });
});

describe("openingText — when, in a sentence", () => {
  it("says later today, tomorrow, or the date", () => {
    expect(openingText({ kind: "today" }, he, "he")).toBe("בהמשך היום");
    expect(openingText({ kind: "tomorrow" }, he, "he")).toBe("מחר");
    expect(openingText({ kind: "on", date: "2026-10-21" }, he, "he")).toBe("ב-21.10");
    expect(openingText({ kind: "on", date: "2026-10-21" }, en, "en")).toBe("on 21/10");
  });
});

describe("dayName — how a day is named to a screen reader", () => {
  it("names today as today", () => {
    expect(dayName("2026-10-06", "2026-10-06", WEEKDAYS_HE, "היום", he, "he")).toBe("היום 6.10");
  });

  it("names another day by its weekday", () => {
    expect(dayName("2026-10-13", "2026-10-06", WEEKDAYS_HE, "היום", he, "he")).toBe("יום שלישי 13.10");
  });

  it("names it in English without the Hebrew word for day", () => {
    expect(dayName("2026-10-13", "2026-10-06", DICTIONARIES.customer.en.days, "Today", en, "en")).toBe("Tuesday 13/10");
  });
});
