/**
 * Heavy Google Maps chunk — only imported lazily by LocationPicker, never from
 * the initial bundle.
 *
 * The pin is drawn by LocationPicker as a fixed overlay at the map centre; the
 * map itself moves underneath it.
 */
import { useEffect, useState } from "react";
import { Map, useMap } from "@vis.gl/react-google-maps";

import { GoogleMapsBrowserProvider, useReportMapTilesOk } from "./googleMapsBrowser";

export type LatLng = { lat: number; lng: number };

function CenterReporter({ onCenterChange }: { onCenterChange: (pos: LatLng) => void }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const listener = map.addListener("idle", () => {
      const c = map.getCenter();
      if (!c) return;
      onCenterChange({ lat: c.lat(), lng: c.lng() });
    });
    return () => listener.remove();
  }, [map, onCenterChange]);
  return null;
}

function FlyTo({ target, signal }: { target: LatLng; signal: number }) {
  const map = useMap();
  useEffect(() => {
    if (signal === 0 || !map) return;
    const zoom = Math.max(map.getZoom() ?? 16, 17);
    map.moveCamera({ center: { lat: target.lat, lng: target.lng }, zoom });
    // Only an explicit request (signal bump) moves the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal]);
  return null;
}

function FollowCenter({ center }: { center: LatLng }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    map.setCenter({ lat: center.lat, lng: center.lng });
  }, [center.lat, center.lng, map]);
  return null;
}

function LocationPickerMapInner({
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
  const [tilesLoaded, setTilesLoaded] = useState(false);
  const reportOk = useReportMapTilesOk(onTileOk);

  return (
    <GoogleMapsBrowserProvider onTileError={onTileError} tilesLoaded={tilesLoaded}>
      <Map
        defaultCenter={{ lat: center.lat, lng: center.lng }}
        defaultZoom={interactive ? 16 : 15}
        disableDefaultUI
        zoomControl={false}
        gestureHandling={interactive ? "greedy" : "none"}
        scrollwheel={interactive}
        draggable={interactive}
        keyboardShortcuts={interactive}
        disableDoubleClickZoom={!interactive}
        clickableIcons={false}
        className="famy-map h-full w-full"
        onTilesLoaded={() => {
          setTilesLoaded(true);
          reportOk();
        }}
      >
        {interactive && onCenterChange ? <CenterReporter onCenterChange={onCenterChange} /> : null}
        {interactive && flyTarget ? <FlyTo target={flyTarget} signal={flySignal} /> : null}
        {!interactive ? <FollowCenter center={center} /> : null}
      </Map>
    </GoogleMapsBrowserProvider>
  );
}

export default LocationPickerMapInner;
