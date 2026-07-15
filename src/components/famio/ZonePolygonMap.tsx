/**
 * Heavy leaflet/react-leaflet chunk for polygon zone geofencing — only
 * imported lazily by ZonePolygonEditor, never from the initial bundle.
 * Mirrors the bundler marker-icon fix and lazy-load pattern already used by
 * LocationPickerMap.
 */
import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Polygon, Circle, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

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
export type OtherZone =
  | { id: string; label: string; boundary_type: "polygon"; polygon: LatLng[] }
  | { id: string; label: string; boundary_type: "circle"; center: LatLng; radiusKm: number };

function ClickToAddVertex({ onAdd }: { onAdd: (pos: LatLng) => void }) {
  useMapEvents({ click(e) { onAdd({ lat: e.latlng.lat, lng: e.latlng.lng }); } });
  return null;
}

function FitToBounds({ points, signal }: { points: LatLng[]; signal: number }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 14, { animate: true });
      return;
    }
    map.fitBounds(points.map((p) => [p.lat, p.lng] as [number, number]), { padding: [24, 24], animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal]);
  return null;
}

export default function ZonePolygonMap({
  polygon,
  onPolygonChange,
  otherZones = [],
  testPoint,
  testPointInside,
  fitSignal,
  onTileError,
  onTileOk,
}: {
  polygon: LatLng[];
  onPolygonChange: (points: LatLng[]) => void;
  otherZones?: OtherZone[];
  testPoint?: LatLng | null;
  testPointInside?: boolean | null;
  fitSignal: number;
  onTileError: () => void;
  onTileOk: () => void;
}) {
  const markerRefs = useRef<Record<number, L.Marker | null>>({});
  const fallbackCenter: LatLng = polygon[0] ?? { lat: 29.9765, lng: 30.9317 };
  const fitPoints = polygon.length > 0 ? polygon : testPoint ? [testPoint] : [];

  return (
    <MapContainer center={[fallbackCenter.lat, fallbackCenter.lng]} zoom={12} scrollWheelZoom className="h-full w-full" attributionControl>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap contributors"
        eventHandlers={{ tileerror: () => onTileError(), tileload: () => onTileOk() }}
      />

      {otherZones.map((z) =>
        z.boundary_type === "polygon" ? (
          <Polygon key={z.id} positions={z.polygon.map((p) => [p.lat, p.lng])} pathOptions={{ color: "#94a3b8", fillOpacity: 0.08, weight: 1, dashArray: "4 4" }} />
        ) : (
          <Circle key={z.id} center={[z.center.lat, z.center.lng]} radius={z.radiusKm * 1000} pathOptions={{ color: "#94a3b8", fillOpacity: 0.08, weight: 1, dashArray: "4 4" }} />
        ),
      )}

      {polygon.length >= 2 && (
        <Polygon positions={polygon.map((p) => [p.lat, p.lng])} pathOptions={{ color: "#142B6F", fillColor: "#142B6F", fillOpacity: 0.18, weight: 2 }} />
      )}

      {polygon.map((pt, i) => (
        <Marker
          key={i}
          position={[pt.lat, pt.lng]}
          draggable
          ref={(m) => { markerRefs.current[i] = m; }}
          eventHandlers={{
            dragend: () => {
              const m = markerRefs.current[i];
              if (!m) return;
              const pos = m.getLatLng();
              const next = polygon.slice();
              next[i] = { lat: pos.lat, lng: pos.lng };
              onPolygonChange(next);
            },
          }}
        />
      ))}

      {testPoint && (
        <Circle
          center={[testPoint.lat, testPoint.lng]}
          radius={80}
          pathOptions={{
            color: testPointInside == null ? "#94a3b8" : testPointInside ? "#16a34a" : "#dc2626",
            fillColor: testPointInside == null ? "#94a3b8" : testPointInside ? "#16a34a" : "#dc2626",
            fillOpacity: 0.5,
          }}
        />
      )}

      <ClickToAddVertex onAdd={(pos) => onPolygonChange([...polygon, pos])} />
      <FitToBounds points={fitPoints} signal={fitSignal} />
    </MapContainer>
  );
}
