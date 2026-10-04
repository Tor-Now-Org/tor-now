"use client";

import {
  categoryLabel,
  CATEGORY_GROUPS,
  type BusinessCategory,
} from "@tor-now/domain";
import { CategoryAutocomplete } from "./category-autocomplete.tsx";
import {
  addCategory,
  categoriesFull,
  makeMain,
  removeCategory,
  separateFields,
} from "./category-choice.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy } from "@/lib/i18n/index.tsx";

/**
 * ADR 0024: up to three Categories, the first the main one. The chips are the
 * choice; tapping another chip makes it the main one, and at three the box for
 * another goes away. Choosing from two parent groups earns one short line and
 * never stops anything.
 */
export const CategoryChooser = ({
  id,
  value,
  language,
  required,
  hint,
  onChange,
}: {
  id: string;
  value: readonly BusinessCategory[];
  language: "he" | "en";
  required?: boolean;
  hint?: string | undefined;
  onChange: (categories: readonly BusinessCategory[]) => void;
}) => {
  const copy = useCopy("categories");
  const fields = separateFields(value);
  const name = (code: BusinessCategory) => categoryLabel(code, language);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label htmlFor={id} id={`${id}-label`} className="label">
        {copy.label}
        {required && <span aria-hidden="true"> *</span>}
        <span style={{ color: "var(--muted)", fontWeight: 500 }}> · {copy.upTo}</span>
      </label>
      {value.length > 0 && (
        <ul
          aria-labelledby={`${id}-label`}
          style={{ display: "flex", flexWrap: "wrap", gap: 6, listStyle: "none", margin: 0, padding: 0 }}
        >
          {value.map((code, index) => (
            <li key={code} className={index === 0 ? "cat-chip main" : "cat-chip"}>
              <button
                type="button"
                className="cat-chip-name"
                aria-pressed={index === 0}
                aria-label={index === 0 ? `${name(code)} · ${copy.main}` : fillText(copy.makeMain, { category: name(code) })}
                onClick={() => onChange(makeMain(value, code))}
              >
                {index === 0 && <span className="cat-chip-star">{copy.main}</span>}
                {name(code)}
              </button>
              <button
                type="button"
                className="cat-chip-x"
                aria-label={fillText(copy.remove, { category: name(code) })}
                onClick={() => onChange(removeCategory(value, code))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {!categoriesFull(value) && (
        <CategoryAutocomplete
          id={id}
          placeholder={value.length === 0 ? copy.firstPlaceholder : copy.addAnother}
          value={null}
          exclude={value}
          language={language}
          onChange={(code) => onChange(addCategory(value, code))}
        />
      )}
      {fields !== null && (
        <p role="status" className="cat-fields">
          <span aria-hidden="true">⚠ </span>
          {fillText(fields.length === 2 ? copy.twoFields : copy.threeFields, {
            groups: fields.map((group) => CATEGORY_GROUPS[group][language]).join(" · "),
          })}
        </p>
      )}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
};

