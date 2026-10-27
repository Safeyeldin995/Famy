import { createElement, useEffect, useMemo, useRef } from "react";
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
  const ref = useRef<HTMLIFrameElement>(null);
  const { lat, lng } = center;
  const html = useMemo(() => mapDocument({ lat, lng }, interactive), [lat, lng, interactive]);
  useEffect(() => {
    const handle = (e: MessageEvent) => {
      if (e.source === ref.current?.contentWindow && typeof e.data === "string") onMessage(e.data);
    };
    window.addEventListener("message", handle);
    return () => window.removeEventListener("message", handle);
  }, [onMessage]);
  return createElement("iframe", {
    ref,
    title: "OpenStreetMap",
    srcDoc: html,
    sandbox: "allow-scripts",
    style: { border: 0, width: "100%", height: "100%" },
  });
}
