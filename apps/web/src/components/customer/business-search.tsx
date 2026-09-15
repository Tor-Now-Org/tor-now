"use client";

import { useEffect, useRef, useState } from "react";
import { categoryLabel, matchCategories, OTHER_CATEGORY, type BusinessCategory } from "@tor-now/domain";
import { api } from "@/lib/api/client.ts";
import type { BusinessDto } from "@/lib/api/types.ts";
import { distanceKm, distanceLabel as formatDistance, type GeoPoint } from "@/lib/distance.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { CategoryAutocomplete } from "../category-autocomplete.tsx";
import { moveIndex } from "../owner/address-suggestions.ts";
import { Card, Chip, Empty } from "../ui.tsx";
import { AllCategoriesIcon, CategoryIcon } from "./category-icons.tsx";

/**
 * ADR 0011: trigram matching tolerates a name the customer half-remembers, so
 * the interface searches as they type rather than waiting for a submit — and
 * says nothing at all until there is enough input for ranking to mean anything.
 *
 * ADR 0017: a Category is the second way in, offered twice. The strip under the
 * box is always there, for someone who knows what they need but not where. The
 * box's own list mixes kinds of business with businesses, so nobody has to
 * decide which one they are typing before they type it.
 */
const MINIMUM_QUERY_LENGTH = 2;
const DEBOUNCE_MILLISECONDS = 220;
const LISTED_CATEGORIES = 3;
const LISTED_BUSINESSES = 4;

/** ponytail: a fixed strip; rank it by what is near the customer once there are enough businesses for that to be honest. */
const STRIP_CATEGORIES: readonly BusinessCategory[] = [
  "barbershop",
  "hair_salon",
  "nail_salon",
  "cosmetics",
  "brows_lashes",
  "massage",
  "personal_trainer",
  "pilates",
  "dental_clinic",
  "physiotherapy",
  "pet_grooming",
  "private_tutor",
];

const FAVORITES_STORAGE_KEY = "tor-now.favorite-businesses";

/** Never persisted server-side — the point is a device-local shortlist. */
export const readFavorites = (): Set<string> => {
  try {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    return new Set(raw === null ? [] : (JSON.parse(raw) as string[]));
  } catch {
    return new Set();
  }
};

