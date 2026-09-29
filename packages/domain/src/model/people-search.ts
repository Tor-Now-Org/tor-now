/**
 * What typing into a "name or phone" box finds.
 *
 * One rule, so the two stores that answer it cannot drift apart: the in-memory
 * one used the whole name while Postgres matched each half on its own, so "דנה
 * כהן" found her in every unit test and nobody in the product. And a phone is
 * kept as E.164 while an owner types it off a missed call — "055-351-9297" —
 * which as a plain substring matches nothing.
 */

import { displayName } from "./user.ts";

/** The fewest digits typed that are still a number rather than a stray key. */
const PHONE_SEARCH_MIN_DIGITS = 3;

/** Israel's trunk prefix: the 0 a local number is written with and stored without. */
const TRUNK_PREFIX = "0";

export type PeopleSearch = {
  /** What was typed, trimmed, with its inner spaces made single. */
  readonly text: string;
  /**
   * The digits to find inside a stored number with its + taken off, or null
   * when what was typed is not a number at all.
   */
  readonly phoneDigits: string | null;
};

export type Searchable = {
  readonly givenName: string;
  readonly familyName: string | null;
  readonly phone: string;
};

export const peopleSearchOf = (query: string): PeopleSearch => {
  const text = query.trim().replace(/\s+/g, " ");
  const digits = text.replace(/\D/g, "");
  const isNumber = !/\p{L}/u.test(text) && digits.length >= PHONE_SEARCH_MIN_DIGITS;
  return {
    text,
    phoneDigits: isNumber ? (digits.startsWith(TRUNK_PREFIX) ? digits.slice(TRUNK_PREFIX.length) : digits) : null,
  };
};

/** For a screen that holds the name already joined, as the API renders it. */
export const matchesNameOrPhone = (name: string, phone: string, search: PeopleSearch): boolean =>
  (search.text !== "" && name.toLowerCase().includes(search.text.toLowerCase())) ||
  (search.phoneDigits !== null && phone.replace("+", "").includes(search.phoneDigits));

export const matchesPerson = (person: Searchable, search: PeopleSearch): boolean =>
  matchesNameOrPhone(displayName(person), person.phone, search);

/**
 * A LIKE pattern that finds the text anywhere, holding `%`, `_` and `\` as the
 * characters they are rather than as wildcards (Postgres escapes with `\`).
 */
export const likeContaining = (text: string): string => `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
