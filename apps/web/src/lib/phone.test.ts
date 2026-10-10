import { describe, expect, it } from "vitest";
import { phoneShown } from "./phone.ts";

describe("a phone number as it is read", () => {
  it("is a mobile number in threes and fours", () => {
    expect(phoneShown("+972549534655")).toBe("054-953-4655");
    expect(phoneShown("+972501234567")).toBe("050-123-4567");
  });
  it("is a landline with its area code apart", () => {
    expect(phoneShown("+97231234567")).toBe("03-123-4567");
    expect(phoneShown("+97221234567")).toBe("02-123-4567");
  });
  it("tidies spaces and dashes in what it was given", () => {
    expect(phoneShown("+972 54-953 4655")).toBe("054-953-4655");
  });
  it("leaves a number from abroad as it was", () => {
    expect(phoneShown("+14155550123")).toBe("+14155550123");
    expect(phoneShown("+447700900123")).toBe("+447700900123");
  });
  it("leaves anything that is not a whole Israeli number as it was", () => {
    expect(phoneShown("+9725")).toBe("+9725");
    expect(phoneShown("+97254953465512")).toBe("+97254953465512");
    expect(phoneShown("0549534655")).toBe("0549534655");
    expect(phoneShown("")).toBe("");
  });
});
