import { createFileRoute } from "@tanstack/react-router";
import { isLiveKitConfigured } from "@/lib/livekit/config.server";
import {
  applyLiveKitWebhookEvent,
  createLiveKitWebhookReceiver,
  type LiveKitWebhookPayload,
} from "@/lib/livekit/webhook.server";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/livekit/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isLiveKitConfigured()) {
          return json({ ok: false, error: "livekit_unavailable" }, 503);
        }

        const rawBody = await request.text();
        const authHeader = request.headers.get("authorization") ?? "";
        let payload: LiveKitWebhookPayload;
        try {
          const receiver = createLiveKitWebhookReceiver();
          const event = await receiver.receive(rawBody, authHeader);
          payload = {
            event: event.event ?? "",
            room: event.room ? { name: event.room.name } : undefined,
            participant: event.participant
              ? { identity: event.participant.identity }
              : undefined,
            createdAt: event.createdAt != null ? Number(event.createdAt) : undefined,
            id: event.id,
          };
        } catch {
          return json({ ok: false, error: "invalid_signature" }, 401);
        }

        const eventAt = payload.createdAt ? new Date(payload.createdAt * 1000) : new Date();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          await applyLiveKitWebhookEvent(supabaseAdmin as never, payload, eventAt);
          return json({ ok: true });
        } catch (error) {
          console.error("[api.livekit.webhook] failed");
          return json({ ok: false, error: "server_error" }, 500);
        }
      },
    },
  },
});