export const writeFavorites = (favorites: Set<string>): void => {
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

export const HeartIcon = ({ filled, size = 20 }: { filled: boolean; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
    <path
      d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
);

export const tagStyle = {
  fontSize: 11.5,
  fontWeight: 600,
  padding: "3px 9px",
  borderRadius: 999,
} as const;

const sectionStyle = {
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--faint)",
  padding: "8px 10px 2px",
} as const;

type Option =
  | { readonly kind: "category"; readonly category: BusinessCategory }
  | { readonly kind: "business"; readonly business: BusinessDto; readonly distanceKm: number | null }
  | { readonly kind: "all" };

export const BusinessSearch = ({
  onOpen,
}: {
  onOpen: (business: BusinessDto) => void;
}) => {
  const copy = useCopy("customer");
  const { language } = useLanguage();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<BusinessCategory | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openNowOnly, setOpenNowOnly] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
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
  const input = useRef<HTMLInputElement | null>(null);

  const chooseCategory = (chosen: BusinessCategory | null) => {
    setCategory(chosen);
    setPickerOpen(false);
  };

  // Favorites mode fetches those specific businesses once; typing then filters
  // them in memory instead of hitting the server search.
  useEffect(() => {
    if (!favoritesOnly || favorites.size === 0) {
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
  }, [favoritesOnly, favorites]);

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

  const trimmed = query.trim();
  const text = trimmed.length < MINIMUM_QUERY_LENGTH ? "" : trimmed;

  useEffect(() => {
    if (favoritesOnly || (text === "" && category === null)) {
      abort.current?.abort();
      setSearching(false);
      setResults(null);
      return;
    }

    const timer = setTimeout(() => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setSearching(true);
      api
        // The position goes along so a browse keeps the nearest, not the first twenty.
        .search({ q: text, category, near: userPos }, controller.signal)
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
  }, [text, category, favoritesOnly, userPos]);

  // ponytail: plain substring match, not the server's trigram tolerance — fine for a short shortlist.
  const needle = trimmed.toLowerCase();
  const baseList = favoritesOnly
    ? favoriteBusinesses.filter(
        (b) =>
          `${b.name} ${b.address ?? ""}`.toLowerCase().includes(needle) &&
          (category === null || b.category === category),
      )
    : (results ?? []);
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
    (entry) =>
      (!favoritesOnly || favorites.has(entry.business.id)) &&
      // Unknown counts as closed: "open now" is a promise, not a guess.
      (!openNowOnly || entry.business.openNow === true),
  );

  // The box's own list. Kinds of business lead, because choosing one changes
  // what every business below it means; Other is never offered, it answers nothing.
  const options: Option[] =
    favoritesOnly || text === ""
      ? []
      : [
          ...(category === null
            ? matchCategories(text)
                .filter((code) => code !== OTHER_CATEGORY)
                .slice(0, LISTED_CATEGORIES)
                .map((code): Option => ({ kind: "category", category: code }))
            : []),
          ...visible
            .slice(0, LISTED_BUSINESSES)
            .map((entry): Option => ({ kind: "business", ...entry })),
          { kind: "all" },
        ];
  const showList = listOpen && options.length > 1;

  const choose = (option: Option) => {
    setActiveIndex(-1);
    if (option.kind === "category") {
      chooseCategory(option.category);
      setQuery("");
    } else if (option.kind === "business") {
      onOpen(option.business);
    } else {
      setListOpen(false);
      input.current?.blur();
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && query === "" && category !== null) {
      chooseCategory(null);
    } else if (!showList) {
      return;
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => moveIndex(index, options.length, event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      choose(options[activeIndex]!);
    } else if (event.key === "Escape") {
      setListOpen(false);
    }
  };

  const optionId = (index: number) => `business-search-option-${index}`;
  const categoriesListed = options.some((option) => option.kind === "category");
  const businessesListed = options.some((option) => option.kind === "business");
  const stripCategories =
    category === null || STRIP_CATEGORIES.includes(category)
      ? STRIP_CATEGORIES
      : [category, ...STRIP_CATEGORIES];

  return (
    <div style={{ padding: "28px 18px 18px", display: "flex", flexDirection: "column", gap: 16 }}>
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

      <div style={{ position: "relative" }}>
        <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 16px", minHeight: 56 }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="7" stroke="var(--faint)" strokeWidth="2" />
            <path d="m16.5 16.5 4 4" stroke="var(--faint)" strokeWidth="2" strokeLinecap="round" />
          </svg>
          {category !== null && (
            <button
              type="button"
              onClick={() => chooseCategory(null)}
              aria-label={`${categoryLabel(category, language)} · ${copy.clearCategory}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                maxWidth: "50%",
                flexShrink: 0,
                background: "var(--accent)",
                color: "var(--on-accent)",
                borderRadius: 9,
                padding: "4px 9px",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {categoryLabel(category, language)}
              </span>
              <span aria-hidden="true">✕</span>
            </button>
          )}
          <input
            ref={input}
            type="search"
            role="combobox"
            aria-expanded={showList}
            aria-controls="business-search-listbox"
            aria-autocomplete="list"
            aria-activedescendant={showList && activeIndex >= 0 ? optionId(activeIndex) : undefined}
            autoComplete="off"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setListOpen(true);
              setActiveIndex(-1);
            }}
            onFocus={() => setListOpen(true)}
            // Mousedown on an option lands before this closes the list.
            onBlur={() => setTimeout(() => setListOpen(false), 120)}
            onKeyDown={onKeyDown}
            placeholder={
              category === null
                ? copy.searchPlaceholder
                : copy.searchWithin.replace("{category}", categoryLabel(category, language))
            }
            aria-label={copy.searchPlaceholder}
            style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none", fontSize: 16, padding: "14px 0" }}
          />
          {searching && <span className="spinner" />}
        </div>

        {showList && (
          <ul
            id="business-search-listbox"
            role="listbox"
            aria-label={copy.searchPlaceholder}
            style={{
              position: "absolute",
              top: "100%",
              insetInlineStart: 0,
              insetInlineEnd: 0,
              marginTop: 6,
              background: "var(--raised)",
              border: "1px solid var(--line)",
              borderRadius: 14,
              boxShadow: "var(--shadow)",
              listStyle: "none",
              padding: 5,
              zIndex: 20,
              maxHeight: 380,
              overflowY: "auto",
            }}
          >
            {options.map((option, index) => {
              const active = index === activeIndex;
              const rowStyle = {
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                borderRadius: 10,
                cursor: "pointer",
                background: active ? "var(--accent-soft)" : undefined,
              } as const;
              const iconBox = {
                width: 30,
                height: 30,
                borderRadius: 9,
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
                background: "var(--sunken)",
                color: "var(--muted)",
              } as const;
              const pick = (event: React.MouseEvent) => {
                event.preventDefault();
                choose(option);
              };
              return (
                <li key={option.kind === "category" ? option.category : option.kind === "business" ? option.business.id : "all"}
                  role="presentation">
                  {option.kind === "category" && index === 0 && <div style={sectionStyle}>{copy.sectionCategories}</div>}
                  {option.kind === "business" && !options.slice(0, index).some((o) => o.kind === "business") && (
                    <div style={{ ...sectionStyle, ...(categoriesListed && { borderTop: "1px solid var(--line)", marginTop: 4 }) }}>
                      {copy.sectionBusinesses}
                    </div>
                  )}
                  {option.kind === "all" && (categoriesListed || businessesListed) && (
                    <div style={{ borderTop: "1px solid var(--line)", margin: "4px 6px" }} />
                  )}
                  <div id={optionId(index)} role="option" aria-selected={active} onMouseDown={pick} style={rowStyle}>
                    {option.kind === "category" && (
                      <>
                        <span style={iconBox}><CategoryIcon category={option.category} /></span>
                        <span style={{ flex: 1, fontWeight: 600 }}>{categoryLabel(option.category, language)}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--accent-strong)" }}>{copy.categoryFilterLabel}</span>
                      </>
                    )}
                    {option.kind === "business" && (
                      <>
                        <span style={iconBox}>
                          {option.business.category != null ? <CategoryIcon category={option.business.category} /> : <AllCategoriesIcon />}
                        </span>
                        <span style={{ flex: 1, minWidth: 0, display: "grid", lineHeight: 1.35 }}>
                          <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {option.business.name}
                          </span>
                          <span style={{ fontSize: 12, color: "var(--faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {[
                              option.business.category != null ? categoryLabel(option.business.category, language) : null,
                              option.business.address,
                              option.distanceKm === null ? null : formatDistance(option.distanceKm, copy),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                      </>
                    )}
                    {option.kind === "all" && (
                      <span style={{ flex: 1, fontSize: 13.5, color: "var(--muted)" }}>
                        {copy.allResultsFor.replace("{query}", trimmed)}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div
        role="group"
        aria-label={copy.categoryStrip}
        style={{
          display: "flex",
          gap: 8,
          overflowX: "auto",
          marginInline: -18,
          paddingInline: 18,
          paddingBlock: 2,
          scrollbarWidth: "none",
        }}
      >
        <Chip selected={category === null && !pickerOpen} onClick={() => chooseCategory(null)} style={{ gap: 6, flexShrink: 0 }}>
          <AllCategoriesIcon size={14} />
          {copy.allBusinesses}
        </Chip>
        {stripCategories.map((code) => (
          <Chip
            key={code}
            selected={category === code}
            onClick={() => chooseCategory(category === code ? null : code)}
            style={{ gap: 6, flexShrink: 0, whiteSpace: "nowrap" }}
          >
            <CategoryIcon category={code} size={14} />
            {categoryLabel(code, language)}
          </Chip>
        ))}
        <Chip selected={pickerOpen} onClick={() => setPickerOpen(!pickerOpen)} aria-expanded={pickerOpen} style={{ flexShrink: 0 }}>
          {copy.moreCategories}
        </Chip>
      </div>

      {pickerOpen && (
        <CategoryAutocomplete
          id="search-category"
          label={copy.categoryFilterLabel}
          placeholder={copy.categoryPlaceholder}
          value={category}
          language={language}
          onChange={chooseCategory}
        />
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Chip selected={openNowOnly} onClick={() => setOpenNowOnly(!openNowOnly)}>
          {copy.openNow}
        </Chip>
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

      {!favoritesOnly && category === null && trimmed.length === 1 && (
        <p style={{ margin: 0, textAlign: "center", fontSize: 13, color: "var(--faint)" }}>
          {copy.typeMore}
        </p>
      )}

      {favoritesOnly && !loadingFavorites && visible.length === 0 && (
        needle === "" && category === null && !openNowOnly || favoriteBusinesses.length === 0
          ? <Empty title={copy.noFavoritesTitle} body={copy.noFavoritesBody} />
          : <Empty title={copy.noResults} body={copy.noResultsBody} />
      )}

      {!favoritesOnly && results !== null && visible.length === 0 && !searching && (
        text === "" && category !== null && !openNowOnly
          ? <Empty title={copy.noCategoryResults} body={copy.noCategoryResultsBody} />
          : <Empty title={copy.noResults} body={copy.noResultsBody} />
      )}

      {visible.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="hint" role="status">
            {visible.length === 1 ? copy.resultCountOne : copy.resultCount.replace("{count}", String(visible.length))}
            {userPos !== null && ` · ${copy.nearestFirst}`}
          </span>
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
                    {(business.category != null || distanceLabel !== null || business.openNow !== undefined) && (
                      <span style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                        {/* Said once in the box already when a Category is chosen. */}
                        {business.category != null && category === null && (
                          <span style={{ ...tagStyle, background: "var(--sunken)", color: "var(--muted)" }}>
                            {categoryLabel(business.category, language)}
                          </span>
                        )}
                        {distanceLabel !== null && (
                          <span style={{ ...tagStyle, background: "var(--accent-soft)", color: "var(--accent-strong)" }}>
                            {distanceLabel}
                          </span>
                        )}
                        {business.openNow !== undefined && (
                          <span
                            style={{
                              ...tagStyle,
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
