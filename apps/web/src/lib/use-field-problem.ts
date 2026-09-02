"use client";

import { useCallback } from "react";
import {
  checkPhone,
  checkText,
  type FieldProblem,
  type TextRule,
} from "@tor-now/domain";
import { checkLocalPhone } from "./phone.ts";
import { useLanguage } from "./i18n/index.tsx";
import { sayLocalPhoneProblem, sayProblem } from "./i18n/field-problems.ts";

/** Phone numbers carry no max of their own; the pattern is the rule beyond this min. */
const PHONE_RULE: TextRule = { min: 9, max: 0 };

/**
 * Checking a field, and saying what is wrong with it.
 *
 * A form asks twice: once for the sentence to show under an input, and once —
 * through `blocking` — for whether the button at the bottom may be pressed. The
 * two must never disagree, so both come from the same check.
 *
 * Nothing here decides what is acceptable. That is the domain's, and the API
 * applies exactly the same rules, so what this refuses is what would have come
 * back as a 400 with a message written for a developer.
 */
export const useFieldProblem = () => {
  const { language } = useLanguage();

  const text = useCallback(
    (value: string, rule: TextRule, show = true): string | null =>
      show ? sayProblem(language, checkText(value, rule), rule) : null,
    [language],
  );

  const phone = useCallback(
    (value: string, show = true): string | null =>
      show ? sayProblem(language, checkPhone(value), PHONE_RULE) : null,
    [language],
  );

  /** For a field that holds the number without its country prefix. */
  const localPhone = useCallback(
    (value: string, show = true): string | null =>
      show ? sayLocalPhoneProblem(language, checkLocalPhone(value)) : null,
    [language],
  );

  return { text, phone, localPhone };
};

/** True when any of these values is unacceptable, whatever is being shown. */
export const blocking = (
  ...checks: readonly (FieldProblem | null)[]
): boolean => checks.some((problem) => problem !== null);

export { checkPhone, checkText };
