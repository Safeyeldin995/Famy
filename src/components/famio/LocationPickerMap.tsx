/**
 * Heavy leaflet/react-leaflet chunk — only imported lazily by LocationPicker,
 * never from the initial bundle.
 *
 * The pin is drawn by LocationPicker as a fixed overlay at the map centre; the
 * map itself moves underneath it, which is easier on a phone than dragging a
 * small marker.
 */
import { useEffect } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export type LatLng = { lat: number; lng: number };

function CenterReporter({ onCenterChange }: { onCenterChange: (pos: LatLng) => void }) {
  const map = useMapEvents({
    moveend() {
      const c = map.getCenter();
      onCenterChange({ lat: c.lat, lng: c.lng });
    },
  });
  return null;
}

function FlyTo({ target, signal }: { target: LatLng; signal: number }) {
  const map = useMap();
  useEffect(() => {
    if (signal === 0) return;
    map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 17), { duration: 0.6 });
    // Only an explicit request (signal bump) moves the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal]);
  return null;
}

/** Keeps a non-interactive preview centred on the saved location. */
function FollowCenter({ center }: { center: LatLng }) {
  const map = useMap();
  useEffect(() => {
    map.setView([center.lat, center.lng], map.getZoom(), { animate: false });
  }, [center.lat, center.lng, map]);
  return null;
}

export default function LocationPickerMap({
  center,
  mode,
  onCenterChange,
  onTileError,
  onTileOk,
  flyTarget,
  flySignal = 0,
}: {
  center: LatLng;
  mode: "preview" | "pick";
  onCenterChange?: (pos: LatLng) => void;
  onTileError: () => void;
  onTileOk: () => void;
  flyTarget?: LatLng;
  flySignal?: number;
}) {
  const interactive = mode === "pick";
  return (
    <MapContainer
      center={[center.lat, center.lng]}
      zoom={interactive ? 16 : 15}
      zoomControl={false}
      scrollWheelZoom={interactive}
      dragging={interactive}
      touchZoom={interactive}
      doubleClickZoom={interactive}
      boxZoom={false}
      keyboard={interactive}
      attributionControl
      className="famy-map h-full w-full"
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap"
        eventHandlers={{
          tileerror: () => onTileError(),
          tileload: () => onTileOk(),
        }}
      />
      {interactive && onCenterChange ? <CenterReporter onCenterChange={onCenterChange} /> : null}
      {interactive && flyTarget ? <FlyTo target={flyTarget} signal={flySignal} /> : null}
      {!interactive ? <FollowCenter center={center} /> : null}
    </MapContainer>
  );
}
