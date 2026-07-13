/**
 * Heavy leaflet/react-leaflet chunk — only imported lazily by LocationPicker,
 * never from the initial bundle.
 */
import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fixes the well-known bundler issue where Leaflet's default marker icon
// resolves relative to document location instead of the bundled asset URL.
// Bundled locally via Vite's asset pipeline — no CDN reference.
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

const defaultIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = defaultIcon;

export type LatLng = { lat: number; lng: number };

function ClickHandler({ onPick }: { onPick: (pos: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

export default function LocationPickerMap({
  value,
  onChange,
  onTileError,
  onTileOk,
  recenterSignal,
}: {
  value: LatLng;
  onChange: (pos: LatLng) => void;
  onTileError: () => void;
  onTileOk: () => void;
  recenterSignal: number;
}) {
  const markerRef = useRef<L.Marker | null>(null);

  return (
    <MapContainer
      center={[value.lat, value.lng]}
      zoom={15}
      scrollWheelZoom={false}
      className="h-full w-full"
      attributionControl={true}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap contributors"
        eventHandlers={{
          tileerror: () => onTileError(),
          tileload: () => onTileOk(),
        }}
      />
      <Marker
        position={[value.lat, value.lng]}
        draggable
        ref={markerRef}
        eventHandlers={{
          dragend: () => {
            const m = markerRef.current;
            if (!m) return;
            const pos = m.getLatLng();
            onChange({ lat: pos.lat, lng: pos.lng });
          },
        }}
      />
      <ClickHandler onPick={onChange} />
      <RecenterRef signal={recenterSignal} center={value} />
    </MapContainer>
  );
}

// Recenter-on-demand (the explicit "recenter" button) is a distinct signal
// from RecenterOnChange (which follows every coordinate change) so both can
// coexist without fighting over the map's view.
function RecenterRef({ signal, center }: { signal: number; center: LatLng }) {
  const map = useMap();
  useEffect(() => {
    if (signal === 0) return;
    map.setView([center.lat, center.lng], map.getZoom(), { animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal]);
  return null;
}
