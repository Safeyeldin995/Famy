import { redactSensitiveText } from "../error-logging";

const SENSITIVE_USER_FIELDS = ["email", "username", "name", "ip_address", "geo"] as const;

export function scrubUnknown(value: unknown): unknown {
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

export type ScrubbableSentryEvent = {
  message?: string;
  user?: Record<string, unknown>;
  breadcrumbs?: Array<{ message?: string; data?: Record<string, unknown> }>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, Record<string, unknown>>;
  exception?: {
    values?: Array<{ type?: string; value?: string }>;
  };
};

function scrubExceptionValues(exception: ScrubbableSentryEvent["exception"]): void {
  for (const value of exception?.values ?? []) {
    if (typeof value.value === "string") {
      value.value = redactSensitiveText(value.value);
    }
    if (typeof value.type === "string") {
      value.type = redactSensitiveText(value.type);
    }
  }
}

export function applySentryScrubRules<T extends ScrubbableSentryEvent>(event: T): T {
  if (typeof event.message === "string") {
    event.message = redactSensitiveText(event.message);
  }

  scrubExceptionValues(event.exception);

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