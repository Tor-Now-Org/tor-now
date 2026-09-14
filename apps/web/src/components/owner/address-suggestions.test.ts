import { describe, expect, it } from "vitest";
import {
  buildNominatimUrl,
  extractHouseNumber,
  isSearchable,
  moveIndex,
  shortAddress,
  toSuggestions,
} from "./address-suggestions.ts";

describe("whether a query is worth searching", () => {
  it("refuses fewer than three characters", () => {
    expect(isSearchable("")).toBe(false);
    expect(isSearchable("he")).toBe(false);
  });

  it("ignores surrounding whitespace when counting", () => {
    expect(isSearchable("  he  ")).toBe(false);
    expect(isSearchable("  her  ")).toBe(true);
  });

  it("accepts three characters or more", () => {
    expect(isSearchable("her")).toBe(true);
    expect(isSearchable("herzl")).toBe(true);
  });
});

describe("the Nominatim request built from a query", () => {
  it("carries the trimmed query, a result cap and the reader's language", () => {
    const url = new URL(buildNominatimUrl("  1 Herzl St  ", "he"));
    expect(url.origin + url.pathname).toBe("https://nominatim.openstreetmap.org/search");
    expect(url.searchParams.get("q")).toBe("1 Herzl St");
    expect(url.searchParams.get("format")).toBe("json");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("accept-language")).toBe("he");
    expect(url.searchParams.get("addressdetails")).toBe("1");
  });
});

describe("building a short address from Nominatim's structured fields", () => {
  // A real `addressdetails=1` response for "אהוד מנור, חולון".
  const ehudManor = {
    display_name:
      "אהוד מנור, חולון, קרית פנחס אילון, חולון, נפת תל אביב, מחוז תל אביב, 5846112, ישראל",
    lat: "32.0058588",
    lon: "34.7749755",
    name: "אהוד מנור",
    address: {
      road: "אהוד מנור",
      suburb: "קרית פנחס אילון",
      town: "חולון",
      state_district: "נפת תל אביב",
      state: "מחוז תל אביב",
      postcode: "5846112",
      country: "ישראל",
    },
  };

  it("keeps only the road and the locality, not the district/region/postcode/country tail", () => {
    expect(shortAddress(ehudManor, "he")).toBe("אהוד מנור, חולון");
  });

  it("puts the house number after the street in Hebrew and before it in English", () => {
    const withNumber = {
      ...ehudManor,
      address: { ...ehudManor.address, road: "הרצל", house_number: "1" },
    };
    expect(shortAddress(withNumber, "he")).toBe("הרצל 1, חולון");
    expect(shortAddress(withNumber, "en")).toBe("1 הרצל, חולון");
  });

  it("falls back to the matched place's own name when there is no road", () => {
    expect(
      shortAddress(
        { display_name: "Rustic Cuts, Tel Aviv, Israel", lat: "0", lon: "0", name: "Rustic Cuts", address: { city: "Tel Aviv" } },
        "en",
      ),
    ).toBe("Rustic Cuts, Tel Aviv");
  });

  it("falls back to the first two parts of display_name when there is no address breakdown at all", () => {
    expect(
      shortAddress({ display_name: "1 Herzl St, Tel Aviv, Tel Aviv District, Israel", lat: "0", lon: "0" }, "en"),
    ).toBe("1 Herzl St, Tel Aviv");
  });

  it("uses the number the owner typed when OSM has no house_number for the match", () => {
    // OSM's address-point coverage is sparse — a road often matches with no
    // house_number at all, even when the street itself is exact.
    expect(shortAddress(ehudManor, "he", "5")).toBe("אהוד מנור 5, חולון");
  });

  it("prefers OSM's own house_number over the typed one when both exist", () => {
    const withNumber = {
      ...ehudManor,
      address: { ...ehudManor.address, road: "הרצל", house_number: "1" },
    };
    expect(shortAddress(withNumber, "he", "99")).toBe("הרצל 1, חולון");
  });
});

describe("pulling a house number out of what the owner typed", () => {
  it("finds a bare number", () => {
    expect(extractHouseNumber("אהוד מנור 5 חולון")).toBe("5");
    expect(extractHouseNumber("1 Herzl St")).toBe("1");
  });

  it("keeps a single trailing letter, e.g. a subdivided building", () => {
    expect(extractHouseNumber("הרצל 5א")).toBe("5א");
    expect(extractHouseNumber("12a Main St")).toBe("12a");
  });

  it("is null when the query has no number", () => {
    expect(extractHouseNumber("אהוד מנור חולון")).toBeNull();
  });
});

describe("turning a Nominatim response into suggestions", () => {
  it("builds the short address and parses lat/lon out of their strings", () => {
    expect(
      toSuggestions(
        [
          {
            display_name: "1 Herzl St, Tel Aviv, Tel Aviv District, Israel",
            lat: "32.0809",
            lon: "34.7695",
            name: "Herzl St",
            address: { road: "Herzl St", house_number: "1", city: "Tel Aviv" },
          },
        ],
        "en",
        "1 Herzl St",
      ),
    ).toEqual([{ displayName: "1 Herzl St, Tel Aviv", latitude: 32.0809, longitude: 34.7695 }]);
  });

  it("falls back to the number typed in the query when a result has none of its own", () => {
    expect(
      toSuggestions(
        [
          {
            display_name: "אהוד מנור, חולון, ישראל",
            lat: "32.0058588",
            lon: "34.7749755",
            name: "אהוד מנור",
            address: { road: "אהוד מנור", town: "חולון" },
          },
        ],
        "he",
        "אהוד מנור 5 חולון",
      ),
    ).toEqual([{ displayName: "אהוד מנור 5, חולון", latitude: 32.0058588, longitude: 34.7749755 }]);
  });

  it("drops a result whose coordinates are not real numbers", () => {
    expect(
      toSuggestions([{ display_name: "Nowhere", lat: "not-a-number", lon: "34.7695" }], "en", "Nowhere"),
    ).toEqual([]);
  });

  it("is empty for an empty response", () => {
    expect(toSuggestions([], "en", "")).toEqual([]);
  });
});

describe("moving the active suggestion with the arrow keys", () => {
  it("starts the list at the first suggestion", () => {
    expect(moveIndex(-1, 3, 1)).toBe(0);
  });

  it("starts a reverse pass at the last suggestion", () => {
    expect(moveIndex(-1, 3, -1)).toBe(1);
  });

  it("wraps from the last suggestion back to the first", () => {
    expect(moveIndex(2, 3, 1)).toBe(0);
  });

  it("wraps from the first suggestion back to the last", () => {
    expect(moveIndex(0, 3, -1)).toBe(2);
  });

  it("has nowhere to move when there are no suggestions", () => {
    expect(moveIndex(-1, 0, 1)).toBe(-1);
  });
});
