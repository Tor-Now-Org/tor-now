"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import { categoryLabel, type BusinessCategory } from "@tor-now/domain";
import type { BusinessDto } from "@/lib/api/types.ts";
import { distanceLabel, type GeoPoint } from "@/lib/distance.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { Chip } from "../ui.tsx";
import { AllCategoriesIcon, CategoryIcon } from "./category-icons.tsx";
import { HeartIcon, tagStyle } from "./business-search.tsx";

/**
 * The search results, drawn where they are. With no query or Category the map
 * browses every Business nearby (up to the search's result cap); searching in here
 * changes that same search — so closing the map lands on the same list.
 */

export type MapEntry = { readonly business: BusinessDto; readonly distanceKm: number | null };
type Located = MapEntry & { readonly position: [number, number] };

/** Tel Aviv: only seen when there is neither a customer location nor a result. */
const FALLBACK_CENTER: [number, number] = [32.0853, 34.7818];

/** Pulses always; the label says what the dot is, then fades once the map has been seen (CSS). */
const userIcon = (label: string) =>
  L.divIcon({
    className: "",
    html: `<span class="map-me"><span class="map-me-ring"></span><span class="map-me-ring"></span><span class="map-me-label">${label}</span></span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });

const pinIcon = (category: BusinessCategory | null | undefined, selected: boolean) =>
  L.divIcon({
    className: "",
    html: `<span class="map-pin${selected ? " selected" : ""}"><span>${renderToStaticMarkup(
      category != null ? <CategoryIcon category={category} size={15} /> : <AllCategoriesIcon size={15} />,
    )}</span></span>`,
    iconSize: [34, 42],
    iconAnchor: [17, 42],
  });

/** Frames the pins and the customer together, once per new set of results. */
const FitToResults = ({ points, resultsKey }: { points: [number, number][]; resultsKey: string }) => {
  const map = useMap();
  useEffect(() => {
    if (points.length === 1) map.setView(points[0]!, 15);
    else if (points.length > 1) map.fitBounds(points, { padding: [48, 48], maxZoom: 16 });
    // Refit on new results only, not on every render that rebuilds `points`.
  }, [map, resultsKey]);
  return null;
};

export const BusinessMap = ({
  entries,
  hasSearch,
  searching,
  userPos,
  query,
  onQuery,
  category,
  categories,
  onCategory,
  favorites,
  onToggleFavorite,
  onOpen,
  onClose,
}: {
  entries: readonly MapEntry[];
  /** False until there is enough typed, or a Category, for a search to have run. */
  hasSearch: boolean;
  searching: boolean;
  userPos: GeoPoint | null;
  query: string;
  onQuery: (query: string) => void;
  category: BusinessCategory | null;
  categories: readonly BusinessCategory[];
  onCategory: (category: BusinessCategory | null) => void;
  favorites: ReadonlySet<string>;
  onToggleFavorite: (businessId: string) => void;
  onOpen: (business: BusinessDto) => void;
  onClose: () => void;
}) => {
  const copy = useCopy("customer");
  const { language } = useLanguage();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  const meIcon = useMemo(() => userIcon(copy.youAreHere), [copy.youAreHere]);

  // Search never returns a business without coordinates, but Favorites are fetched by id and still can.
  const located: Located[] = entries.flatMap((entry) =>
    entry.business.latitude != null && entry.business.longitude != null
      ? [{ ...entry, position: [entry.business.latitude, entry.business.longitude] as [number, number] }]
      : [],
  );
  const selected = located.find((entry) => entry.business.id === selectedId) ?? null;
  const resultsKey = located.map((entry) => entry.business.id).join();
  const userPoint: [number, number] | null = userPos === null ? null : [userPos.latitude, userPos.longitude];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isFavorite = selected !== null && favorites.has(selected.business.id);

  return (
    <div className="map-view" role="dialog" aria-modal="true" aria-label={copy.mapButton}>
      <MapContainer
        center={located[0]?.position ?? userPoint ?? FALLBACK_CENTER}
        zoom={14}
        zoomControl={false}
        ref={setMap}
        style={{ position: "absolute", inset: 0 }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitToResults
          resultsKey={resultsKey}
          points={[...located.map((entry) => entry.position), ...(userPoint === null ? [] : [userPoint])]}
        />
        {userPoint !== null && (
          <Marker position={userPoint} icon={meIcon} interactive={false} keyboard={false} title={copy.yourLocation} />
        )}
        {located.map((entry) => (
          <Marker
            key={entry.business.id}
            position={entry.position}
            title={entry.business.name}
            icon={pinIcon(entry.business.category, entry.business.id === selectedId)}
            zIndexOffset={entry.business.id === selectedId ? 1000 : 0}
            eventHandlers={{ click: () => setSelectedId(entry.business.id) }}
          />
        ))}
      </MapContainer>

      <div className="map-panel">
        <div className="map-panel-top">
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="map-round" onClick={onClose} aria-label={copy.closeMap}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </button>
            <label className="map-search">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
                <circle cx="11" cy="11" r="7" stroke="var(--faint)" strokeWidth="2" />
                <path d="m16.5 16.5 4 4" stroke="var(--faint)" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  onQuery(event.target.value);
                  setSelectedId(null);
                }}
                placeholder={
                  category === null
                    ? copy.searchPlaceholder
                    : copy.searchWithin.replace("{category}", categoryLabel(category, language))
                }
                aria-label={copy.searchPlaceholder}
                autoComplete="off"
              />
              {searching && <span className="spinner" />}
            </label>
          </div>
          <div role="group" aria-label={copy.categoryStrip} className="map-chips">
            {categories.map((code) => (
              <Chip
                key={code}
                selected={category === code}
                onClick={() => {
                  onCategory(category === code ? null : code);
                  setSelectedId(null);
                }}
                style={{ gap: 6, flexShrink: 0, whiteSpace: "nowrap" }}
              >
                <CategoryIcon category={code} size={14} />
                {categoryLabel(code, language)}
              </Chip>
            ))}
          </div>
        </div>

        {userPoint !== null && (
          <div className="map-recenter">
            <button
              type="button"
              className="map-round"
              onClick={() => map?.flyTo(userPoint, Math.max(map.getZoom(), 15))}
              aria-label={copy.recenterMap}
              title={copy.recenterMap}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--accent)" aria-hidden="true">
                <path d="M21 3 3 10.5l7.5 3L13.5 21z" />
              </svg>
            </button>
          </div>
        )}

        <div className="map-sheet" role="status">
          {selected !== null ? (
            <>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span className="map-sheet-icon">
                  {selected.business.category != null ? (
                    <CategoryIcon category={selected.business.category} size={20} />
                  ) : (
                    <AllCategoriesIcon size={20} />
                  )}
                </span>
                <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 4 }}>
                  <span className="map-sheet-name">{selected.business.name}</span>
                  {selected.business.address !== null && (
                    <span className="hint" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {selected.business.address}
                    </span>
                  )}
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {selected.business.category != null && (
                      <span style={{ ...tagStyle, background: "var(--sunken)", color: "var(--muted)" }}>
                        {categoryLabel(selected.business.category, language)}
                      </span>
                    )}
                    {selected.distanceKm !== null && (
                      <span style={{ ...tagStyle, background: "var(--accent-soft)", color: "var(--accent-strong)" }}>
                        {distanceLabel(selected.distanceKm, copy)}
                      </span>
                    )}
                    {selected.business.openNow !== undefined && (
                      <span
                        style={{
                          ...tagStyle,
                          background: selected.business.openNow ? "var(--positive-soft)" : "var(--sunken)",
                          color: selected.business.openNow ? "var(--positive)" : "var(--faint)",
                        }}
                      >
                        {selected.business.openNow ? copy.openNow : copy.closedNow}
                      </span>
                    )}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onToggleFavorite(selected.business.id)}
                  aria-pressed={isFavorite}
                  aria-label={isFavorite ? copy.removeFavorite : copy.addFavorite}
                  className="map-round"
                  style={{
                    boxShadow: "none",
                    color: isFavorite ? "var(--critical)" : "var(--faint)",
                    background: isFavorite ? "var(--critical-soft)" : "transparent",
                  }}
                >
                  <HeartIcon filled={isFavorite} />
                </button>
              </div>
              <button type="button" className="primary" onClick={() => onOpen(selected.business)}>
                {copy.bookTime}
              </button>
            </>
          ) : (
            <span className="hint" style={{ textAlign: "center" }}>
              {!hasSearch ? (
                copy.mapSearchPrompt
              ) : searching ? (
                <span className="spinner" />
              ) : located.length === 0 ? (
                copy.noResults
              ) : (
                `${located.length === 1 ? copy.resultCountOne : copy.resultCount.replace("{count}", String(located.length))} · ${copy.mapTapPin}`
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
