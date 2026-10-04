import { describe, expect, it } from "vitest";
import type { BusinessCategory } from "@tor-now/domain";
import {
  addCategory,
  businessCategories,
  categoriesFull,
  makeMain,
  otherCategoriesCount,
  removeCategory,
  separateFields,
} from "./category-choice.ts";

const chosen = (...codes: BusinessCategory[]) => codes;

describe("adding a category", () => {
  it("adds after the ones already chosen, so the first stays the main one", () => {
    expect(addCategory(chosen(), "physiotherapy")).toEqual(["physiotherapy"]);
    expect(addCategory(chosen("physiotherapy"), "acupuncture")).toEqual(["physiotherapy", "acupuncture"]);
  });

  it("ignores one already chosen", () => {
    expect(addCategory(chosen("spa", "massage"), "spa")).toEqual(["spa", "massage"]);
  });

  it("ignores a fourth", () => {
    expect(addCategory(chosen("spa", "massage", "yoga"), "pilates")).toEqual(["spa", "massage", "yoga"]);
  });

  it("leaves the list it was given alone", () => {
    const before = chosen("spa");
    addCategory(before, "yoga");
    expect(before).toEqual(["spa"]);
  });
});

describe("removing a category", () => {
  it("removes it and keeps the order of the rest", () => {
    expect(removeCategory(chosen("spa", "massage", "yoga"), "massage")).toEqual(["spa", "yoga"]);
  });

  it("makes the next one main when the main one goes", () => {
    expect(removeCategory(chosen("spa", "massage"), "spa")).toEqual(["massage"]);
  });

  it("ignores one that was not chosen, and may empty the list", () => {
    expect(removeCategory(chosen("spa"), "yoga")).toEqual(["spa"]);
    expect(removeCategory(chosen("spa"), "spa")).toEqual([]);
  });
});

describe("making one the main category", () => {
  it("moves it first and keeps the others in their order", () => {
    expect(makeMain(chosen("spa", "massage", "yoga"), "yoga")).toEqual(["yoga", "spa", "massage"]);
  });

  it("changes nothing for the main one, or one not chosen", () => {
    expect(makeMain(chosen("spa", "massage"), "spa")).toEqual(["spa", "massage"]);
    expect(makeMain(chosen("spa", "massage"), "yoga")).toEqual(["spa", "massage"]);
  });
});

describe("when the field is full", () => {
  it("is full at three and not before", () => {
    expect(categoriesFull(chosen())).toBe(false);
    expect(categoriesFull(chosen("spa", "yoga"))).toBe(false);
    expect(categoriesFull(chosen("spa", "yoga", "pilates"))).toBe(true);
  });
});

describe("the note about separate fields", () => {
  it("says nothing for one category, or several from one parent group", () => {
    expect(separateFields(chosen())).toBeNull();
    expect(separateFields(chosen("physiotherapy"))).toBeNull();
    expect(separateFields(chosen("physiotherapy", "acupuncture", "dental_clinic"))).toBeNull();
  });

  it("names both parent groups, in the order chosen", () => {
    expect(separateFields(chosen("physiotherapy", "tattoo_piercing"))).toEqual(["health", "beauty"]);
    expect(separateFields(chosen("tattoo_piercing", "physiotherapy"))).toEqual(["beauty", "health"]);
  });

  it("names three when there are three, and each once", () => {
    expect(separateFields(chosen("physiotherapy", "tattoo_piercing", "acupuncture"))).toEqual(["health", "beauty"]);
    expect(separateFields(chosen("physiotherapy", "tattoo_piercing", "car_mechanic"))).toEqual([
      "health",
      "beauty",
      "repairs",
    ]);
  });

  it("does not count Other as a field of its own", () => {
    expect(separateFields(chosen("physiotherapy", "other"))).toBeNull();
  });
});

describe("a business's categories, from whichever API answered", () => {
  it("reads the list when there is one", () => {
    expect(businessCategories({ category: "spa", categories: ["spa", "yoga"] })).toEqual(["spa", "yoga"]);
  });

  it("falls back to the single field an older API sends", () => {
    expect(businessCategories({ category: "spa" })).toEqual(["spa"]);
    expect(businessCategories({ category: null })).toEqual([]);
    expect(businessCategories({})).toEqual([]);
  });

  it("counts the ones beyond the main one, for the card's +N", () => {
    expect(otherCategoriesCount({ categories: ["spa", "yoga", "pilates"] })).toBe(2);
    expect(otherCategoriesCount({ categories: ["spa"] })).toBe(0);
    expect(otherCategoriesCount({ category: null })).toBe(0);
  });
});
