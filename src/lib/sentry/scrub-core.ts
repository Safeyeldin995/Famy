import { redactSensitiveText } from "../error-logging";

const SENSITIVE_USER_FIELDS = ["email", "username", "name", "ip_address", "geo"] as const;

/** Object keys whose values must never be sent to Sentry (redact before recursing). */
const SENSITIVE_OBJECT_KEYS = new Set([
  "password",
  "token",
  "otp",
  "secret",
  "authorization",
  "apikey",
  "phone",
  "email",
]);

function normalizeObjectKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** @see SENSITIVE_OBJECT_KEYS — matches exact keys and common suffixes (e.g. `phoneNumber`). */
export function isSensitiveScrubKey(key: string): boolean {
  const normalized = normalizeObjectKey(key);
  if (!normalized) return false;
  if (SENSITIVE_OBJECT_KEYS.has(normalized)) return true;
  for (const sensitive of SENSITIVE_OBJECT_KEYS) {
    if (normalized.endsWith(sensitive) && normalized.length > sensitive.length) {
      return true;
    }
  }
  return false;
}

export function scrubUnknown(value: unknown): unknown {
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map(scrubUnknown);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveScrubKey(key) ? "[redacted]" : scrubUnknown(nested);
    }
    return out;
  }
  return value;
}

export type ScrubbableRequest = {
  url?: string;
  query_string?: string;
  headers?: Record<string, string>;
  data?: unknown;
  cookies?: string;
  method?: string;
};

export type ScrubbableSentryEvent = {
  message?: string;
  user?: Record<string, unknown>;
  breadcrumbs?: Array<{ message?: string; data?: Record<string, unknown> }>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, Record<string, unknown>>;
  request?: ScrubbableRequest;
  exception?: {
    values?: Array<{ type?: string; value?: string }>;
  };
};

const SENSITIVE_HEADER_NAMES = new Set([
  "cookie",
  "authorization",
  "set-cookie",
  "x-api-key",
  "api-key",
]);

function scrubSearchParams(params: URLSearchParams): void {
  for (const key of [...params.keys()]) {
    if (isSensitiveScrubKey(key)) {
      params.set(key, "[redacted]");
      continue;
    }
    const value = params.get(key);
    if (value) params.set(key, redactSensitiveText(value));
  }
}

/** @param url Absolute or app-relative URL with optional query. */
export function scrubRequestUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return url;
  try {
    const hasProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
    const parsed = new URL(trimmed, hasProtocol ? undefined : "https://famy.local");
    scrubSearchParams(parsed.searchParams);
    const pathAndQuery = `${parsed.pathname}${parsed.search ? `?${parsed.searchParams.toString()}` : ""}${parsed.hash}`;
    const out = hasProtocol ? parsed.toString() : pathAndQuery;
    return redactSensitiveText(out);
  } catch {
    return redactSensitiveText(trimmed);
  }
}

export function scrubQueryString(queryString: string): string {
  const trimmed = queryString.trim().replace(/^\?/, "");
  if (!trimmed) return queryString;
  const params = new URLSearchParams(trimmed);
  scrubSearchParams(params);
  return params.toString();
}

function scrubRequestHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalized = key.toLowerCase();
    if (SENSITIVE_HEADER_NAMES.has(normalized) || isSensitiveScrubKey(key)) {
      out[key] = "[redacted]";
    } else {
      out[key] = redactSensitiveText(value);
    }
  }
  return out;
}

export function scrubRequest(request: ScrubbableRequest): ScrubbableRequest {
  const out: ScrubbableRequest = { ...request };
  if (typeof out.url === "string") out.url = scrubRequestUrl(out.url);
  if (typeof out.query_string === "string") out.query_string = scrubQueryString(out.query_string);
  if (out.headers) out.headers = scrubRequestHeaders(out.headers);
  if (typeof out.cookies === "string") out.cookies = "[redacted]";
  if (out.data !== undefined) out.data = scrubUnknown(out.data);
  return out;
}

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

  if (event.request) {
    event.request = scrubRequest(event.request);
  }

  return event;
}