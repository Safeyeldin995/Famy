import { Component, Suspense, lazy, useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Undo2, Trash2, Maximize2, MapPinOff, Loader2, RefreshCw } from "lucide-react";
import type { LatLng, OtherZone } from "./ZonePolygonMap";

const LazyMap = lazy(() => import("./ZonePolygonMap"));

export type { LatLng, OtherZone };

class MapErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode; resetKey: number }, { hasError: boolean }> {
  constructor(props: { children: ReactNode; fallback: ReactNode; resetKey: number }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidUpdate(prev: { resetKey: number }) {
    if (prev.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

export function ZonePolygonEditor({
  polygon,
  onChange,
  otherZones = [],
  testPoint,
  testPointInside,
  className = "",
}: {
  polygon: LatLng[];
  onChange: (points: LatLng[]) => void;
  otherZones?: OtherZone[];
  testPoint?: LatLng | null;
  testPointInside?: boolean | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const [tileFailing, setTileFailing] = useState(false);
  const [mapKey, setMapKey] = useState(0);
  const [fitSignal, setFitSignal] = useState(0);
  const okCountRef = useState({ ok: 0, err: 0 })[0];

  const handleTileError = useCallback(() => {
    okCountRef.err += 1;
    if (okCountRef.err >= 3 && okCountRef.ok === 0) setTileFailing(true);
  }, [okCountRef]);
  const handleTileOk = useCallback(() => {
    okCountRef.ok += 1;
    setTileFailing(false);
  }, [okCountRef]);

  const retryMap = () => {
    okCountRef.ok = 0;
    okCountRef.err = 0;
    setTileFailing(false);
    setMapKey((k) => k + 1);
  };

  return (
    <div className={className}>
      <div className="relative h-80 overflow-hidden rounded-2xl bg-surface-2">
        {!tileFailing ? (
          <MapErrorBoundary resetKey={mapKey} fallback={<MapUnavailable onRetry={retryMap} />}>
            <Suspense fallback={<MapLoading />}>
              <LazyMap
                key={mapKey}
                polygon={polygon}
                onPolygonChange={onChange}
                otherZones={otherZones}
                testPoint={testPoint}
                testPointInside={testPointInside}
                fitSignal={fitSignal}
                onTileError={handleTileError}
                onTileOk={handleTileOk}
              />
            </Suspense>
          </MapErrorBoundary>
        ) : (
          <MapUnavailable onRetry={retryMap} />
        )}

        <div className="absolute bottom-3 end-3 z-[500] flex flex-col gap-2">
          <button type="button" onClick={() => setFitSignal((s) => s + 1)} aria-label={t("admin.zones.fitToZone", "Fit to zone")}
            className="focus-ring grid h-10 w-10 place-items-center rounded-full bg-surface text-navy shadow-card active:scale-95">
            <Maximize2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => onChange(polygon.slice(0, -1))} disabled={polygon.length === 0}
            aria-label={t("admin.zones.undoPoint", "Undo last point")}
            className="focus-ring grid h-10 w-10 place-items-center rounded-full bg-surface text-navy shadow-card active:scale-95 disabled:opacity-40">
            <Undo2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => onChange([])} disabled={polygon.length === 0}
            aria-label={t("admin.zones.clearPolygon", "Clear polygon")}
            className="focus-ring grid h-10 w-10 place-items-center rounded-full bg-surface text-coral shadow-card active:scale-95 disabled:opacity-40">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {t("admin.zones.polygonHint", "Tap the map to add boundary points, drag a point to adjust it, or use the buttons to undo/clear.")}
      </p>
      <p className="mt-1 text-[11px] font-semibold text-muted-foreground" dir="ltr">
        {t("admin.zones.pointCount", "{{count}} points", { count: polygon.length })}
      </p>
    </div>
  );
}

function MapLoading() {
  const { t } = useTranslation();
  return (
    <div className="grid h-full w-full place-items-center">
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-xs font-semibold">{t("addresses.mapLoading", "Loading map…")}</span>
      </div>
    </div>
  );
}

function MapUnavailable({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="grid h-full w-full place-items-center px-6 text-center">
      <div className="flex flex-col items-center gap-2">
        <MapPinOff className="h-6 w-6 text-muted-foreground" />
        <span className="text-xs font-bold">{t("addresses.mapUnavailable", "Map unavailable right now")}</span>
        <button type="button" onClick={onRetry}
          className="focus-ring mt-1 inline-flex items-center gap-1.5 rounded-xl bg-navy px-3 py-2 text-xs font-bold text-navy-foreground">
          <RefreshCw className="h-3.5 w-3.5" /> {t("common.retry")}
        </button>
      </div>
    </div>
  );
}
