import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  ArrowRight,
  Check,
  LocateFixed,
  Loader2,
  MapPin,
  MapPinOff,
  Pencil,
  RefreshCw,
} from "lucide-react";
import type { LatLng } from "./LocationPickerMap";
import { isValidLatLng } from "@/lib/geo/latLng";

const LazyMap = lazy(() => import("./LocationPickerMap"));
const subscribeNoop = () => () => {};

const GIZA_FALLBACK: LatLng = { lat: 29.9765, lng: 30.9317 }; // Sheikh Zayed / 6th of October area

class MapErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; resetKey: number },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; fallback: ReactNode; resetKey: number }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidUpdate(prev: { resetKey: number }) {
    // Only the explicit "retry" action (which bumps resetKey) clears a crash.
    if (prev.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

export { isValidLatLng };

/** Tile-failure tracking shared by the preview and the full-screen picker. */
function useTileHealth() {
  const [failing, setFailing] = useState(false);
  const [key, setKey] = useState(0);
  const counts = useRef({ ok: 0, err: 0 });
  const onTileError = useCallback(() => {
    counts.current.err += 1;
    if (counts.current.err >= 3 && counts.current.ok === 0) setFailing(true);
  }, []);
  const onTileOk = useCallback(() => {
    counts.current.ok += 1;
    setFailing(false);
  }, []);
  const retry = useCallback(() => {
    counts.current = { ok: 0, err: 0 };
    setFailing(false);
    setKey((k) => k + 1);
  }, []);
  return { failing, key, onTileError, onTileOk, retry };
}

/** The centre pin, drawn over the map so the map moves under it. */
function CenterPin() {
  return (
    <div className="pointer-events-none absolute inset-0 z-[500] grid place-items-center">
      <div className="flex -translate-y-1/2 flex-col items-center">
        <div className="grid h-11 w-11 place-items-center rounded-full bg-brand text-brand-foreground shadow-[0_10px_24px_-8px_var(--brand)] ring-4 ring-white">
          <MapPin className="h-5 w-5" strokeWidth={2.5} aria-hidden="true" />
        </div>
        <div className="-mt-0.5 h-3 w-1 rounded-b-full bg-brand" />
      </div>
      <div className="absolute h-1.5 w-4 rounded-full bg-black/25 blur-[1px]" />
    </div>
  );
}

/**
 * The only place the app asks for the device location. It is called from
 * button handlers only, never on mount, so the permission prompt always
 * follows a tap.
 */
function requestCurrentPosition(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("unsupported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) =>
        reject(err.code === err.PERMISSION_DENIED ? new Error("denied") : new Error("failed")),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  });
}

function locationErrorMessage(error: unknown, t: TFunction) {
  const reason = error instanceof Error ? error.message : "failed";
  if (reason === "denied") return t("locationPicker.permissionDenied");
  if (reason === "unsupported") {
    return t("addresses.locationUnsupported", "Your browser doesn't support location services.");
  }
  return t(
    "addresses.locationFailed",
    "Couldn't determine your location. You can still set it manually on the map.",
  );
}

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
  const [open, setOpen] = useState(false);
  const [locatedStart, setLocatedStart] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [cardNotice, setCardNotice] = useState<string | null>(null);
  // Leaflet touches `window` on import, so maps only render after mount (never during SSR).
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  const preview = useTileHealth();
  const hasValue = isValidLatLng(value);

  const openPicker = () => {
    setLocatedStart(null);
    setOpen(true);
  };

  const useCurrentLocation = async () => {
    setLocating(true);
    setCardNotice(null);
    try {
      const pos = await requestCurrentPosition();
      setLocatedStart(pos);
      setOpen(true);
    } catch (error) {
      setCardNotice(locationErrorMessage(error, t));
    } finally {
      setLocating(false);
    }
  };

