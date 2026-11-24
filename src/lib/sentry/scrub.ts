import type { Event, EventHint } from "@sentry/core";
import { applySentryScrubRules } from "./scrub-core";

/** Strip PII, secrets, and long identifiers before events leave the client or server. */
export function scrubSentryEvent<T extends Event>(event: T, _hint?: EventHint): T {
  return applySentryScrubRules(event as T & Parameters<typeof applySentryScrubRules>[0]) as T;
}