import { useEffect } from "react";
import { reportClientErrorToMonitoring } from "../lib/error-logging-browser";

/**
 * Captures unhandled client errors/rejections for admin monitoring.
 * Must never interfere with default browser handling.
 */
export function ClientErrorMonitoringBridge() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      reportClientErrorToMonitoring(event.error ?? event.message, {
        boundary: "window_error",
        route: window.location.pathname,
      });
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      reportClientErrorToMonitoring(event.reason, {
        boundary: "unhandledrejection",
        route: window.location.pathname,
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
