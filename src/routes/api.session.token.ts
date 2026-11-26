import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { isLiveKitConfigured } from "@/lib/livekit/config.server";
import { authorizeSessionJoinWithCredential } from "@/lib/livekit/sessionAccess";
import { resolveSessionJoinCredential } from "@/lib/livekit/sessionJoinCredential.server";
import { loadSessionBookingSnapshot } from "@/lib/livekit/sessionBooking.server";
import { mintLiveKitSessionToken } from "@/lib/livekit/sessionToken.server";

const BodySchema = z.object({
  bookingId: z.string().uuid(),
  displayName: z.string().min(1).max(120).optional(),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/session/token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isLiveKitConfigured()) {
          return json({ ok: false, error: "livekit_unavailable" }, 503);
        }
        const credential = await resolveSessionJoinCredential(request);
        if (!credential) return json({ ok: false, error: "unauthorized" }, 401);

        let parsed: z.infer<typeof BodySchema>;
        try {
          parsed = BodySchema.parse(await request.json());
        } catch {
          return json({ ok: false, error: "invalid_request" }, 400);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const booking = await loadSessionBookingSnapshot(
          supabaseAdmin as never,
          parsed.bookingId,
        );
        if (!booking) return json({ ok: false, error: "not_found" }, 404);

        const authz = authorizeSessionJoinWithCredential(booking, credential);
        if (!authz.ok) return json({ ok: false, error: authz.code }, 403);

        try {
          const result = await mintLiveKitSessionToken({
            bookingId: booking.id,
            userId: credential.userId,
            party: authz.party,
            displayName: parsed.displayName?.trim() || (authz.party === "customer" ? "Customer" : "Provider"),
          });
          return json({ ok: true, ...result });
        } catch (error) {
          if (error instanceof Error && error.message === "livekit_not_configured") {
            return json({ ok: false, error: "livekit_unavailable" }, 503);
          }
          // Log the error type and message only (never tokens or keys) so a failure is diagnosable.
          const name = error instanceof Error ? error.name : typeof error;
          const message = error instanceof Error ? error.message.slice(0, 200) : "";
          console.error("[api.session.token] failed", { name, message });
          return json({ ok: false, error: "server_error" }, 500);
        }
      },
    },
  },
});