import { redactSensitiveText } from "@shared/error-logging";

export type SentryLikeEvent = {
  message?: string;
  user?: Record<string, unknown>;
  breadcrumbs?: Array<{ message?: string; data?: Record<string, unknown> }>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, Record<string, unknown>>;
};

/** Mobile-local scrubber (avoids cross-package Sentry type drift with the web app). */
export function scrubMobileSentryEvent<T extends SentryLikeEvent>(event: T): T {
  if (typeof event.message === "string") {
    event.message = redactSensitiveText(event.message);
  }
  if (event.user) {
    for (const key of ["email", "username", "name", "ip_address", "geo"] as const) {
      delete event.user[key];
    }
    if (event.user.id) event.user.id = "[redacted]";
  }
  return event;
}