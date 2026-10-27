import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import Constants from "expo-constants";
import MapView, { PROVIDER_GOOGLE, type Region } from "react-native-maps";

import type { MapPosition } from "./mapMessages";

function hasNativeGoogleMapsKey(): boolean {
  const expo = Constants.expoConfig;
  const androidKey = expo?.android?.config?.googleMaps?.apiKey;
  const iosKey = expo?.ios?.config?.googleMapsApiKey;
  return Boolean(String(androidKey ?? "").trim() || String(iosKey ?? "").trim());
}

function regionForCenter(center: MapPosition, interactive: boolean): Region {
  const delta = interactive ? 0.004 : 0.008;
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
}: {
  center: MapPosition;
  interactive: boolean;
  onMessage: (raw: string) => void;
}) {
  const [ready, setReady] = useState(false);
  const keyConfigured = useMemo(() => hasNativeGoogleMapsKey(), []);
  const region = useMemo(() => regionForCenter(center, interactive), [center, interactive]);
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
    />
  );
}
