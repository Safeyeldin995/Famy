import { useMemo } from "react";
import { WebView } from "react-native-webview";
import { mapDocument, type MapPosition } from "./mapDocument";
export default function MapSurface({
  center,
  interactive,
  onMessage,
}: {
  center: MapPosition;
  interactive: boolean;
  onMessage: (raw: string) => void;
}) {
  const { lat, lng } = center;
  const html = useMemo(() => mapDocument({ lat, lng }, interactive), [lat, lng, interactive]);
  return (
    <WebView
      source={{ html }}
      originWhitelist={["about:blank"]}
      onShouldStartLoadWithRequest={(r) => r.url === "about:blank"}
      javaScriptEnabled
      domStorageEnabled={false}
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      allowFileAccess={false}
      mixedContentMode="never"
      onMessage={(e) => onMessage(e.nativeEvent.data)}
      onError={() => onMessage('{"type":"unavailable"}')}
      style={{ flex: 1, backgroundColor: "#F3EEF0" }}
    />
  );
}
