/**
 * Israel's official address search — no token, confirmed live: the endpoint
 * responds to a bare `fetch` with `access-control-allow-origin: *` and no
 * auth of any kind. It is undocumented (found via a third-party write-up,
 * not api.govmap.gov.il) and Hebrew-only — an English `searchText` reliably
 * returns zero results, and any field beyond `searchText` in the body makes
 * the whole request return zero results too, so the body stays minimal.
 * Being undocumented, it could change or start rate-limiting without
 * notice — callers should keep a fallback (see address-autocomplete.tsx).
 */

const SEARCH_URL = "https://www.govmap.gov.il/api/search-service/autocomplete";

export type GovMapMatch = {
  text: string;
  originalText?: string;
  type: string;
  /** e.g. "POINT(3867913.68 3765498.36)" in EPSG:3857 (Web Mercator). */
  shape: string;
};

export type GovMapAutocompleteResponse = {
  results: readonly GovMapMatch[];
};

export const geocodeAddress = async (keyword: string): Promise<GovMapAutocompleteResponse> => {
  const response = await fetch(SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ searchText: keyword }),
  });
  if (!response.ok) throw new Error(`GovMap autocomplete failed: ${response.status}`);
  return (await response.json()) as GovMapAutocompleteResponse;
};
