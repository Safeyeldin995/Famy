import { useEffect, useRef, type ReactNode } from "react";
import { APIProvider, APILoadingStatus, useApiLoadingStatus } from "@vis.gl/react-google-maps";

import { getGoogleMapsBrowserKey } from "@/lib/geo/googleMapsBrowserKey";

function tripTileError(onTileError: () => void) {
  onTileError();
  onTileError();
  onTileError();
}

function MissingMapKey({ onTileError }: { onTileError: () => void }) {
  useEffect(() => {
    tripTileError(onTileError);
  }, [onTileError]);
  return null;
}

function ApiLoadFailure({ onTileError }: { onTileError: () => void }) {
  const status = useApiLoadingStatus();
  useEffect(() => {
    if (status === APILoadingStatus.FAILED) tripTileError(onTileError);
  }, [status, onTileError]);
  return null;
}

function AuthFailureWatcher({ onTileError }: { onTileError: () => void }) {
  useEffect(() => {
    type GmWindow = Window & { gm_authFailure?: () => void };
    const w = window as GmWindow;
    const prev = w.gm_authFailure;
    w.gm_authFailure = () => tripTileError(onTileError);
    return () => {
      w.gm_authFailure = prev;
    };
  }, [onTileError]);
  return null;
}

function LoadTimeout({
  onTileError,
  tilesLoaded,
}: {
  onTileError: () => void;
  tilesLoaded: boolean;
}) {
  useEffect(() => {
    if (tilesLoaded) return;
    const timer = window.setTimeout(() => {
      if (!tilesLoaded) tripTileError(onTileError);
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, [onTileError, tilesLoaded]);
  return null;
}

export function GoogleMapsBrowserProvider({
  children,
  onTileError,
  tilesLoaded,
}: {
  children: ReactNode;
  onTileError: () => void;
  tilesLoaded: boolean;
}) {
  const apiKey = getGoogleMapsBrowserKey();
  if (!apiKey) {
    return <MissingMapKey onTileError={onTileError} />;
  }
  return (
    <APIProvider
      apiKey={apiKey}
      language="ar"
      region="EG"
      onError={() => tripTileError(onTileError)}
    >
      <ApiLoadFailure onTileError={onTileError} />
      <AuthFailureWatcher onTileError={onTileError} />
      <LoadTimeout onTileError={onTileError} tilesLoaded={tilesLoaded} />
      {children}
    </APIProvider>
  );
}

/** Call once when the map reports tiles loaded / idle with a working surface. */
export function useReportMapTilesOk(onTileOk: () => void) {
  const reported = useRef(false);
  return () => {
    if (reported.current) return;
    reported.current = true;
    onTileOk();
  };
}
