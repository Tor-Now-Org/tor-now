import { describe, expect, it } from "vitest";
import { fillParts } from "./fill.ts";

const said = (template: string, values: Record<string, string>) =>
  fillParts(template, values)
    .map((part) => part.text)
    .join("");

describe("filling a sentence without flattening it", () => {
  it("marks the values and leaves the words alone", () => {
    expect(fillParts("You already have {service} on {when}.", {
      service: "a haircut",
      when: "Sunday",
    })).toEqual([
      { text: "You already have ", filled: false },
      { text: "a haircut", filled: true },
      { text: " on ", filled: false },
      { text: "Sunday", filled: true },
      { text: ".", filled: false },
    ]);
  });

  it("reads as the same sentence `.replace` would have produced", () => {
    const template = "כבר יש לכם תור ל{service} עם {provider} ב{when}.";
    const values = { service: "תספורת", provider: "שקד", when: "ראשון" };
    expect(said(template, values)).toBe("כבר יש לכם תור לתספורת עם שקד בראשון.");
  });

  it("drops an empty value without leaving a hole in the words", () => {
    expect(said("A{gap}B", { gap: "" })).toBe("AB");
    expect(fillParts("A{gap}B", { gap: "" }).every((part) => !part.filled)).toBe(true);
  });

  it("leaves a placeholder nobody supplied visible, rather than silently blank", () => {
    // A sentence with a {gap} in it gets reported; one that quietly lost a
    // clause reads as finished prose and never does.
    expect(said("Hello {name}, on {when}", { when: "Sunday" })).toBe("Hello {name}, on Sunday");
  });

  it("handles a template that begins and ends with a value", () => {
    expect(fillParts("{a} and {b}", { a: "one", b: "two" })).toEqual([
      { text: "one", filled: true },
      { text: " and ", filled: false },
      { text: "two", filled: true },
    ]);
  });

  it("has nothing to mark in a sentence with no placeholders", () => {
    expect(fillParts("Nothing to fill.", { a: "x" })).toEqual([
      { text: "Nothing to fill.", filled: false },
    ]);
  });

  it("fills the same placeholder everywhere it appears", () => {
    expect(said("{name} and {name}", { name: "דנה" })).toBe("דנה and דנה");
  });
});