  return (
    <div className={className}>
      {hasValue ? (
        <div className="overflow-hidden rounded-2xl border border-border/60 bg-white">
          <div className="relative isolate h-36 w-full bg-surface-2">
            {mounted && !preview.failing ? (
              <MapErrorBoundary
                resetKey={preview.key}
                fallback={<MapUnavailable onRetry={preview.retry} />}
              >
                <Suspense fallback={<MapLoading />}>
                  <LazyMap
                    key={preview.key}
                    center={value}
                    mode="preview"
                    onTileError={preview.onTileError}
                    onTileOk={preview.onTileOk}
                  />
                </Suspense>
              </MapErrorBoundary>
            ) : preview.failing ? (
              <MapUnavailable onRetry={preview.retry} />
            ) : (
              <MapLoading />
            )}
            <CenterPin />
            {!preview.failing ? (
              <button
                type="button"
                onClick={openPicker}
                aria-label={t("locationPicker.change")}
                className="focus-ring absolute inset-0 z-[550] h-full w-full"
              />
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="flex min-w-0 items-center gap-2 text-pro-14 font-bold text-foreground">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-500 text-white">
                <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
              </span>
              {t("locationPicker.saved")}
            </span>
            <button
              type="button"
              onClick={openPicker}
              className="focus-ring inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-pro-13 font-extrabold text-brand"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              {t("locationPicker.change")}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border-2 border-dashed border-brand/30 bg-brand/[0.03] p-4">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand/10 text-brand">
              <MapPin className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-pro-14 font-extrabold text-foreground">
                {t("locationPicker.emptyTitle")}
              </p>
              <p className="mt-0.5 text-pro-12 leading-relaxed text-muted-foreground">
                {t("locationPicker.emptyBody")}
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={useCurrentLocation}
              disabled={locating}
              className="focus-ring inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand px-3 text-pro-13 font-extrabold text-brand-foreground disabled:opacity-70"
            >
              {locating ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <LocateFixed className="h-4 w-4" aria-hidden="true" />
              )}
              {t("locationPicker.useMyLocation")}
            </button>
            <button
              type="button"
              onClick={openPicker}
              className="focus-ring inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-white px-3 text-pro-13 font-extrabold text-foreground"
            >
              <MapPin className="h-4 w-4" aria-hidden="true" />
              {t("locationPicker.pickOnMap")}
            </button>
          </div>
          {cardNotice ? (
            <p className="mt-3 rounded-xl bg-coral/10 px-3 py-2 text-pro-12 font-semibold text-coral">
              {cardNotice}
            </p>
          ) : null}
        </div>
      )}

      {open && mounted
        ? createPortal(
            <LocationPickerSheet
              initial={locatedStart ?? (hasValue ? value : null)}
              onClose={() => setOpen(false)}
              onConfirm={(pos) => {
                onChange(pos);
                setOpen(false);
              }}
            />,
            document.body,
          )
        : null}
    </div>
  );
}

function LocationPickerSheet({
  initial,
  onClose,
  onConfirm,
}: {
  initial: LatLng | null;
  onClose: () => void;
  onConfirm: (pos: LatLng) => void;
}) {
  const { t, i18n } = useTranslation();
  const start = initial ?? GIZA_FALLBACK;
  const [draft, setDraft] = useState<LatLng>(start);
  const [moved, setMoved] = useState(!!initial);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [fly, setFly] = useState<{ target: LatLng; signal: number }>({ target: start, signal: 0 });
  const tiles = useTileHealth();

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const locate = async () => {
    setLocating(true);
    setNotice(null);
    try {
      const target = await requestCurrentPosition();
      setDraft(target);
      setMoved(true);
      setFly((f) => ({ target, signal: f.signal + 1 }));
    } catch (error) {
      setNotice(locationErrorMessage(error, t));
    } finally {
      setLocating(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("locationPicker.sheetTitle")}
      dir={i18n.dir()}
      className="fixed inset-0 z-[1000] flex justify-center bg-black/40"
    >
      <div className="relative flex h-dvh w-full max-w-md flex-col overflow-hidden bg-surface-2">
        <div className="absolute inset-0 isolate">
          {tiles.failing ? (
            <MapUnavailable onRetry={tiles.retry} />
          ) : (
            <MapErrorBoundary
              resetKey={tiles.key}
              fallback={<MapUnavailable onRetry={tiles.retry} />}
            >
              <Suspense fallback={<MapLoading />}>
                <LazyMap
                  key={tiles.key}
                  center={start}
                  mode="pick"
                  onCenterChange={(pos) => {
                    setDraft(pos);
                    setMoved(true);
                  }}
                  onTileError={tiles.onTileError}
                  onTileOk={tiles.onTileOk}
                  flyTarget={fly.target}
                  flySignal={fly.signal}
                />
              </Suspense>
            </MapErrorBoundary>
          )}
          <CenterPin />
        </div>

        <div className="safe-top relative z-[600] flex items-center gap-3 px-4 pt-4">
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.back", "Back")}
            className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-foreground shadow-card"
          >
            <ArrowRight className="h-5 w-5 ltr:rotate-180" aria-hidden="true" />
          </button>
          <div className="min-w-0 rounded-full bg-white px-4 py-2.5 text-pro-14 font-extrabold text-foreground shadow-card">
            {t("locationPicker.sheetTitle")}
          </div>
        </div>

        <div className="relative z-[600] mt-auto px-4 pb-4">
          <div className="mb-3 flex justify-end">
            <button
              type="button"
              onClick={locate}
              disabled={locating}
              aria-label={t("locationPicker.useMyLocation")}
              className="focus-ring inline-flex min-h-12 items-center gap-2 rounded-full bg-white px-4 text-pro-13 font-extrabold text-brand shadow-card disabled:opacity-70"
            >
              {locating ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <LocateFixed className="h-4 w-4" aria-hidden="true" />
              )}
              {t("locationPicker.myLocationShort")}
            </button>
          </div>
          <div className="safe-bottom rounded-3xl bg-white p-4 shadow-[0_-8px_30px_-12px_rgba(0,0,0,0.25)]">
            <p className="text-pro-14 font-extrabold text-foreground">
              {t("locationPicker.sheetHintTitle")}
            </p>
            <p className="mt-1 text-pro-12 leading-relaxed text-muted-foreground">
              {t("locationPicker.sheetHintBody")}
            </p>
            {notice ? (
              <p className="mt-3 rounded-xl bg-coral/10 px-3 py-2 text-pro-12 font-semibold text-coral">
                {notice}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => onConfirm(draft)}
              disabled={!moved}
              className="focus-ring mt-4 inline-flex h-14 w-full items-center justify-center rounded-2xl bg-brand text-pro-16 font-extrabold text-brand-foreground disabled:opacity-50"
            >
              {t("locationPicker.confirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MapLoading() {
  const { t } = useTranslation();
  return (
    <div className="grid h-full w-full place-items-center">
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-pro-12 font-semibold">
          {t("addresses.mapLoading", "Loading map…")}
        </span>
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
        <span className="text-pro-12 font-bold">
          {t("addresses.mapUnavailable", "Map unavailable right now")}
        </span>
        <button
          type="button"
          onClick={onRetry}
          className="focus-ring mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-brand px-4 text-pro-12 font-extrabold text-brand-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" /> {t("common.retry")}
        </button>
      </div>
    </div>
  );
}
