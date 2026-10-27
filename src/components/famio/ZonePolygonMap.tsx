/**
 * Heavy Google Maps chunk for polygon zone geofencing — only imported lazily by
 * ZonePolygonEditor, never from the initial bundle.
 */
import { useEffect, useState } from "react";
import { Circle, Map, Marker, Polygon, useMap } from "@vis.gl/react-google-maps";

import { GoogleMapsBrowserProvider, useReportMapTilesOk } from "./googleMapsBrowser";

export type LatLng = { lat: number; lng: number };
export type OtherZone =
  | { id: string; label: string; boundary_type: "polygon"; polygon: LatLng[] }
  | { id: string; label: string; boundary_type: "circle"; center: LatLng; radiusKm: number };

function FitToBounds({ points, signal }: { points: LatLng[]; signal: number }) {
  const map = useMap();
  useEffect(() => {
    if (!map || points.length === 0) return;
    if (points.length === 1) {
      map.setCenter({ lat: points[0].lat, lng: points[0].lng });
      map.setZoom(14);
      return;
    }
    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    map.fitBounds(
      {
        north: Math.max(...lats),
        south: Math.min(...lats),
        east: Math.max(...lngs),
        west: Math.min(...lngs),
      },
      24,
    );
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
  const fallbackCenter: LatLng = polygon[0] ?? { lat: 29.9765, lng: 30.9317 };
  const fitPoints = polygon.length > 0 ? polygon : testPoint ? [testPoint] : [];
  const [tilesLoaded, setTilesLoaded] = useState(false);
  const reportOk = useReportMapTilesOk(onTileOk);

  return (
    <GoogleMapsBrowserProvider onTileError={onTileError} tilesLoaded={tilesLoaded}>
      <Map
        defaultCenter={{ lat: fallbackCenter.lat, lng: fallbackCenter.lng }}
        defaultZoom={12}
        disableDefaultUI
        gestureHandling="greedy"
        scrollwheel
        draggable
        keyboardShortcuts
        className="famy-zone-map h-full w-full"
        onClick={(e) => {
          const latLng = e.detail.latLng;
          if (!latLng) return;
          onPolygonChange([...polygon, { lat: latLng.lat, lng: latLng.lng }]);
        }}
        onTilesLoaded={() => {
          setTilesLoaded(true);
          reportOk();
        }}
      >
        {otherZones.map((z) =>
          z.boundary_type === "polygon" ? (
            <Polygon
              key={z.id}
              paths={z.polygon.map((p) => ({ lat: p.lat, lng: p.lng }))}
              strokeColor="#94a3b8"
              fillColor="#94a3b8"
              fillOpacity={0.08}
              strokeWeight={1}
              clickable={false}
            />
          ) : (
            <Circle
              key={z.id}
              center={{ lat: z.center.lat, lng: z.center.lng }}
              radius={z.radiusKm * 1000}
              strokeColor="#94a3b8"
              fillColor="#94a3b8"
              fillOpacity={0.08}
              strokeWeight={1}
              clickable={false}
            />
          ),
        )}

        {polygon.length >= 2 ? (
          <Polygon
            paths={polygon.map((p) => ({ lat: p.lat, lng: p.lng }))}
            strokeColor="#142B6F"
            fillColor="#142B6F"
            fillOpacity={0.18}
            strokeWeight={2}
            clickable={false}
          />
        ) : null}

        {polygon.map((pt, i) => (
          <Marker
            key={i}
            position={{ lat: pt.lat, lng: pt.lng }}
            draggable
            onDragEnd={(e) => {
              const pos = e.latLng;
              if (!pos) return;
              const next = polygon.slice();
              next[i] = { lat: pos.lat(), lng: pos.lng() };
              onPolygonChange(next);
            }}
          />
        ))}

        {testPoint ? (
          <Circle
            center={{ lat: testPoint.lat, lng: testPoint.lng }}
            radius={80}
            strokeColor={
              testPointInside == null ? "#94a3b8" : testPointInside ? "#16a34a" : "#dc2626"
            }
            fillColor={
              testPointInside == null ? "#94a3b8" : testPointInside ? "#16a34a" : "#dc2626"
            }
            fillOpacity={0.5}
            clickable={false}
          />
        ) : null}

        <FitToBounds points={fitPoints} signal={fitSignal} />
      </Map>
    </GoogleMapsBrowserProvider>
  );
}
