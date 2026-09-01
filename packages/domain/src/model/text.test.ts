import { describe, expect, it } from "vitest";
import { TEXT_RULES, checkPhone, checkText } from "./text.ts";

describe("text fields", () => {
  it("calls an empty required field missing rather than too short", () => {
    expect(checkText("", TEXT_RULES.businessName)).toBe("REQUIRED");
    expect(checkText("   ", TEXT_RULES.businessName)).toBe("REQUIRED");
  });

  it("lets an optional field be empty", () => {
    expect(checkText("", TEXT_RULES.address)).toBeNull();
  });

  it("measures what is left after trimming, not what was typed", () => {
    expect(checkText("  a  ", TEXT_RULES.businessName)).toBe("TOO_SHORT");
    expect(checkText(`  ${"a".repeat(80)}  `, TEXT_RULES.businessName)).toBeNull();
    expect(checkText("a".repeat(81), TEXT_RULES.businessName)).toBe("TOO_LONG");
  });

  it("accepts a one-character given name, which is a real name", () => {
    expect(checkText("לי", TEXT_RULES.personName)).toBeNull();
    expect(checkText("O", TEXT_RULES.personName)).toBeNull();
  });
});

describe("phone numbers", () => {
  it("accepts international form", () => {
    expect(checkPhone("+972501234567")).toBeNull();
    expect(checkPhone("  +447700900123 ")).toBeNull();
  });

  it("says missing when there is nothing, and malformed when there is", () => {
    expect(checkPhone("")).toBe("REQUIRED");
    expect(checkPhone("+")).toBe("NOT_A_PHONE");
  });

  it("refuses a local number, which is the mistake people actually make", () => {
    expect(checkPhone("0501234567")).toBe("NOT_A_PHONE");
    expect(checkPhone("050-123-4567")).toBe("NOT_A_PHONE");
  });

  it("refuses a country code starting at zero, and anything too short or long", () => {
    expect(checkPhone("+0501234567")).toBe("NOT_A_PHONE");
    expect(checkPhone("+9725")).toBe("NOT_A_PHONE");
    expect(checkPhone(`+9${"7".repeat(15)}`)).toBe("NOT_A_PHONE");
  });
});
