import type { Event, EventHint } from "@sentry/core";
import { redactSensitiveText } from "../error-logging";

const SENSITIVE_USER_FIELDS = ["email", "username", "name", "ip_address", "geo"] as const;

function scrubUnknown(value: unknown): unknown {
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map(scrubUnknown);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = scrubUnknown(nested);
    }
    return out;
  }
  return value;
}

/** Strip PII, secrets, and long identifiers before events leave the client or server. */
export function scrubSentryEvent<T extends Event>(event: T, _hint?: EventHint): T {
  if (typeof event.message === "string") {
    event.message = redactSensitiveText(event.message);
  }

  if (event.user) {
    for (const field of SENSITIVE_USER_FIELDS) {
      delete event.user[field];
    }
    if (event.user.id) {
      event.user.id = "[redacted]";
    }
  }

  if (event.breadcrumbs?.length) {
    event.breadcrumbs = event.breadcrumbs.map((crumb) => ({
      ...crumb,
      message: typeof crumb.message === "string" ? redactSensitiveText(crumb.message) : crumb.message,
      data: crumb.data ? (scrubUnknown(crumb.data) as Record<string, unknown>) : crumb.data,
    }));
  }

  if (event.extra) {
    event.extra = scrubUnknown(event.extra) as Record<string, unknown>;
  }

  if (event.contexts) {
    event.contexts = scrubUnknown(event.contexts) as Record<string, Record<string, unknown>>;
  }

  return event;
}