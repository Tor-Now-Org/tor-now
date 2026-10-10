"use client";

import { useRef, useState, type InputHTMLAttributes } from "react";
import { cleanNumberText } from "./number-text.ts";
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
 *
 * A text box with a numeric keyboard rather than `type="number"`: a number box
 * keeps no selection on a phone — the finger lifting puts the caret back after
 * the nought — and typing then gave "080". The text is cleaned as it is typed
 * (digits, one point where allowed, no leading zeros), so wherever the caret
 * was, eighty is "80".
 */
export const NumberField = ({
  value,
  onValue,
  fallback,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  decimals = false,
  ...rest
}: Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "min" | "max"
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
  /** The largest number the field takes; past it, leaving the box puts back the last one it took. */
  max?: number;
  /** Whether the number may have a fraction — a price in shekels and agorot. */
  decimals?: boolean;
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

  /** Set on focus, so the tap that focused does not collapse the selection it made. */
  const justFocused = useRef(false);

  const inRange = (candidate: number) => Number.isFinite(candidate) && candidate >= min && candidate <= max;

  const say = (typed: string) => {
    const next = cleanNumberText(typed, decimals);
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
    // "12." is somebody still typing; the number it is on its way to is 12.
    const asNumber = Number(next.endsWith(".") ? next.slice(0, -1) : next);
    if (!inRange(asNumber)) return;
    setReported(asNumber);
    onValue(asNumber);
  };

  return (
    <Field
      {...rest}
      type="text"
      inputMode={decimals ? "decimal" : "numeric"}
      autoComplete="off"
      value={text}
      // The first keystroke replaces what is there rather than joining it.
      onFocus={(event) => {
        justFocused.current = true;
        event.currentTarget.select();
        rest.onFocus?.(event);
      }}
      onPointerUp={(event) => {
        // The lift of the tap that focused the box would put the caret where
        // the finger was and drop the selection; keep it for that one lift.
        if (justFocused.current) {
          justFocused.current = false;
          event.preventDefault();
          event.currentTarget.select();
        }
      }}
      onChange={(event) => say(event.target.value)}
      onBlur={(event) => {
        // Leaving an empty box means the fallback, and the box says so rather
        // than staying blank and reporting something else.
        justFocused.current = false;
        if (text.trim() === "") {
          if (fallback !== null) {
            setReported(fallback);
            setText(String(fallback));
            onValue(fallback);
          }
        } else {
          // A number the field does not take — "0" minutes, or a first digit
          // on its way to a bigger one — is not left showing beside a value
          // that is something else: the box goes back to what it holds.
          const typed = Number(text.endsWith(".") ? text.slice(0, -1) : text);
          if (!inRange(typed)) {
            const kept = reported ?? fallback;
            setText(kept === null ? "" : String(kept));
          } else if (text.endsWith(".")) {
            setText(String(typed));
          }
        }
        rest.onBlur?.(event);
      }}
    />
  );
};
