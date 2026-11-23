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

async function recordWebhookDedup(
  supabaseAdmin: SupabaseAdminClient,
  input: {
    eventId: string;
    bookingId: string;
    eventType: string;
    participant: "customer" | "provider" | null;
    eventAt: Date;
  },
): Promise<boolean> {
  const db = supabaseAdmin as any;
  const { error } = await db.from("session_livekit_webhook_events").insert({
    id: input.eventId,
    booking_id: input.bookingId,
    event_type: input.eventType,
    participant: input.participant,
    event_at: input.eventAt.toISOString(),
  });
  if (error) {
    if (error.code === "23505") return false;
    throw error;
  }
  return true;
}

export async function applyLiveKitWebhookEvent(
  supabaseAdmin: SupabaseAdminClient,
  payload: LiveKitWebhookPayload,
  eventAt: Date,
): Promise<void> {
  const db = supabaseAdmin as any;
  const bookingId = parseBookingId(payload.room?.name);
  const participant = parseParticipant(payload.participant?.identity);
  if (!bookingId || !participant) return;

  const eventId = payload.id?.trim();
  if (eventId) {
    const isNew = await recordWebhookDedup(supabaseAdmin, {
      eventId,
      bookingId,
      eventType: payload.event,
      participant,
      eventAt,
    });
    if (!isNew) return;
  }

  if (payload.event === "participant_joined") {
    const { error } = await db.from("session_events").insert({
      booking_id: bookingId,
      participant,
      joined_at: eventAt.toISOString(),
    });
    if (error) throw error;
    return;
  }

  if (payload.event === "participant_left") {
    const { data: open, error: selErr } = await db
      .from("session_events")
      .select("id, joined_at")
      .eq("booking_id", bookingId)
      .eq("participant", participant)
      .is("left_at", null)
      .order("joined_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (selErr) throw selErr;
    if (!open) {
      const { error } = await db.from("session_events").insert({
        booking_id: bookingId,
        participant,
        joined_at: eventAt.toISOString(),
        left_at: eventAt.toISOString(),
      });
      if (error) throw error;
      return;
    }
    if (new Date(open.joined_at) > eventAt) {
      const { error } = await db.from("session_events").insert({
        booking_id: bookingId,
        participant,
        joined_at: eventAt.toISOString(),
        left_at: eventAt.toISOString(),
      });
      if (error) throw error;
      return;
    }
    const { error } = await db
      .from("session_events")
      .update({ left_at: eventAt.toISOString() })
      .eq("id", open.id);
    if (error) throw error;
  }
}