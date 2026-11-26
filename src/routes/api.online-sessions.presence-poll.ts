import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { isLiveKitConfigured } from "@/lib/livekit/config.server";
import { createRoomServiceClient, runPresencePoll } from "@/lib/livekit/presencePoll.server";

/**
 * Called every minute by the database (pg_cron + pg_net) while an online lesson
 * is in its window. Authenticated by a single-use ticket created by the
 * database (claim_online_presence_poll_ticket), so no shared secret is needed.
 */

const BodySchema = z.object({ ticket: z.string().uuid() });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/online-sessions/presence-poll")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed: z.infer<typeof BodySchema>;
        try {
          parsed = BodySchema.parse(await request.json());
        } catch {
          return json({ ok: false, error: "invalid_request" }, 400);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const admin = supabaseAdmin as unknown as {
          rpc: (
            fn: string,
            args?: Record<string, unknown>,
          ) => Promise<{ data: unknown; error: { message?: string } | null }>;
        };

        const claim = await admin.rpc("claim_online_presence_poll_ticket", {
          p_ticket: parsed.ticket,
        });
        if (claim.error) return json({ ok: false, error: "server_error" }, 500);
        if (claim.data !== true) return json({ ok: false, error: "unauthorized" }, 401);

        if (!isLiveKitConfigured()) {
          return json({ ok: false, error: "livekit_unavailable" }, 503);
        }

        try {
          const rooms = createRoomServiceClient();
          const result = await runPresencePoll({
            activeBookingIds: async () => {
              const { data, error } = await admin.rpc("online_presence_active_bookings");
              if (error) throw new Error("active_bookings_failed");
              const rows = (data ?? []) as Array<string | { online_presence_active_bookings?: string }>;
              return rows
                .map((r) => (typeof r === "string" ? r : r.online_presence_active_bookings ?? ""))
                .filter((id) => id.length > 0);
            },
            listParticipants: (roomName) => rooms.listParticipants(roomName),
            record: async ({ bookingId, polledAt, ok, customer, provider }) => {
              const { error } = await admin.rpc("record_online_session_presence", {
                p_booking_id: bookingId,
                p_polled_at: polledAt.toISOString(),
                p_ok: ok,
                p_customer_present: customer,
                p_provider_present: provider,
              });
              if (error) throw new Error("record_failed");
            },
          });
          return json({ ok: true, ...result });
        } catch (error) {
          const name = error instanceof Error ? error.name : "unknown";
          const message = error instanceof Error ? error.message.slice(0, 200) : "";
          console.error("[api.online-sessions.presence-poll] failed", name, message);
          return json({ ok: false, error: "server_error" }, 500);
        }
      },
    },
  },
});
