import { describe, expect, it } from "vitest";
import { DICTIONARIES } from "./i18n/dictionaries.ts";
import { spanOfDays, spanOfMinutes } from "./span-text.ts";

const he = DICTIONARIES.days.he;
const en = DICTIONARIES.days.en;

describe("spanOfMinutes — a notice said the way a person says it", () => {
  it.each([
    [1440, "יום", "a day"],
    [2880, "יומיים", "2 days"],
    [4320, "3 ימים", "3 days"],
    [43200, "30 ימים", "30 days"],
    [60, "שעה", "an hour"],
    [120, "שעתיים", "2 hours"],
    [180, "3 שעות", "3 hours"],
    [1500, "25 שעות", "25 hours"],
    [1, "דקה", "a minute"],
    [45, "45 דקות", "45 minutes"],
    [1441, "1441 דקות", "1441 minutes"],
    [0, "0 דקות", "0 minutes"],
  ])("%i minutes", (minutes, hebrew, english) => {
    expect(spanOfMinutes(minutes, he)).toBe(hebrew);
    expect(spanOfMinutes(minutes, en)).toBe(english);
  });
});

describe("spanOfDays", () => {
  it.each([
    [1, "יום", "a day"],
    [2, "יומיים", "2 days"],
    [7, "7 ימים", "7 days"],
    [365, "365 ימים", "365 days"],
  ])("%i days", (count, hebrew, english) => {
    expect(spanOfDays(count, he)).toBe(hebrew);
    expect(spanOfDays(count, en)).toBe(english);
  });
});
