import { describe, expect, it } from "vitest";
import { parsePoint, webMercatorToWgs84 } from "./mercator.ts";

describe("parsing a WKT point", () => {
  it("reads x and y out of POINT(x y)", () => {
    expect(parsePoint("POINT(3867913.68 3765498.36)")).toEqual({ x: 3867913.68, y: 3765498.36 });
  });

  it("is null for anything else", () => {
    expect(parsePoint("not a point")).toBeNull();
  });
});

describe("converting Web Mercator (EPSG:3857) to WGS84", () => {
  it("places a real GovMap point (יוספטל 56, בת ים) at its actual coordinates", () => {
    const { latitude, longitude } = webMercatorToWgs84(3867913.6847861563, 3765498.362882002);
    expect(latitude).toBeCloseTo(32.0167, 3);
    expect(longitude).toBeCloseTo(34.7461, 3);
  });
});
