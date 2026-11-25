import * as Sentry from "@sentry/react-native";
import { scrubMobileSentryEvent, type SentryLikeEvent } from "./sentryScrub";

let initialized = false;

function readDsn(): string | undefined {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  return typeof dsn === "string" && dsn.trim() ? dsn.trim() : undefined;
}

export function initMobileSentry(): void {
  if (initialized) return;
  const dsn = readDsn();
  if (!dsn) return;

  const scrubEvent = (event: SentryLikeEvent) => scrubMobileSentryEvent(event) as typeof event;
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
    enableAutoSessionTracking: true,
    tracesSampleRate: __DEV__ ? 1 : 0.1,
  });
  initialized = true;
}

export function captureMobileSentryException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    if (context) scope.setContext("famy", context);
    Sentry.captureException(error);
  });
}