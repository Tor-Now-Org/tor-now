import type { FieldProblem, TextRule } from "@tor-now/domain";
import type { Language } from "./dictionaries.ts";

/**
 * A reason from the domain, said in the reader's language.
 *
 * The domain decides whether a value is acceptable and why; the sentence is the
 * interface's business, and it needs the rule to say a useful one — "at most 80
 * characters" is help, "too long" is not.
 */
const SENTENCES: Readonly<
  Record<Language, Readonly<Record<FieldProblem, (rule: TextRule) => string>>>
> = Object.freeze({
  he: {
    REQUIRED: () => "שדה חובה",
    TOO_SHORT: (rule) => `לפחות ${rule.min} תווים`,
    TOO_LONG: (rule) => `עד ${rule.max} תווים`,
    NOT_A_PHONE: () => "מספר טלפון בפורמט בינלאומי, למשל ‎+972501234567",
  },
  en: {
    REQUIRED: () => "This field is required",
    TOO_SHORT: (rule) => `At least ${rule.min} characters`,
    TOO_LONG: (rule) => `At most ${rule.max} characters`,
    NOT_A_PHONE: () => "A phone number in international form, e.g. +972501234567",
  },
});

/** Same problems, said for a field that holds only the digits after the flag. */
const LOCAL_PHONE_NOT_A_PHONE: Readonly<Record<Language, string>> = Object.freeze({
  he: "מספר טלפון נייד, למשל 0501234567",
  en: "A mobile number, e.g. 0501234567",
});

/** Phone numbers carry no length rule of their own; the pattern is the rule. */
const NO_RULE: TextRule = { min: 0, max: 0 };

export const sayProblem = (
  language: Language,
  problem: FieldProblem | null,
  rule: TextRule = NO_RULE,
): string | null =>
  problem === null ? null : SENTENCES[language][problem](rule);

/** Like sayProblem, but for a field that holds only the digits after the flag. */
export const sayLocalPhoneProblem = (
  language: Language,
  problem: FieldProblem | null,
): string | null =>
  problem === null
    ? null
    : problem === "NOT_A_PHONE"
      ? LOCAL_PHONE_NOT_A_PHONE[language]
      : SENTENCES[language][problem](NO_RULE);
