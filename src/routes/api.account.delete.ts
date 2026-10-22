import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { getRequestBearerToken, getRequestBearerUserId } from "@/lib/auth/requestAuth.server";
import type { Database } from "@/integrations/supabase/types";
import { runAccountDeletion } from "@/lib/account/accountDeletion.server";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/account/delete")({
  server: {
    handlers: {
      POST: async () => {
        const userId = await getRequestBearerUserId();
        const token = getRequestBearerToken();
        if (!userId || !token) return json({ ok: false, error: "unauthorized" }, 401);

        const supabaseUrl = process.env.SUPABASE_URL;
        const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!supabaseUrl || !publishableKey) {
          console.error("[account.delete] missing supabase env");
          return json({ ok: false, error: "deletion_failed" }, 500);
        }

        const supabaseUser = createClient<Database>(supabaseUrl, publishableKey, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const result = await runAccountDeletion({
          supabaseUser,
          supabaseAdmin: supabaseAdmin as Parameters<typeof runAccountDeletion>[0]["supabaseAdmin"],
          userId,
        });

        if (!result.ok) return json({ ok: false, error: result.error }, result.status);
        return json({ ok: true });
      },
    },
  },
});
