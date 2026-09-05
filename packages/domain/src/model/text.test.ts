import { describe, expect, it } from "vitest";
import { TEXT_RULES, bareHandle, checkInstagram, checkPhone, checkText } from "./text.ts";

describe("text fields", () => {
  it("calls an empty required field missing rather than too short", () => {
    expect(checkText("", TEXT_RULES.businessName)).toBe("REQUIRED");
    expect(checkText("   ", TEXT_RULES.businessName)).toBe("REQUIRED");
  });

  it("lets an optional field be empty", () => {
    expect(checkText("", TEXT_RULES.description)).toBeNull();
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

  it("says missing when there is nothing, and too short when there isn't enough", () => {
    expect(checkPhone("")).toBe("REQUIRED");
    expect(checkPhone("+")).toBe("TOO_SHORT");
  });

  it("refuses a local number, which is the mistake people actually make", () => {
    expect(checkPhone("0501234567")).toBe("NOT_A_PHONE");
    expect(checkPhone("050-123-4567")).toBe("NOT_A_PHONE");
  });

  it("refuses anything too short, and a country code starting at zero or too long once long enough", () => {
    expect(checkPhone("+9725")).toBe("TOO_SHORT");
    expect(checkPhone("+050123456")).toBe("NOT_A_PHONE");
    expect(checkPhone(`+9${"7".repeat(15)}`)).toBe("NOT_A_PHONE");
  });
});

describe("an Instagram handle", () => {
  it("takes what people actually type", () => {
    // The @ is how a handle is written and is not part of it; a pasted profile
    // URL is the other thing people do instead of reading the hint.
    expect(bareHandle("@dreamhair")).toBe("dreamhair");
    expect(bareHandle("dreamhair")).toBe("dreamhair");
    expect(bareHandle("https://instagram.com/dreamhair")).toBe("dreamhair");
    expect(bareHandle("https://www.instagram.com/dreamhair/")).toBe("dreamhair");
    expect(bareHandle("  @dream.hair_1  ")).toBe("dream.hair_1");
  });

  it("accepts the characters Instagram accepts, and refuses the rest", () => {
    expect(checkInstagram("dream.hair_1")).toBeNull();
    expect(checkInstagram("@dreamhair")).toBeNull();
    expect(checkInstagram("")).toBe("REQUIRED");
    expect(checkInstagram("dream hair")).toBe("NOT_A_HANDLE");
    expect(checkInstagram("dream/hair")).toBe("NOT_A_HANDLE");
    expect(checkInstagram("a".repeat(31))).toBe("TOO_LONG");
  });
});
