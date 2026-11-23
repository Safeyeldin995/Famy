import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authorizeSessionJoinWithCredential } from "@/lib/livekit/sessionAccess";
import { resolveSessionJoinCredential } from "@/lib/livekit/sessionJoinCredential.server";
import { loadSessionBookingSnapshot } from "@/lib/livekit/sessionBooking.server";

const BodySchema = z.object({
  bookingId: z.string().uuid(),
  note: z.string().min(10).max(2000).optional(),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/session/report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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

        const authz = authorizeSessionJoinWithCredential(booking, credential, new Date());
        if (!authz.ok && authz.code !== "outside_join_window") {
          return json({ ok: false, error: authz.code }, 403);
        }

        const { createRequestUserSupabase } = await import(
          "@/lib/auth/requestSupabaseUser.server"
        );
        const supabase = createRequestUserSupabase();
        if (!supabase) return json({ ok: false, error: "unauthorized" }, 401);
        const detail =
          parsed.note?.trim() ||
          "In-call safety report: participant left and requested admin review.";
        const { data, error } = await (supabase as any).rpc("report_online_lesson_issue", {
          p_booking_id: parsed.bookingId,
          p_category: "behavior",
          p_description: detail,
        });

        if (error) {
          console.error("[api.session.report] lesson report failed");
          return json({ ok: false, error: "server_error" }, 500);
        }

        return json({ ok: true, reportId: data, leaveSession: true });
      },
    },
  },
});