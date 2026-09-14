/**
 * The rules behind the address autocomplete: when a query is worth sending to
 * Nominatim, how its response becomes a `Suggestion`, and how arrow keys move
 * through the list. Pure, and in its own file for it — see week.ts.
 */

export type Suggestion = {
  readonly displayName: string;
  readonly latitude: number;
  readonly longitude: number;
};

/** The fields `addressdetails=1` breaks an address into; every one is optional. */
export type NominatimAddress = {
  house_number?: string;
  road?: string;
  neighbourhood?: string;
  suburb?: string;
  city?: string;
  town?: string;
  village?: string;
  state?: string;
  country?: string;
};

export type NominatimResult = {
  display_name: string;
  lat: string;
  lon: string;
  /** The matched place's own name — the road name, for a road result. */
  name?: string;
  address?: NominatimAddress;
};

export const MIN_QUERY_LENGTH = 3;

/** Below this length a search would mostly return noise, so none is sent. */
export const isSearchable = (query: string): boolean =>
  query.trim().length >= MIN_QUERY_LENGTH;

export const buildNominatimUrl = (query: string, language: "he" | "en"): string => {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("q", query.trim());
  url.searchParams.set("limit", "5");
  url.searchParams.set("accept-language", language);
  // Structured fields to build a short label from, instead of guessing at
  // commas in `display_name` — which is a full administrative hierarchy
  // (street, neighbourhood, city, district, region, postcode, country) meant
  // for disambiguation, not for reading.
  url.searchParams.set("addressdetails", "1");
  return url.toString();
};

/** display_name has no structure to trim by; used only when addressdetails is absent. */
const firstTwoParts = (displayName: string): string =>
  displayName
    .split(",")
    .map((part) => part.trim())
    .slice(0, 2)
    .join(", ");

/**
 * OSM's address-point coverage is patchy — most Israeli streets exist as a
 * road line with no individual building numbers mapped, so Nominatim often
 * has no `house_number` even when the street match is exact. The number the
 * owner actually typed is the best fallback available; it names what they
 * meant, even though the pin still only resolves to street-level accuracy.
 */
export const extractHouseNumber = (query: string): string | null =>
  query.match(/\d+[a-zA-Zא-ת]?/)?.[0] ?? null;

/** The street (with its number, where Nominatim knows one) and the locality. */
export const shortAddress = (
  result: NominatimResult,
  language: "he" | "en",
  typedHouseNumber: string | null = null,
): string => {
  const address = result.address;
  const street = address?.road ?? result.name ?? null;
  const houseNumber = address?.house_number ?? typedHouseNumber ?? null;
  const streetLine =
    street === null
      ? null
      : houseNumber === null
        ? street
        : language === "he"
          ? `${street} ${houseNumber}`
          : `${houseNumber} ${street}`;
  const locality =
    address?.city ?? address?.town ?? address?.village ?? address?.suburb ?? address?.neighbourhood ?? null;
  const parts = [streetLine, locality].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(", ") : firstTwoParts(result.display_name);
};

/**
 * Nominatim's `lat`/`lon` travel as strings; a non-numeric one is dropped.
 *
 * Israeli streets are often mapped as several disconnected OSM way segments
 * sharing one name, with house numbers rarely present — so a single street
 * routinely comes back as multiple results that all format to the same
 * label. Keep the first (Nominatim's own relevance order) of each label.
 */
export const toSuggestions = (
  results: readonly NominatimResult[],
  language: "he" | "en",
  query: string,
): readonly Suggestion[] => {
  const typedHouseNumber = extractHouseNumber(query);
  const seen = new Set<string>();
  return results
    .map((result) => ({
      displayName: shortAddress(result, language, typedHouseNumber),
      latitude: Number(result.lat),
      longitude: Number(result.lon),
    }))
    .filter((suggestion) => Number.isFinite(suggestion.latitude) && Number.isFinite(suggestion.longitude))
    .filter((suggestion) => (seen.has(suggestion.displayName) ? false : (seen.add(suggestion.displayName), true)));
};

/** Wraps in both directions, so the last suggestion follows the first. */
export const moveIndex = (current: number, length: number, direction: 1 | -1): number => {
  if (length === 0) return -1;
  return (current + direction + length) % length;
};
