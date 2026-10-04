import { describe, expect, it } from "vitest";
import {
  BUSINESS_CATEGORIES,
  CATEGORY_GROUPS,
  CATEGORY_MERGES,
  categoryGroup,
  categoryGroupsOf,
  checkCategories,
  currentCategory,
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
    expect(matchCategories("ג'ל")).toContain("nail_salon");
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

/** Where each retired code sat before it was merged — which its successor must share. */
const RETIRED_GROUPS: Record<string, string> = {
  kids_haircuts: "hair", hair_extensions: "hair", bridal_salon: "hair",
  gel_nails: "beauty", permanent_makeup: "beauty", laser_hair_removal: "beauty",
  reflexology: "wellness", meditation: "wellness",
  orthodontist: "health", dermatologist: "health", chiropractor: "health", psychologist: "health",
  couples_therapy: "health", naturopathy: "health",
  pet_boarding: "pets", language_lessons: "lessons",
  notary: "professional", insurance_agent: "professional", tires: "repairs",
};

describe("categories merged into a sibling", () => {
  /** Every retired code, the code it joined, and words that must still find it. */
  const MERGED = [
    ["kids_haircuts", "barbershop", ["תספורות ילדים", "Kids' haircuts"]],
    ["hair_extensions", "hair_salon", ["תוספות שיער", "Hair extensions"]],
    ["bridal_salon", "hair_salon", ["סלון כלות", "Bridal salon"]],
    ["gel_nails", "nail_salon", ["לק ג׳ל", "Gel nails"]],
    ["permanent_makeup", "brows_lashes", ["איפור קבוע", "Permanent makeup"]],
    ["laser_hair_removal", "hair_removal", ["הסרת שיער בלייזר", "Laser hair removal"]],
    ["reflexology", "massage", ["רפלקסולוגיה", "Reflexology"]],
    ["meditation", "yoga", ["מדיטציה", "Meditation"]],
    ["orthodontist", "dental_clinic", ["אורתודנט", "Orthodontist"]],
    ["dermatologist", "family_doctor", ["רופא עור", "Dermatologist"]],
    ["chiropractor", "physiotherapy", ["כירופרקטיקה", "Chiropractor"]],
    ["psychologist", "psychotherapy", ["פסיכולוג", "Psychologist"]],
    ["couples_therapy", "psychotherapy", ["טיפול זוגי", "Couples therapy"]],
    ["naturopathy", "acupuncture", ["נטורופתיה", "Naturopathy"]],
    ["pet_boarding", "dog_training", ["פנסיון לחיות", "Pet boarding"]],
    ["language_lessons", "private_tutor", ["שיעורי שפה", "Language lessons"]],
    ["notary", "lawyer", ["נוטריון", "Notary"]],
    ["insurance_agent", "financial_advisor", ["סוכן ביטוח", "Insurance agent"]],
    ["tires", "car_mechanic", ["צמיגים", "Tires"]],
  ] as const;

  it("leaves 67 categories, none of them a retired code", () => {
    expect(BUSINESS_CATEGORIES).toHaveLength(67);
    for (const [retired] of MERGED) expect(isBusinessCategory(retired), retired).toBe(false);
  });

  it("joins each retired code to a sibling under the same parent group", () => {
    for (const [retired, into] of MERGED) {
      expect(CATEGORY_MERGES[retired], retired).toBe(into);
      expect(categoryGroup(into), retired).toBe(RETIRED_GROUPS[retired]);
    }
    expect(Object.keys(CATEGORY_MERGES).sort()).toEqual(MERGED.map(([retired]) => retired).sort());
  });

  it("still finds the joined category by every name it used to have, in both languages", () => {
    for (const [, into, words] of MERGED) {
      for (const word of words) expect(matchCategories(word), word).toContain(into);
    }
  });

  it("still infers it from a customer's search for an old name", () => {
    expect(inferCategories("אורתודנט")).toContain("dental_clinic");
    expect(inferCategories("notary")).toContain("lawyer");
    expect(inferCategories("רפלקסולוגיה")).toContain("massage");
  });

  it("names both halves in a merged label", () => {
    expect(categoryLabel("dental_clinic", "he")).toBe("רופא שיניים ואורתודנט");
    expect(categoryLabel("dental_clinic", "en")).toBe("Dentist & orthodontist");
    expect(categoryLabel("psychotherapy", "he")).toBe("פסיכולוג וטיפול רגשי");
    expect(categoryLabel("acupuncture", "he")).toBe("רפואה משלימה");
    expect(categoryLabel("hair_salon", "he")).toBe("מספרת נשים וכלות");
  });

  it("reads a retired code as the one it joined, and anything else as nothing", () => {
    expect(currentCategory("gel_nails")).toBe("nail_salon");
    expect(currentCategory("nail_salon")).toBe("nail_salon");
    expect(currentCategory("teleport")).toBeNull();
  });

  it("keeps all nine parent groups, each with something in it", () => {
    for (const group of Object.keys(CATEGORY_GROUPS)) {
      expect(BUSINESS_CATEGORIES.some((code) => categoryGroup(code) === group), group).toBe(true);
    }
  });
});

describe("a business's categories", () => {
  it("takes one to three, in the order given, the first being the main one", () => {
    expect(checkCategories(["barbershop"])).toEqual({ ok: true, categories: ["barbershop"] });
    expect(checkCategories(["massage", "physiotherapy", "acupuncture"])).toEqual({
      ok: true,
      categories: ["massage", "physiotherapy", "acupuncture"],
    });
  });

  it("refuses none, more than three, a repeat, or a code it does not know", () => {
    expect(checkCategories([])).toEqual({ ok: false, problem: "NONE" });
    expect(checkCategories(["massage", "spa", "yoga", "pilates"])).toEqual({ ok: false, problem: "TOO_MANY" });
    expect(checkCategories(["massage", "massage"])).toEqual({ ok: false, problem: "REPEATED" });
    expect(checkCategories(["massage", "teleport"])).toEqual({ ok: false, problem: "UNKNOWN" });
  });

  it("takes a retired code as the one it joined, and a repeat that makes as one", () => {
    expect(checkCategories(["gel_nails"])).toEqual({ ok: true, categories: ["nail_salon"] });
    expect(checkCategories(["nail_salon", "gel_nails"])).toEqual({ ok: false, problem: "REPEATED" });
  });

  it("names the parent groups they come from, each once, in order", () => {
    expect(categoryGroupsOf(["physiotherapy", "tattoo_piercing", "acupuncture"])).toEqual(["health", "beauty"]);
    expect(categoryGroupsOf(["barbershop", "hair_salon"])).toEqual(["hair"]);
    expect(categoryGroupsOf([])).toEqual([]);
  });

  it("lets Other stand with anything, and never counts it as a second group", () => {
    expect(categoryGroupsOf(["barbershop", "other"])).toEqual(["hair"]);
  });
});
