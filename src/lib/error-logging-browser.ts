import { logClientErrorFn } from "./error-log.functions";
import { sanitizeErrorMessage } from "./error-logging";

type ClientErrorContext = {
  boundary?: string;
  route?: string;
  label?: string;
};

/**
 * Fire-and-forget client error logging. Must never throw or block UI recovery.
 */
export function reportClientErrorToMonitoring(error: unknown, context: ClientErrorContext = {}) {
  if (typeof window === "undefined") return;

  const route = context.route ?? window.location.pathname;
  void logClientErrorFn({
    data: {
      message: sanitizeErrorMessage(error),
      contextRoute: route,
      contextLabel: context.boundary ?? context.label,
    },
  }).catch((persistError) => {
    console.error("[error-logging] Client error logging failed", persistError);
  });
}
