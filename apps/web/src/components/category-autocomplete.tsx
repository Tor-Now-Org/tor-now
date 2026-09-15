"use client";

import { useState } from "react";
import {
  categoryGroupLabel,
  categoryLabel,
  matchCategories,
  OTHER_CATEGORY,
  type BusinessCategory,
} from "@tor-now/domain";
import { moveIndex } from "./owner/address-suggestions.ts";

/**
 * ADR 0017: a Category is chosen, never typed. The same combobox as the address
 * field, minus the network — the whole list ships with the page. Typing only
 * narrows it; leaving the field puts back whatever was last chosen.
 */
export const CategoryAutocomplete = ({
  id,
  label,
  hint,
  placeholder,
  required,
  value,
  language,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  placeholder?: string | undefined;
  required?: boolean;
  value: BusinessCategory | null;
  language: "he" | "en";
  onChange: (category: BusinessCategory) => void;
}) => {
  // Null while not editing: the field then shows the chosen Category's label.
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const matches = matchCategories(query ?? "");
  // Other is always there, so a business the list did not foresee is never stuck.
  const options = matches.includes(OTHER_CATEGORY) ? matches : [...matches, OTHER_CATEGORY];

  const pick = (category: BusinessCategory) => {
    onChange(category);
    setQuery(null);
    setOpen(false);
    setActiveIndex(-1);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => moveIndex(index, options.length, event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter" && open && activeIndex >= 0) {
      event.preventDefault();
      pick(options[activeIndex]!);
    } else if (event.key === "Escape") {
      setOpen(false);
      setQuery(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, position: "relative" }}>
      <label htmlFor={id} className="label">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      <input
        id={id}
        className="field"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={placeholder}
        value={query ?? (value === null ? "" : categoryLabel(value, language))}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(event.target.value.trim() === "" ? -1 : 0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() =>
          setTimeout(() => {
            setOpen(false);
            setQuery(null);
          }, 120)
        }
        onKeyDown={onKeyDown}
      />
      {hint && <span className="hint">{hint}</span>}
      {open && (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          style={{
            position: "absolute",
            top: "100%",
            insetInlineStart: 0,
            insetInlineEnd: 0,
            marginTop: 4,
            background: "var(--raised)",
            border: "1px solid var(--line)",
            borderRadius: 12,
            listStyle: "none",
            padding: 4,
            zIndex: 10,
            maxHeight: 260,
            overflowY: "auto",
          }}
        >
          {options.map((category, index) => (
            <li
              key={category}
              role="option"
              aria-selected={index === activeIndex || category === value}
              // Mousedown lands before the input's blur closes the list.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(category);
              }}
              style={{
                padding: "9px 10px",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 14,
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                background: index === activeIndex ? "var(--accent-soft)" : undefined,
                fontWeight: category === value ? 600 : undefined,
              }}
            >
              <span>{categoryLabel(category, language)}</span>
              <span style={{ fontSize: 12, color: "var(--faint)", whiteSpace: "nowrap" }}>
                {categoryGroupLabel(category, language)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
