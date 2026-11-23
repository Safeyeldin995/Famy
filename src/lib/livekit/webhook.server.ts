import { WebhookReceiver } from "livekit-server-sdk";
import type { SupabaseAdminClient } from "@/lib/paymob/paymobCheckout.server";
import { liveKitServerConfig } from "@/lib/livekit/config.server";

export type LiveKitWebhookPayload = {
  event: string;
  room?: { name?: string };
  participant?: { identity?: string };
  createdAt?: number;
  id?: string;
};

function parseBookingId(roomName: string | undefined): string | null {
  if (!roomName?.startsWith("booking_")) return null;
  const id = roomName.slice("booking_".length);
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

function parseParticipant(identity: string | undefined): "customer" | "provider" | null {
  if (!identity) return null;
  if (identity.startsWith("customer:")) return "customer";
  if (identity.startsWith("provider:")) return "provider";
  return null;
}

export function createLiveKitWebhookReceiver(): WebhookReceiver {
  const { apiKey, apiSecret } = liveKitServerConfig();
  if (!apiKey || !apiSecret) throw new Error("livekit_not_configured");
  return new WebhookReceiver(apiKey, apiSecret);
}

export async function applyLiveKitWebhookEvent(
  supabaseAdmin: SupabaseAdminClient,
  payload: LiveKitWebhookPayload,
  eventAt: Date,
): Promise<void> {
  const bookingId = parseBookingId(payload.room?.name);
  const participant = parseParticipant(payload.participant?.identity);
  if (!bookingId || !participant) return;

  const eventId = payload.id?.trim();
  if (!eventId) return;

  if (payload.event !== "participant_joined" && payload.event !== "participant_left") {
    return;
  }

  const { error } = await supabaseAdmin.rpc("apply_livekit_session_webhook", {
    p_event_id: eventId,
    p_booking_id: bookingId,
    p_event_type: payload.event,
    p_participant: participant,
    p_event_at: eventAt.toISOString(),
  });

  if (error) throw error;
}