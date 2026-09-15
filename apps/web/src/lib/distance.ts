export type GeoPoint = { latitude: number; longitude: number };

const EARTH_RADIUS_KM = 6371;

/** Haversine: straight-line distance, not the route. */
export const distanceKm = (a: GeoPoint, b: GeoPoint): number => {
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

export const distanceLabel = (
  km: number,
  copy: { distanceMeters: string; distanceKm: string },
): string =>
  km < 1
    ? copy.distanceMeters.replace("{value}", String(Math.round(km * 1000)))
    : copy.distanceKm.replace("{value}", km.toFixed(1));
