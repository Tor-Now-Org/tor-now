import { describe, expect, it } from "vitest";
import { likelyToStay, tapped } from "./calendar-choice.ts";

const calendars = [
  { id: "ran", upcoming: 4 },
  { id: "dana", upcoming: 2 },
  { id: "yossi", upcoming: 4 },
];

describe("likelyToStay", () => {
  it("chooses the most booked ahead, as many as the allowance holds, oldest first on a tie", () => {
    expect(likelyToStay(calendars, 1)).toEqual(["ran"]);
    expect(likelyToStay(calendars, 2)).toEqual(["ran", "yossi"]);
  });

  it("chooses nothing for no room, and everything for room to spare", () => {
    expect(likelyToStay(calendars, 0)).toEqual([]);
    expect(likelyToStay(calendars, 5)).toHaveLength(3);
  });
});

describe("tapped", () => {
  it("makes the tap the whole choice when one calendar may stay", () => {
    expect(tapped(["ran"], "dana", 1)).toEqual(["dana"]);
  });

  it("toggles when several may stay", () => {
    expect(tapped(["ran"], "dana", 2)).toEqual(["ran", "dana"]);
    expect(tapped(["ran", "dana"], "ran", 2)).toEqual(["dana"]);
  });

  it("adds nothing past the allowance, rather than dropping another", () => {
    expect(tapped(["ran", "dana"], "yossi", 2)).toEqual(["ran", "dana"]);
  });
});
