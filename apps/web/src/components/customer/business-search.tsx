"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client.ts";
import type { BusinessDto } from "@/lib/api/types.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { Card, Empty } from "../ui.tsx";

/**
 * ADR 0011: trigram matching tolerates a name the customer half-remembers, so
 * the interface searches as they type rather than waiting for a submit — and
 * says nothing at all until there is enough input for ranking to mean anything.
 */
const MINIMUM_QUERY_LENGTH = 2;
const DEBOUNCE_MILLISECONDS = 220;

export const BusinessSearch = ({
  onOpen,
}: {
  onOpen: (business: BusinessDto) => void;
}) => {
  const copy = useCopy("customer");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BusinessDto[] | null>(null);
  const [searching, setSearching] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MINIMUM_QUERY_LENGTH) {
      setResults(null);
      return;
    }

    const timer = setTimeout(() => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setSearching(true);
      api
        .search(trimmed, controller.signal)
        .then(setResults)
        .catch(() => {
          // An aborted search is the next keystroke, not a failure.
          if (!controller.signal.aborted) setResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, DEBOUNCE_MILLISECONDS);

    return () => clearTimeout(timer);
  }, [query]);

  const idle = results === null && query.trim().length < MINIMUM_QUERY_LENGTH;

  return (
    <div style={{ padding: "28px 18px 18px", display: "flex", flexDirection: "column", gap: 20 }}>
      {idle && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 14 }}>
          <h1 style={{ fontSize: 30, lineHeight: 1.2, textAlign: "center" }}>
            {copy.headline1}
            <br />
            {copy.headline2}
          </h1>
          <p style={{ margin: 0, textAlign: "center", fontSize: 14.5, lineHeight: 1.6, color: "var(--muted)" }}>
            {copy.subhead}
          </p>
        </div>
      )}

      <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 16px", minHeight: 56 }}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
          <circle cx="11" cy="11" r="7" stroke="var(--faint)" strokeWidth="2" />
          <path d="m16.5 16.5 4 4" stroke="var(--faint)" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.searchPlaceholder}
          aria-label={copy.searchPlaceholder}
          style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none", fontSize: 16, padding: "14px 0" }}
        />
        {searching && <span className="spinner" />}
      </div>

      {query.trim().length === 1 && (
        <p style={{ margin: 0, textAlign: "center", fontSize: 13, color: "var(--faint)" }}>
          {copy.typeMore}
        </p>
      )}

      {results !== null && results.length === 0 && !searching && (
        <Empty title={copy.noResults} body={copy.noResultsBody} />
      )}

      {results !== null && results.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {results.map((business) => (
            <button key={business.id} onClick={() => onOpen(business)} style={{ textAlign: "start", width: "100%" }}>
              <Card style={{ width: "100%", display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontFamily: "Rubik, sans-serif", fontWeight: 600, fontSize: 16.5 }}>
                  {business.name}
                </span>
                {business.address !== null && (
                  <span className="hint">{business.address}</span>
                )}
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
