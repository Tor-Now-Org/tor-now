import { describe, expect, it } from "vitest";
import { cleanNumberText } from "./number-text.ts";

describe("cleanNumberText — what a number box keeps of what is typed", () => {
  it.each([
    ["080", "80"],
    ["0080", "80"],
    ["007", "7"],
    ["0", "0"],
    ["00", "0"],
    ["000", "0"],
    ["80", "80"],
    ["100", "100"],
    ["", ""],
  ])("whole numbers: %j becomes %j", (typed, kept) => {
    expect(cleanNumberText(typed, false)).toBe(kept);
  });

  it.each([
    ["8a0", "80"],
    ["-5", "5"],
    ["1e3", "13"],
    [" 45 ", "45"],
    ["1,000", "1000"],
    ["12.5", "125"],
  ])("ignores what is not a digit: %j becomes %j", (typed, kept) => {
    expect(cleanNumberText(typed, false)).toBe(kept);
  });

  it.each([
    ["12.5", "12.5"],
    ["0.5", "0.5"],
    ["00.5", "0.5"],
    ["080.50", "80.50"],
    [".5", "0.5"],
    ["1.2.3", "1.23"],
    ["12.", "12."],
    ["0.", "0."],
  ])("with a decimal point allowed: %j becomes %j", (typed, kept) => {
    expect(cleanNumberText(typed, true)).toBe(kept);
  });
});
