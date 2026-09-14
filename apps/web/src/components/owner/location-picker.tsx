"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapContainer, Marker, TileLayer } from "react-leaflet";

/**
 * A read-only confirmation of the pin the address autocomplete resolved to.
 * The coordinates come from that selection, not from anything drawn here —
 * see address-autocomplete.tsx.
 */

// react-leaflet's default marker image paths break under Next's bundler; the
// standard fix is pointing them at the package's own published assets.
const MARKER_ICON = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

const DEFAULT_ZOOM = 15;

export const LocationPicker = ({
  latitude,
  longitude,
}: {
  latitude: number;
  longitude: number;
}) => {
  const position: [number, number] = [latitude, longitude];

  return (
    <div style={{ height: 200, borderRadius: 12, overflow: "hidden" }}>
      <MapContainer
        key={`${latitude},${longitude}`}
        center={position}
        zoom={DEFAULT_ZOOM}
        dragging={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        touchZoom={false}
        zoomControl={false}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={position} icon={MARKER_ICON} />
      </MapContainer>
    </div>
  );
};
