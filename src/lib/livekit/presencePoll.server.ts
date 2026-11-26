import { RoomServiceClient } from "livekit-server-sdk";
import { liveKitServerConfig } from "@/lib/livekit/config.server";

/**
 * Server-side attendance for online lessons.
 *
 * Every minute during an active lesson window the database (pg_cron + pg_net)
 * calls /api/online-sessions/presence-poll with a single-use ticket. This
 * module asks LiveKit which participants are in each lesson room and records
 * the result. It is the authoritative attendance source: it does not depend on
 * the LiveKit webhook being configured and cannot be faked by a client.
 */

export type PresenceParticipant = { identity?: string; state?: number };

export type PresenceSnapshot = { customer: boolean; provider: boolean };

/** LiveKit participant states: JOINING = 0, JOINED = 1, ACTIVE = 2, DISCONNECTED = 3. */
const DISCONNECTED_STATE = 3;

export function liveKitHttpUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.startsWith("wss://")) return `https://${trimmed.slice("wss://".length)}`;
  if (trimmed.startsWith("ws://")) return `http://${trimmed.slice("ws://".length)}`;
  return trimmed;
}

export function lessonRoomName(bookingId: string): string {
  return `booking_${bookingId}`;
}

export function presenceFromParticipants(participants: PresenceParticipant[]): PresenceSnapshot {
  const snapshot: PresenceSnapshot = { customer: false, provider: false };
  for (const p of participants) {
    if (p.state === DISCONNECTED_STATE) continue;
    const identity = p.identity ?? "";
    if (identity.startsWith("customer:")) snapshot.customer = true;
    else if (identity.startsWith("provider:")) snapshot.provider = true;
  }
  return snapshot;
}

/** A room that does not exist simply means nobody is in it. */
export function isRoomNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: unknown; code?: unknown };
  return e.status === 404 || e.code === "not_found";
}

export type PresencePollDeps = {
  activeBookingIds: () => Promise<string[]>;
  listParticipants: (roomName: string) => Promise<PresenceParticipant[]>;
  record: (input: {
    bookingId: string;
    polledAt: Date;
    ok: boolean;
    customer: boolean;
    provider: boolean;
  }) => Promise<void>;
  now?: () => Date;
};

export type PresencePollResult = { polled: number; failed: number };

export async function runPresencePoll(deps: PresencePollDeps): Promise<PresencePollResult> {
  const ids = await deps.activeBookingIds();
  let polled = 0;
  let failed = 0;
  for (const bookingId of ids) {
    const polledAt = (deps.now ?? (() => new Date()))();
    let ok = true;
    let snapshot: PresenceSnapshot = { customer: false, provider: false };
    try {
      snapshot = presenceFromParticipants(await deps.listParticipants(lessonRoomName(bookingId)));
    } catch (error) {
      if (!isRoomNotFoundError(error)) {
        ok = false;
        failed += 1;
      }
    }
    // A failed poll is still recorded (ok = false) so coverage stays honest,
    // but it never opens or closes attendance.
    await deps.record({
      bookingId,
      polledAt,
      ok,
      customer: snapshot.customer,
      provider: snapshot.provider,
    });
    polled += 1;
  }
  return { polled, failed };
}

export function createRoomServiceClient(): RoomServiceClient {
  const { url, apiKey, apiSecret } = liveKitServerConfig();
  if (!url || !apiKey || !apiSecret) throw new Error("livekit_not_configured");
  return new RoomServiceClient(liveKitHttpUrl(url), apiKey, apiSecret);
}
