import { createElement, useEffect, useMemo, useRef } from "react";

import {
  getExpoPublicGoogleMapsBrowserKey,
  googleMapDocument,
  type MapPosition,
} from "./mapMessages";

export default function MapSurface({
  center,
  interactive,
  onMessage,
}: {
  center: MapPosition;
  interactive: boolean;
  onMessage: (raw: string) => void;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const apiKey = getExpoPublicGoogleMapsBrowserKey();
  const { lat, lng } = center;
  const html = useMemo(() => {
    if (!apiKey) return null;
    try {
      return googleMapDocument({ lat, lng }, interactive, apiKey);
    } catch {
      return null;
    }
  }, [apiKey, lat, lng, interactive]);

  useEffect(() => {
    if (!apiKey || !html) onMessage('{"type":"unavailable"}');
  }, [apiKey, html, onMessage]);

  useEffect(() => {
    const handle = (e: MessageEvent) => {
      if (e.source === ref.current?.contentWindow && typeof e.data === "string") onMessage(e.data);
    };
    window.addEventListener("message", handle);
    return () => window.removeEventListener("message", handle);
  }, [onMessage]);

  if (!html) {
    return createElement("div", {
      style: { width: "100%", height: "100%", backgroundColor: "#F3EEF0" },
    });
  }

  return createElement("iframe", {
    ref,
    title: "Google Maps",
    srcDoc: html,
    sandbox: "allow-scripts",
    style: { border: 0, width: "100%", height: "100%" },
  });
}
