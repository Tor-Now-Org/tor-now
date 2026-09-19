"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Field } from "./ui.tsx";

/**
 * A number somebody types, rather than a number with a box drawn round it.
 *
 * Binding the number straight to the input reads well and behaves badly. The
 * value has to be *something*, so an empty box becomes `Number("")` — zero —
 * and the zero is written straight back into the field the moment it is
 * cleared. Typing eighty over it gives "080", and the only way out is to
 * select the whole box by hand first, which is what everybody ends up doing
 * and nobody should have to.
 *
 * So the text is the state while the field is being typed in, and the number
 * is what comes out of it. An empty box stays empty. Selecting the contents on
 * focus means the first keystroke replaces what is there, which is what a
 * person means by tapping a field with one number in it and typing another.
 */
export const NumberField = ({
  value,
  onValue,
  fallback,
  min = 0,
  ...rest
}: Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "min"
> & {
  id: string;
  label: string;
  hint?: string | undefined;
  /** Null draws an empty box — for a field whose absence means something. */
  value: number | null;
  onValue: (value: number | null) => void;
  /**
   * What an empty box means when the field is left. Null keeps it empty, which
   * is only right where the API takes a null; otherwise give it the number the
   * form would have used anyway.
   */
  fallback: number | null;
  min?: number;
}) => {
  const [text, setText] = useState(value === null ? "" : String(value));
  /**
   * What this field last reported. The value can also change from outside —
   * another field resetting the form, a fetch landing — and the box has to
   * follow that without fighting whoever is typing into it.
   */
  const [reported, setReported] = useState(value);
  if (value !== reported) {
    setReported(value);
    setText(value === null ? "" : String(value));
  }

  const say = (next: string) => {
    setText(next);
    if (next.trim() === "") {
      // An empty box is only worth reporting where an empty value is a thing
      // the form can hold. Where it is not, saying "nothing" makes the parent
      // answer with a zero of its own, and the zero lands straight back in the
      // box — which is the behaviour this component exists to remove. It waits
      // for the blur instead, and the fallback settles it.
      if (fallback === null) {
        setReported(null);
        onValue(null);
      }
      return;
    }
    const asNumber = Number(next);
    if (!Number.isFinite(asNumber) || asNumber < min) return;
    setReported(asNumber);
    onValue(asNumber);
  };

  return (
    <Field
      {...rest}
      type="number"
      inputMode="numeric"
      min={min}
      value={text}
      // The first keystroke replaces what is there rather than joining it.
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => say(event.target.value)}
      onBlur={(event) => {
        // Leaving an empty box means the fallback, and the box says so rather
        // than staying blank and reporting something else.
        if (text.trim() === "" && fallback !== null) {
          setReported(fallback);
          setText(String(fallback));
          onValue(fallback);
        }
        rest.onBlur?.(event);
      }}
    />
  );
};
