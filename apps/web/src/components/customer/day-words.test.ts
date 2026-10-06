import { describe, expect, it } from "vitest";
import { DICTIONARIES } from "@/lib/i18n/dictionaries.ts";
import { dayName, markAria, markText, openingText } from "./day-words.ts";
import type { Mark } from "./days-model.ts";

const he = DICTIONARIES.days.he;
const en = DICTIONARIES.days.en;
const WEEKDAYS_HE = DICTIONARIES.customer.he.days;

describe("markText — the line under a date", () => {
  it.each<[Mark, "any" | "morning" | "noon" | "evening", string, string]>([
    [{ kind: "free", count: 7 }, "any", "7 פנויים", "7 free"],
    [{ kind: "free", count: 1 }, "any", "1 פנוי", "1 free"],
    [{ kind: "free", count: 4 }, "evening", "4 בערב", "4 free"],
    [{ kind: "free", count: 2 }, "noon", "2 בצהריים", "2 free"],
    [{ kind: "free", count: 1 }, "morning", "1 בבוקר", "1 free"],
    [{ kind: "noneThen" }, "evening", "אין בערב", "None then"],
    [{ kind: "full" }, "any", "מלא", "Full"],
    [{ kind: "closed" }, "any", "סגור", "Closed"],
    [{ kind: "call" }, "any", "בטלפון", "By phone"],
    [{ kind: "over" }, "any", "הסתיים", "Over"],
    [{ kind: "later", when: { kind: "today" } }, "any", "נפתח היום", "Opens today"],
    [{ kind: "later", when: { kind: "tomorrow" } }, "any", "נפתח מחר", "Opens tomorrow"],
    [{ kind: "later", when: { kind: "on", date: "2026-10-21" } }, "any", "נפתח 21.10", "Opens 21/10"],
    [{ kind: "loading" }, "any", "", ""],
  ])("%j", (mark, part, hebrew, english) => {
    expect(markText(mark, part, he, "he")).toBe(hebrew);
    expect(markText(mark, part, en, "en")).toBe(english);
  });
});

describe("markAria — what a screen reader hears", () => {
  it.each<[Mark, "any" | "morning" | "noon" | "evening", string, string]>([
    [{ kind: "free", count: 7 }, "any", "7 תורים פנויים", "7 free times"],
    [{ kind: "free", count: 1 }, "any", "תור פנוי אחד", "one free time"],
    [{ kind: "free", count: 4 }, "evening", "4 תורים פנויים בערב", "4 free times in the evening"],
    [{ kind: "free", count: 1 }, "noon", "תור פנוי אחד בצהריים", "one free time in the afternoon"],
    [{ kind: "noneThen" }, "morning", "אין תורים פנויים בבוקר", "no free times in the morning"],
    [{ kind: "full" }, "any", "אין תורים פנויים", "no free times"],
    [{ kind: "closed" }, "any", "העסק סגור", "closed"],
    [{ kind: "call" }, "any", "קרוב מדי לקביעה באתר", "too soon to book online"],
    [{ kind: "over" }, "any", "היום הסתיים", "over for today"],
    [{ kind: "later", when: { kind: "tomorrow" } }, "any", "ייפתח לקביעה מחר", "opens for booking tomorrow"],
    [{ kind: "later", when: { kind: "today" } }, "any", "ייפתח לקביעה בהמשך היום", "opens for booking later today"],
    [{ kind: "loading" }, "any", "בודקים מה פנוי", "checking what is free"],
  ])("%j", (mark, part, hebrew, english) => {
    expect(markAria(mark, part, he, "he")).toBe(hebrew);
    expect(markAria(mark, part, en, "en")).toBe(english);
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
