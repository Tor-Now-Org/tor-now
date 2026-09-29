import { describe, expect, it } from "vitest";
import { likeContaining, matchesNameOrPhone, matchesPerson, peopleSearchOf } from "./people-search.ts";

const dana = { givenName: "דנה", familyName: "כהן", phone: "+972553519297" };

describe("searching for a person", () => {
  describe("by name", () => {
    it("finds either half, and the whole name typed as one", () => {
      for (const query of ["דנה", "כהן", "דנה כהן", "נה כה"]) {
        expect(matchesPerson(dana, peopleSearchOf(query)), query).toBe(true);
      }
    });

    it("ignores case and the spaces around and inside what was typed", () => {
      const ann = { givenName: "Ann", familyName: "Lee", phone: "+972500000001" };
      expect(matchesPerson(ann, peopleSearchOf("  ann   LEE "))).toBe(true);
    });

    it("finds somebody with no family name by the one they have", () => {
      const mononym = { givenName: "טל", familyName: null, phone: "+972500000002" };
      expect(matchesPerson(mononym, peopleSearchOf("טל"))).toBe(true);
      expect(matchesPerson(mononym, peopleSearchOf("טל כהן"))).toBe(false);
    });

    it("does not find a different person", () => {
      expect(matchesPerson(dana, peopleSearchOf("יעל"))).toBe(false);
    });
  });

  describe("by phone", () => {
    it("finds the number as people write it in Israel: with the 0, dashes or spaces", () => {
      for (const query of ["0553519297", "055-351-9297", "055 351 9297", "+972553519297", "972553519297"]) {
        expect(matchesPerson(dana, peopleSearchOf(query)), query).toBe(true);
      }
    });

    it("finds part of a number, from the start or from the end", () => {
      for (const query of ["055", "0553", "9297", "351-92"]) {
        expect(matchesPerson(dana, peopleSearchOf(query)), query).toBe(true);
      }
    });

    it("does not find a different number", () => {
      expect(matchesPerson(dana, peopleSearchOf("0521112222"))).toBe(false);
    });

    it("says what to match the stored number against, without its +", () => {
      expect(peopleSearchOf("055-351-9297").phoneDigits).toBe("553519297");
      expect(peopleSearchOf("+972 55 351 9297").phoneDigits).toBe("972553519297");
    });

    it("is not a phone search when there are letters, or too few digits to mean anything", () => {
      expect(peopleSearchOf("דנה 055").phoneDigits).toBeNull();
      expect(peopleSearchOf("0").phoneDigits).toBeNull();
      expect(peopleSearchOf("05").phoneDigits).toBeNull();
      expect(peopleSearchOf("---").phoneDigits).toBeNull();
    });
  });

  describe("for a name already joined", () => {
    it("matches the same way", () => {
      expect(matchesNameOrPhone("דנה כהן", "+972553519297", peopleSearchOf("055-351-9297"))).toBe(true);
      expect(matchesNameOrPhone("דנה כהן", "+972553519297", peopleSearchOf("דנה כהן"))).toBe(true);
      expect(matchesNameOrPhone("דנה כהן", "+972553519297", peopleSearchOf(""))).toBe(false);
    });
  });

  describe("as a LIKE pattern", () => {
    it("holds what was typed as text, never as a wildcard", () => {
      expect(likeContaining("דנה")).toBe("%דנה%");
      expect(likeContaining("50%")).toBe("%50\\%%");
      expect(likeContaining("a_b")).toBe("%a\\_b%");
      expect(likeContaining("back\\slash")).toBe("%back\\\\slash%");
    });

    it("so a percent sign finds only a name that has one", () => {
      expect(matchesPerson(dana, peopleSearchOf("%"))).toBe(false);
    });
  });
});
