import { sessionJoinWindow } from "@shared/livekit/sessionAccess";

/** The mic button names the action it performs: mute while the mic is on. */
export function micButtonLabelKey(micEnabled: boolean): "onlineSession.mute" | "onlineSession.unmute" {
  return micEnabled ? "onlineSession.mute" : "onlineSession.unmute";
}

/**
 * Screen share needs an Android foreground service that the app does not configure,
 * so it is offered to teachers on iOS only.
 */
export function canOfferScreenShare(platform: string, party: "customer" | "provider" | undefined): boolean {
  return party === "provider" && platform === "ios";
}

/** Whether the join window is open at `now`; false for invalid dates. */
export function isJoinWindowOpen(startAt: string, endAt: string, now: Date): boolean {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  return sessionJoinWindow(start, end, now).open;
}

/** How often the join button re-checks the window while a booking screen stays open. */
export const JOIN_WINDOW_TICK_MS = 30_000;

/** Parses a JSON body, or returns null for an HTML error page or an empty body. */
export async function readJsonBody<T>(response: { json: () => Promise<unknown> }): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
