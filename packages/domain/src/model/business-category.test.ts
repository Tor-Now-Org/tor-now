import { describe, expect, it } from "vitest";
import {
  BUSINESS_CATEGORIES,
  categoryLabel,
  inferCategories,
  isBusinessCategory,
  matchCategories,
} from "./business-category.ts";

describe("business categories", () => {
  it("has unique codes, and Other among them", () => {
    expect(new Set(BUSINESS_CATEGORIES).size).toBe(BUSINESS_CATEGORIES.length);
    expect(isBusinessCategory("other")).toBe(true);
    expect(isBusinessCategory("Barbershop")).toBe(false);
  });

  it("offers the whole list before anything is typed", () => {
    expect(matchCategories("  ")).toEqual(BUSINESS_CATEGORIES);
  });

  it("ranks a label that starts with the text above a synonym that merely contains it", () => {
    expect(matchCategories("nail")[0]).toBe("nail_salon");
    expect(matchCategories("nail")).toContain("podiatry");
  });

  it("matches Hebrew with or without niqqud and geresh", () => {
    expect(matchCategories("סַפָּר")).toContain("barbershop");
    expect(matchCategories("ג'ל")).toContain("gel_nails");
    expect(matchCategories("ציפור")).toContain("nail_salon");
  });

  it("finds nothing for text no category knows", () => {
    expect(matchCategories("zzzz")).toEqual([]);
  });

  it("infers only from a whole-word start, never Other, and not from two letters", () => {
    expect(inferCategories("ספר")).toContain("barbershop");
    expect(inferCategories("מס")).toEqual([]);
    expect(inferCategories("אחר")).toEqual([]);
    expect(inferCategories("barber").length).toBeLessThanOrEqual(3);
  });

  it("labels a code in both languages", () => {
    expect(categoryLabel("barbershop", "en")).toBe("Barbershop");
    expect(categoryLabel("barbershop", "he")).toBe("מספרה / ספר");
  });
});
