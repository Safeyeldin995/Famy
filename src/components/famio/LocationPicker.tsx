import { Component, Suspense, lazy, useCallback, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LocateFixed, MapPin, MapPinOff, Crosshair, Loader2, RefreshCw } from "lucide-react";
import type { LatLng } from "./LocationPickerMap";

const LazyMap = lazy(() => import("./LocationPickerMap"));

const GIZA_FALLBACK: LatLng = { lat: 29.9765, lng: 30.9317 }; // Sheikh Zayed / 6th of October area

function isValidLatLng(v: LatLng | null | undefined): v is LatLng {
  return !!v && Number.isFinite(v.lat) && Number.isFinite(v.lng) && v.lat >= -90 && v.lat <= 90 && v.lng >= -180 && v.lng <= 180;
}

class MapErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode; resetKey: number }, { hasError: boolean }> {
  constructor(props: { children: ReactNode; fallback: ReactNode; resetKey: number }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidUpdate(prev: { resetKey: number }) {
    // Only the explicit "retry" action (which bumps mapKey) clears a crash —
    // never an incidental re-render, since children is a fresh element every render.
    if (prev.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

export { isValidLatLng };

export function LocationPicker({
  value,
  onChange,
  className = "",
}: {
  value: LatLng | null;
  onChange: (pos: LatLng) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [locating, setLocating] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [tileFailing, setTileFailing] = useState(false);
  const [mapKey, setMapKey] = useState(0);
  const [recenterSignal, setRecenterSignal] = useState(0);
  const tileOkRef = useRef({ okCount: 0, errCount: 0 });

  const center = isValidLatLng(value) ? value : GIZA_FALLBACK;

  const useCurrentLocation = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setGeoError(t("addresses.locationUnsupported", "Your browser doesn't support location services."));
      return;
    }
    setLocating(true);
    setPermissionDenied(false);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onChange({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setRecenterSignal((s) => s + 1);
      },
      (err) => {
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setPermissionDenied(true);
        } else {
          setGeoError(t("addresses.locationFailed", "Couldn't determine your location. You can still set it manually on the map."));
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }, [onChange, t]);

  const handleTileError = useCallback(() => {
    tileOkRef.current.errCount += 1;
    if (tileOkRef.current.errCount >= 3 && tileOkRef.current.okCount === 0) setTileFailing(true);
  }, []);

  const handleTileOk = useCallback(() => {
    tileOkRef.current.okCount += 1;
    setTileFailing(false);
  }, []);

  const retryMap = () => {
    tileOkRef.current.okCount = 0;
    tileOkRef.current.errCount = 0;
    setTileFailing(false);
    setMapKey((k) => k + 1);
  };

  return (
    <div className={className}>
      <div className="relative h-56 overflow-hidden rounded-2xl bg-surface-2">
        {!tileFailing ? (
          <MapErrorBoundary
            resetKey={mapKey}
            fallback={<MapUnavailable onRetry={retryMap} />}
          >
            <Suspense fallback={<MapLoading />}>
              <LazyMap
                key={mapKey}
                value={center}
                onChange={onChange}
                onTileError={handleTileError}
                onTileOk={handleTileOk}
                recenterSignal={recenterSignal}
              />
            </Suspense>
          </MapErrorBoundary>
        ) : (
          <MapUnavailable onRetry={retryMap} />
        )}

        <button
          type="button"
          onClick={() => setRecenterSignal((s) => s + 1)}
          aria-label={t("addresses.recenter", "Recenter")}
          className="focus-ring absolute bottom-3 end-3 z-[500] grid h-10 w-10 place-items-center rounded-full bg-surface text-navy shadow-card active:scale-95"
        >
          <Crosshair className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="min-w-0 text-xs font-semibold text-muted-foreground" dir="ltr">
          {isValidLatLng(value) ? `${value.lat.toFixed(6)}, ${value.lng.toFixed(6)}` : t("addresses.noLocationYet", "No location set yet")}
        </div>
        <button
          type="button"
          onClick={useCurrentLocation}
          disabled={locating}
          className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-navy/10 px-3 py-2 text-xs font-bold text-navy disabled:opacity-60"
        >
          {locating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LocateFixed className="h-3.5 w-3.5" />}
          {t("addresses.useCurrentLocation", "Use current location")}
        </button>
      </div>

      {permissionDenied && (
        <div className="mt-3 flex items-start gap-3 rounded-2xl bg-coral/10 p-3 text-coral">
          <MapPinOff className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold">{t("addresses.permissionDeniedTitle", "Location access denied")}</div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-coral/90">
              {t(
                "addresses.permissionDeniedBody",
                "Enable location access in your browser settings, or set the pin manually on the map above.",
              )}
            </p>
          </div>
        </div>
      )}
      {geoError && !permissionDenied && (
        <p className="mt-2 text-[11px] font-semibold text-coral">{geoError}</p>
      )}
      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <MapPin className="h-3 w-3 shrink-0" />
        {t("addresses.mapHint", "Tap or drag the pin to fine-tune your exact location.")}
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
        <span className="text-[11px] text-muted-foreground">
          {t("addresses.mapUnavailableBody", "Your location is still saved. You can retry loading the map.")}
        </span>
        <button
          type="button"
          onClick={onRetry}
          className="focus-ring mt-1 inline-flex items-center gap-1.5 rounded-xl bg-navy px-3 py-2 text-xs font-bold text-navy-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" /> {t("common.retry")}
        </button>
      </div>
    </div>
  );
}
