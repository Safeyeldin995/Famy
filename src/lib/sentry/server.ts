import * as Sentry from "@sentry/node";
import { scrubSentryEvent } from "./scrub";

let initialized = false;

function readServerDsn(): string | undefined {
  const dsn = process.env.SENTRY_DSN ?? process.env.VITE_SENTRY_DSN;
  return typeof dsn === "string" && dsn.trim() ? dsn.trim() : undefined;
}

export function initSentryServer(): void {
  if (initialized) return;
  const dsn = readServerDsn();
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "production",
    release: process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA ?? undefined,
    sendDefaultPii: false,
    beforeSend: scrubSentryEvent,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1,
  });
  initialized = true;
}

export function captureSentryServerException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    if (context) scope.setContext("famy", context);
    Sentry.captureException(error);
  });
}

export { Sentry };