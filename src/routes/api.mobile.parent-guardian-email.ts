import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getRequestBearerToken, getRequestBearerUserId } from "@/lib/auth/requestAuth.server";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const BodySchema = z.object({ linkId: z.string().uuid().optional() });

/**
 * App: email the parent of a student aged 12-17 after the student saved the parent's
 * contact. The database checks the link belongs to the caller and applies the limits.
 */
export const Route = createFileRoute("/api/mobile/parent-guardian-email")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await getRequestBearerUserId();
        const token = getRequestBearerToken();
        if (!userId || !token) return json({ ok: false, error: "unauthorized" }, 401);
        let body: unknown = {};
        try {
          body = await request.json();
        } catch {
          body = {};
        }
        const parsed = BodySchema.safeParse(body);
        if (!parsed.success) return json({ ok: false, error: "invalid_request" }, 400);
        const { claimAndSendParentGuardianEmail } = await import(
          "@/lib/email/parentGuardianEmailFlow.server"
        );
        try {
          const result = await claimAndSendParentGuardianEmail({
            token,
            linkId: parsed.data.linkId ?? null,
          });
          if (result.ok) return json({ ok: true, deduplicated: !!result.deduplicated });
          if (/rate_limited/.test(result.reason)) return json({ ok: false, error: "rate_limited" }, 429);
          return json({ ok: false, error: "email_unavailable" }, 503);
        } catch {
          console.error("[mobile.parent-guardian-email] failed");
          return json({ ok: false, error: "email_unavailable" }, 503);
        }
      },
    },
  },
});
