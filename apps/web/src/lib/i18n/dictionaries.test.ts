import { describe, expect, it } from "vitest";
import { DICTIONARIES, LANGUAGES } from "./dictionaries.ts";

/**
 * `useCopy` types against the Hebrew dictionary and casts the other language to
 * it, which is what lets a Hebrew-only key compile — and then render the word
 * "undefined" to an English-speaking customer. Six keys had drifted that way
 * before this test existed, so the parity the cast asserts is checked here
 * instead.
 */
describe("the dictionaries", () => {
  const namespaces = Object.keys(DICTIONARIES) as (keyof typeof DICTIONARIES)[];

  it.each(namespaces)("says the same things in every language: %s", (namespace) => {
    const inHebrew = Object.keys(DICTIONARIES[namespace].he).sort();
    for (const language of LANGUAGES) {
      const translated = DICTIONARIES[namespace][language] as Record<string, unknown>;
      expect(Object.keys(translated).sort(), `${namespace}.${language}`).toEqual(inHebrew);
      for (const key of inHebrew) {
        expect(translated[key], `${namespace}.${language}.${key}`).not.toBe("");
      }
    }
  });
});
