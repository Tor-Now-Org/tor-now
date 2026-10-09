import { describe, expect, it } from "vitest";
import { CARD, linesFor, nameSetting } from "./qr-card.ts";

/** Every letter as wide as half the size, which is near enough for the rules. */
const byLetters = (perLetter: number) => (text: string) => Array.from(text).length * perLetter;
const atSize = (size: number) => byLetters(size / 2);

describe("breaking a line of text", () => {
  it("keeps a text that fits on one line", () => {
    expect(linesFor("מספרת דנה", 100, byLetters(10), 2)).toEqual(["מספרת דנה"]);
  });
  it("breaks between words", () => {
    expect(linesFor("one two three", 70, byLetters(10), 3)).toEqual(["one two", "three"]);
  });
  it("cuts a word too long for any line by its letters", () => {
    expect(linesFor("abcdefghij", 40, byLetters(10), 5)).toEqual(["abcd", "efgh", "ij"]);
  });
  it("ends the last line with an ellipsis when there is more than fits", () => {
    const lines = linesFor("one two three four five six", 70, byLetters(10), 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.endsWith("…")).toBe(true);
    expect(lines.every((line) => Array.from(line).length * 10 <= 70)).toBe(true);
  });
  it("ignores extra spaces, and has nothing for an empty text or no lines", () => {
    expect(linesFor("  a   b  ", 100, byLetters(10), 2)).toEqual(["a b"]);
    expect(linesFor("   ", 100, byLetters(10), 2)).toEqual([]);
    expect(linesFor("a", 100, byLetters(10), 0)).toEqual([]);
  });
});

describe("setting the business's name", () => {
  const width = CARD.width - 96 * 2;
  it("sets a short name large, on one line", () => {
    expect(nameSetting("מספרת דנה", width, atSize)).toEqual({ size: 92, lines: ["מספרת דנה"] });
  });
  it("makes a longer name smaller before it breaks it", () => {
    // 26 letters: too wide at 92 (1196) and 80 (1040), fits at 68 (884)? 26*34 = 884 < 1048.
    const name = "abcdefghijklm nopqrstuvwxy";
    const setting = nameSetting(name, width, atSize);
    expect(setting.lines).toHaveLength(1);
    expect(setting.size).toBeLessThan(92);
  });
  it("breaks a long name into two lines rather than shrinking it to nothing", () => {
    const name = "המרכז הישראלי לטיפולי פנים וגוף מתקדמים";
    const setting = nameSetting(name, width, atSize);
    expect(setting.lines.length).toBeLessThanOrEqual(2);
    expect(setting.lines.join(" ")).toBe(name);
    expect(setting.size).toBeGreaterThanOrEqual(58);
  });
  it("cuts a name too long even for two small lines, and says so with an ellipsis", () => {
    const name = "word ".repeat(40).trim();
    const setting = nameSetting(name, width, atSize);
    expect(setting.size).toBe(58);
    expect(setting.lines).toHaveLength(2);
    expect(setting.lines[1]?.endsWith("…")).toBe(true);
  });
  it("is A6 at 300 dots per inch, upright", () => {
    expect(CARD).toEqual({ width: 1240, height: 1748 });
  });
});
