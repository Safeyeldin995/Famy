import * as Sentry from "@sentry/react-native";
import type { ErrorEvent, EventHint, TransactionEvent } from "@sentry/types";
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

  const beforeSend = (event: ErrorEvent, _hint: EventHint): ErrorEvent | null =>
    scrubMobileSentryEvent(event as SentryLikeEvent) as ErrorEvent;
  const beforeSendTransaction = (event: TransactionEvent, _hint: EventHint): TransactionEvent | null =>
    scrubMobileSentryEvent(event as SentryLikeEvent) as TransactionEvent;
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    beforeSend,
    beforeSendTransaction,
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