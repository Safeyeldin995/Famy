import * as Sentry from "@sentry/react";
import { scrubSentryEvent } from "./scrub";

let initialized = false;

function readDsn(): string | undefined {
  if (import.meta.env.SSR) return undefined;
  const fromVite = import.meta.env.VITE_SENTRY_DSN;
  return typeof fromVite === "string" && fromVite.trim() ? fromVite.trim() : undefined;
}

export function initSentryClient(): void {
  if (initialized || typeof window === "undefined") return;
  const dsn = readDsn();
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_APP_RELEASE ?? undefined,
    sendDefaultPii: false,
    beforeSend: scrubSentryEvent,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1,
  });
  initialized = true;
}

export function captureSentryException(error: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    if (context) scope.setContext("famy", context);
    Sentry.captureException(error);
  });
}