"use client";

import { useEffect, useRef, useState } from "react";
import {
  buildNominatimUrl,
  isSearchable,
  moveIndex,
  toSuggestions,
  toSuggestionsFromGovMap,
  type NominatimResult,
  type Suggestion,
} from "./address-suggestions.ts";
import { geocodeAddress } from "./govmap-client.ts";

/**
 * An address, chosen from a search rather than typed. The pin on the map is
 * what a business is found by, so its coordinates come from here rather than
 * anywhere the owner could later drag — free text alone cannot produce them.
 *
 * GovMap (Israel's official address registry, which resolves house numbers
 * OSM mostly doesn't have) is tried first for Hebrew searches, falling
 * through to Nominatim on any failure. GovMap's endpoint only matches Hebrew
 * `searchText` — an English query reliably comes back empty rather than
 * erroring, so English searches go straight to Nominatim instead of paying
 * for a GovMap round trip that can't succeed.
 */

const DEBOUNCE_MS = 300;

export const AddressAutocomplete = ({
  id,
  label,
  hint,
  required,
  value,
  language,
  onSelect,
  onClear,
}: {
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
  /** The last selected address, or "" before anything has been chosen. */
  value: string;
  language: "he" | "en";
  onSelect: (address: string, latitude: number, longitude: number) => void;
  /** The owner edited the field away from its selected value — the pin no longer applies. */
  onClear: () => void;
}) => {
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<readonly Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // A selection sets `query` to its own display name; that change must not
  // immediately re-trigger a search for the thing just picked.
  const justSelected = useRef(false);

  useEffect(() => {
    if (justSelected.current) {
      justSelected.current = false;
      return;
    }
    // The confirmed address (e.g. one loaded with the settings) is already
    // chosen — searching for it would pop the list open on page load.
    if (query === value || !isSearchable(query)) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const nominatimFallback = () =>
      fetch(buildNominatimUrl(query, language), { signal: controller.signal })
        .then((response) => (response.ok ? (response.json() as Promise<NominatimResult[]>) : []))
        .then((results) => toSuggestions(results, language, query));
    const timer = setTimeout(() => {
      (language === "he"
        ? geocodeAddress(query).then(toSuggestionsFromGovMap).catch(nominatimFallback)
        : nominatimFallback()
      )
        .then((results) => {
          setSuggestions(results);
          setOpen(true);
          setActiveIndex(-1);
        })
        .catch(() => {
          // A failed lookup just leaves the list empty; the owner can retype
          // or try again, same as an empty result set.
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, value, language]);

  const pick = (suggestion: Suggestion) => {
    justSelected.current = true;
    setQuery(suggestion.displayName);
    setSuggestions([]);
    setOpen(false);
    setActiveIndex(-1);
    onSelect(suggestion.displayName, suggestion.latitude, suggestion.longitude);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => moveIndex(index, suggestions.length, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => moveIndex(index, suggestions.length, -1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      pick(suggestions[activeIndex]!);
    } else if (event.key === "Escape") {
      setOpen(false);
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
        value={query}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          // Any edit away from the confirmed value makes the pin stale — the
          // owner has to choose again before it counts.
          if (next !== value && value !== "") onClear();
        }}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
      />
      {hint && <span className="hint">{hint}</span>}
      {open && suggestions.length > 0 && (
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
            maxHeight: 220,
            overflowY: "auto",
          }}
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.displayName}
              role="option"
              aria-selected={index === activeIndex}
              // A mousedown fires before the input's blur, so a click still
              // lands here rather than on a listbox that already closed.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(suggestion);
              }}
              style={{
                padding: "9px 10px",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 14,
                background: index === activeIndex ? "var(--accent-soft)" : undefined,
              }}
            >
              {suggestion.displayName}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
