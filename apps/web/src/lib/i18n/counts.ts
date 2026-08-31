import type { Language } from "./dictionaries.ts";

/**
 * The canvas gives one noun per label, which is enough for Hebrew — "1 תורים"
 * is idiomatic — and wrong in English, where "1 appointments" is simply a bug.
 * Rather than bend the design's copy, the English singular is supplied here and
 * chosen by the language's own plural rules.
 */
const ENGLISH_SINGULARS: Readonly<Record<string, string>> = Object.freeze({
  appointments: "appointment",
});

export const countOf = (
  language: Language,
  count: number,
  pluralLabel: string,
): string => {
  if (language !== "en") return `${count} ${pluralLabel}`;

  const singular = ENGLISH_SINGULARS[pluralLabel.toLowerCase()];
  const form = new Intl.PluralRules("en-GB").select(count);
  return `${count} ${form === "one" && singular !== undefined ? singular : pluralLabel}`;
};
