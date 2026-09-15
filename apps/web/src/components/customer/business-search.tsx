"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client.ts";
import type { BusinessDto } from "@/lib/api/types.ts";
import { distanceKm, distanceLabel as formatDistance, type GeoPoint } from "@/lib/distance.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { Card, Chip, Empty } from "../ui.tsx";

/**
 * ADR 0011: trigram matching tolerates a name the customer half-remembers, so
 * the interface searches as they type rather than waiting for a submit — and
 * says nothing at all until there is enough input for ranking to mean anything.
 */
const MINIMUM_QUERY_LENGTH = 2;
const DEBOUNCE_MILLISECONDS = 220;

const FAVORITES_STORAGE_KEY = "tor-now.favorite-businesses";

/** Never persisted server-side — the point is a device-local shortlist. */
const readFavorites = (): Set<string> => {
  try {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    return new Set(raw === null ? [] : (JSON.parse(raw) as string[]));
  } catch {
    return new Set();
  }
};

const writeFavorites = (favorites: Set<string>): void => {
  try {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...favorites]));
  } catch {
    // Without storage, favorites just don't survive a reload.
  }
};

const FAVORITES_ONLY_STORAGE_KEY = "tor-now.favorites-only";

const readFavoritesOnly = (): boolean => {
  try {
    return window.localStorage.getItem(FAVORITES_ONLY_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

const writeFavoritesOnly = (favoritesOnly: boolean): void => {
  try {
    window.localStorage.setItem(FAVORITES_ONLY_STORAGE_KEY, favoritesOnly ? "1" : "0");
  } catch {
    // Without storage, the choice just doesn't survive a reload.
  }
};

const HeartIcon = ({ filled, size = 20 }: { filled: boolean; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M12 20.2s-7.6-4.6-10.1-9.3C.4 7.5 2.4 3.6 6.1 3.6c2 0 3.7 1.1 4.6 2.7.9-1.6 2.6-2.7 4.6-2.7 3.7 0 5.7 3.9 4.2 7.3-2.5 4.7-10.1 9.3-10.1 9.3Z"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
);

export const BusinessSearch = ({
  onOpen,
}: {
  onOpen: (business: BusinessDto) => void;
}) => {
  const copy = useCopy("customer");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BusinessDto[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [userPos, setUserPos] = useState<GeoPoint | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(() => readFavorites());
  const [favoritesOnly, setFavoritesOnlyState] = useState(() => readFavoritesOnly());
  const setFavoritesOnly = (favoritesOnly: boolean) => {
    setFavoritesOnlyState(favoritesOnly);
    writeFavoritesOnly(favoritesOnly);
  };
  const [favoriteBusinesses, setFavoriteBusinesses] = useState<BusinessDto[]>([]);
  const [loadingFavorites, setLoadingFavorites] = useState(false);
  const abort = useRef<AbortController | null>(null);

  // Favoriting doesn't come from a search: without a query there is no result
  // list to filter, so browsing favorites fetches those specific businesses.
  useEffect(() => {
    const browsingFavorites = favoritesOnly && query.trim().length < MINIMUM_QUERY_LENGTH;
    if (!browsingFavorites || favorites.size === 0) {
      setFavoriteBusinesses([]);
      return;
    }
    let cancelled = false;
    setLoadingFavorites(true);
    void Promise.all(
      [...favorites].map((businessId) =>
        api.businessProfile(businessId).then(
          (profile) => profile.business,
          () => null, // Deleted or otherwise gone: just leave it out.
        ),
      ),
    ).then((businesses) => {
      if (!cancelled) {
        setFavoriteBusinesses(businesses.filter((b): b is BusinessDto => b !== null));
        setLoadingFavorites(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [favoritesOnly, favorites, query]);

  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (position) =>
        setUserPos({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => {
        // Denied or unavailable: results just stay unsorted, no distance shown.
      },
      { timeout: 8000 },
    );
  }, []);

  const toggleFavorite = (businessId: string) => {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(businessId)) next.delete(businessId);
      else next.add(businessId);
      writeFavorites(next);
      return next;
    });
  };

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

  const baseList = idle && favoritesOnly ? favoriteBusinesses : (results ?? []);
  const withDistance = baseList.map((business) => ({
    business,
    distanceKm:
      userPos !== null && business.latitude != null && business.longitude != null
        ? distanceKm(userPos, { latitude: business.latitude, longitude: business.longitude })
        : null,
  }));
  if (userPos !== null) {
    withDistance.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  }
  const visible = withDistance.filter(
    (entry) => !favoritesOnly || favorites.has(entry.business.id),
  );

  return (
    <div style={{ padding: "28px 18px 18px", display: "flex", flexDirection: "column", gap: 20 }}>
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

      <div style={{ display: "flex" }}>
        <Chip
          selected={favoritesOnly}
          onClick={() => setFavoritesOnly(!favoritesOnly)}
          style={{
            gap: 6,
            ...(favoritesOnly && {
              background: "var(--critical-soft)",
              color: "var(--critical)",
              border: "1px solid transparent",
            }),
          }}
        >
          {copy.favoritesOnly}
          <span style={{ color: favoritesOnly ? "var(--critical)" : "var(--faint)", display: "inline-flex" }}>
            <HeartIcon filled={favoritesOnly} size={15} />
          </span>
        </Chip>
      </div>

      {loadingFavorites && (
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
          <span className="spinner" />
        </div>
      )}

      {query.trim().length === 1 && (
        <p style={{ margin: 0, textAlign: "center", fontSize: 13, color: "var(--faint)" }}>
          {copy.typeMore}
        </p>
      )}

      {favoritesOnly && !loadingFavorites && visible.length === 0 && (idle || baseList.length > 0) && (
        <Empty title={copy.noFavoritesTitle} body={copy.noFavoritesBody} />
      )}

      {!idle && results !== null && results.length === 0 && !searching && (
        <Empty title={copy.noResults} body={copy.noResultsBody} />
      )}

      {visible.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {visible.map(({ business, distanceKm: dist }) => {
            const isFavorite = favorites.has(business.id);
            const distanceLabel = dist === null ? null : formatDistance(dist, copy);

            return (
              <div key={business.id} style={{ position: "relative" }}>
                <button
                  onClick={() => onOpen(business)}
                  style={{ textAlign: "start", width: "100%" }}
                >
                  <Card
                    style={{
                      width: "100%",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      paddingInlineEnd: 48,
                    }}
                  >
                    <span style={{ fontFamily: "Rubik, sans-serif", fontWeight: 600, fontSize: 16.5 }}>
                      {business.name}
                    </span>
                    {business.address !== null && (
                      <span className="hint">{business.address}</span>
                    )}
                    {(distanceLabel !== null || business.openNow !== undefined) && (
                      <span style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                        {distanceLabel !== null && (
                          <span
                            style={{
                              fontSize: 11.5,
                              fontWeight: 600,
                              padding: "3px 9px",
                              borderRadius: 999,
                              background: "var(--accent-soft)",
                              color: "var(--accent-strong)",
                            }}
                          >
                            {distanceLabel}
                          </span>
                        )}
                        {business.openNow !== undefined && (
                          <span
                            style={{
                              fontSize: 11.5,
                              fontWeight: 600,
                              padding: "3px 9px",
                              borderRadius: 999,
                              background: business.openNow ? "var(--positive-soft)" : "var(--sunken)",
                              color: business.openNow ? "var(--positive)" : "var(--faint)",
                            }}
                          >
                            {business.openNow ? copy.openNow : copy.closedNow}
                          </span>
                        )}
                      </span>
                    )}
                  </Card>
                </button>
                <button
                  onClick={() => toggleFavorite(business.id)}
                  aria-pressed={isFavorite}
                  aria-label={isFavorite ? copy.removeFavorite : copy.addFavorite}
                  style={{
                    position: "absolute",
                    insetBlockStart: 8,
                    insetInlineEnd: 8,
                    width: 34,
                    height: 34,
                    display: "grid",
                    placeItems: "center",
                    borderRadius: 999,
                    color: isFavorite ? "var(--critical)" : "var(--faint)",
                    background: isFavorite ? "var(--critical-soft)" : "transparent",
                    transition: "background .13s ease, color .13s ease, transform .08s ease",
                  }}
                >
                  <HeartIcon filled={isFavorite} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
