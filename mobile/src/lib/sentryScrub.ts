import { applySentryScrubRules, type ScrubbableSentryEvent } from "@shared/sentry/scrub-core";

export type SentryLikeEvent = ScrubbableSentryEvent;

/** Mobile-local scrubber (avoids cross-package Sentry type drift with the web app). */
export function scrubMobileSentryEvent<T extends SentryLikeEvent>(event: T): T {
  return applySentryScrubRules(event);
}