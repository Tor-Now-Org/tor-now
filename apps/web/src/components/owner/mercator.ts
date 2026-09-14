/**
 * GovMap's autocomplete endpoint returns `shape: "POINT(x y)"` in Web
 * Mercator (EPSG:3857) — a spherical projection built directly on WGS84, so
 * (unlike ITM/EPSG:2039) converting it back is exact closed-form math with
 * no ellipsoid/datum-shift parameters to get wrong. No library needed.
 */

const EARTH_RADIUS = 6378137;

export const parsePoint = (shape: string): { x: number; y: number } | null => {
  const match = /POINT\(([-\d.]+)\s+([-\d.]+)\)/.exec(shape);
  if (!match) return null;
  return { x: Number(match[1]), y: Number(match[2]) };
};

export const webMercatorToWgs84 = (x: number, y: number): { latitude: number; longitude: number } => ({
  longitude: (x / EARTH_RADIUS) * (180 / Math.PI),
  latitude: (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * (180 / Math.PI),
});
