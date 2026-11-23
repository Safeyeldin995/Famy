import { AccessToken } from "livekit-server-sdk";
import { liveKitServerConfig } from "@/lib/livekit/config.server";
import type { SessionJoinParty } from "@/lib/livekit/sessionAccess";

const TOKEN_TTL_SEC = 60 * 60;

export function liveKitRoomName(bookingId: string): string {
  return `booking_${bookingId}`;
}

export async function mintLiveKitSessionToken(input: {
  bookingId: string;
  userId: string;
  party: SessionJoinParty;
  displayName: string;
}): Promise<{ token: string; url: string; room: string }> {
  const { url, apiKey, apiSecret } = liveKitServerConfig();
  if (!url || !apiKey || !apiSecret) {
    throw new Error("livekit_not_configured");
  }
  const room = liveKitRoomName(input.bookingId);
  const at = new AccessToken(apiKey, apiSecret, {
    identity: `${input.party}:${input.userId}`,
    name: input.displayName,
    ttl: TOKEN_TTL_SEC,
  });
  at.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomRecord: false,
    roomAdmin: false,
  });
  const token = await at.toJwt();
  return { token, url, room };
}