import { describe, expect, it } from "vitest";
import { survivesHours } from "./closure.ts";
import { interval } from "../time/interval.ts";
import { parseLocalTime } from "../time/local-time.ts";

const t = parseLocalTime;
const at = (start: string, end: string) => interval(t(start), t(end));

describe("what a change of hours leaves standing", () => {
  it("keeps an appointment the remaining hours still hold", () => {
    expect(survivesHours(at("10:00", "10:45"), [at("09:00", "13:00")])).toBe(true);
  });

  it("strands one that starts before the hours kept", () => {
    expect(survivesHours(at("08:30", "09:30"), [at("09:00", "13:00")])).toBe(false);
  });

  it("strands one that runs past them", () => {
    expect(survivesHours(at("12:30", "13:30"), [at("09:00", "13:00")])).toBe(false);
  });

  it("strands everything when the day keeps no hours at all", () => {
    expect(survivesHours(at("10:00", "10:45"), [])).toBe(false);
  });

  it("does not strand an appointment across a seam between touching ranges", () => {
    // Two rows that meet are a day open right through, not a day with a break
    // at noon — the split is in how the hours were typed, not in the shop.
    expect(
      survivesHours(at("11:45", "12:15"), [at("09:00", "12:00"), at("12:00", "17:00")]),
    ).toBe(true);
  });

  it("strands an appointment sitting in a real break", () => {
    expect(
      survivesHours(at("13:15", "13:45"), [at("09:00", "13:00"), at("14:00", "17:00")]),
    ).toBe(false);
  });

  it("holds one that ends exactly when the shop does", () => {
    expect(survivesHours(at("16:30", "17:00"), [at("09:00", "17:00")])).toBe(true);
  });
});
