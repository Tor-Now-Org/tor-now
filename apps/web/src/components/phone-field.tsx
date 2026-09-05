"use client";

import type { InputHTMLAttributes } from "react";
import { PHONE_COUNTRY } from "@/lib/phone.ts";
import { useFieldProblem } from "@/lib/use-field-problem.ts";
import { Field } from "./ui.tsx";

/**
 * The phone field. Every number a person types anywhere in the app is typed
 * here: local digits behind the country flag, never a prefix they have to know
 * and never a format they have to guess. Callers hold the local digits and
 * convert with toE164 at the edge where the number leaves the browser.
 */
export const PhoneField = ({
  showProblem = true,
  onChange,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "type"> & {
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
  /** The digits after the dial code, as typed. */
  value: string;
  onChange?: (localDigits: string) => void;
  /** False until the field has been left, so a first keystroke is not scolded. */
  showProblem?: boolean;
}) => {
  const problem = useFieldProblem();
  return (
    <Field
      {...rest}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      dir="ltr"
      maxLength={9}
      startAdornment={
        <>
          <span style={{ fontSize: 24 }}>{PHONE_COUNTRY.flag}</span>
          {PHONE_COUNTRY.dial}
        </>
      }
      problem={problem.localPhone(String(rest.value), showProblem)}
      onChange={(event) => onChange?.(event.target.value.replace(/\D/g, ""))}
    />
  );
};
