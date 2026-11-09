import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, View } from "react-native";
import Constants from "expo-constants";
import MapView, { Circle, Polygon, PROVIDER_GOOGLE, type Region } from "react-native-maps";
import type { ServiceZone } from "@shared/geo/serviceZones";
import { colors } from "../theme";

import type { MapPosition } from "./mapMessages";

function hasNativeGoogleMapsKey(): boolean {
  const configured = Constants.expoConfig?.extra?.googleMapsConfigured as
    { android?: boolean; ios?: boolean } | undefined;
  return Platform.OS === "ios" ? !!configured?.ios : !!configured?.android;
}

function regionForCenter(center: MapPosition, interactive: boolean, wide: boolean): Region {
  // "wide" opens on a whole service area (no pin yet); otherwise street level.
  const delta = wide ? 0.08 : interactive ? 0.004 : 0.008;
  return {
    latitude: center.lat,
    longitude: center.lng,
    latitudeDelta: delta,
    longitudeDelta: delta,
  };
}

export default function MapSurface({
  center,
  interactive,
  onMessage,
  zones,
  wide = false,
}: {
  center: MapPosition;
  interactive: boolean;
  onMessage: (raw: string) => void;
  /** Service zones drawn as shaded areas so customers see where Famy works. */
  zones?: ServiceZone[];
  wide?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const keyConfigured = useMemo(() => hasNativeGoogleMapsKey(), []);
  const region = useMemo(
    () => regionForCenter(center, interactive, wide),
    [center, interactive, wide],
  );
  const reportedReady = useRef(false);

  useEffect(() => {
    if (!keyConfigured) {
      onMessage('{"type":"unavailable"}');
    }
  }, [keyConfigured, onMessage]);

  useEffect(() => {
    if (!keyConfigured) return;
    const timer = setTimeout(() => {
      if (!reportedReady.current) onMessage('{"type":"unavailable"}');
    }, 10_000);
    return () => clearTimeout(timer);
  }, [keyConfigured, onMessage, center.lat, center.lng, interactive]);

  if (!keyConfigured) {
    return <View style={{ flex: 1, backgroundColor: "#F3EEF0" }} />;
  }

  return (
    <MapView
      provider={PROVIDER_GOOGLE}
      style={{ flex: 1 }}
      initialRegion={region}
      region={interactive ? undefined : region}
      scrollEnabled={interactive}
      zoomEnabled={interactive}
      rotateEnabled={false}
      pitchEnabled={false}
      showsCompass={false}
      toolbarEnabled={false}
      onMapReady={() => {
        reportedReady.current = true;
        setReady(true);
      }}
      onMapLoaded={() => {
        reportedReady.current = true;
        setReady(true);
      }}
      onRegionChangeComplete={(next) => {
        if (!interactive || !ready) return;
        onMessage(JSON.stringify({ type: "center", lat: next.latitude, lng: next.longitude }));
      }}
    >
      {(zones ?? []).map((zone) =>
        zone.boundary_type === "polygon" && (zone.polygon?.length ?? 0) >= 3 ? (
          <Polygon
            key={zone.id}
            coordinates={zone.polygon!.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
            strokeColor={colors.brand}
            fillColor="rgba(241, 14, 114, 0.12)"
            strokeWidth={2}
          />
        ) : zone.boundary_type === "circle" &&
          zone.center_lat != null &&
          zone.center_lng != null ? (
          <Circle
            key={zone.id}
            center={{ latitude: zone.center_lat, longitude: zone.center_lng }}
            radius={Number(zone.radius_km) * 1000}
            strokeColor={colors.brand}
            fillColor="rgba(241, 14, 114, 0.12)"
            strokeWidth={2}
          />
        ) : null,
      )}
    </MapView>
  );
}
