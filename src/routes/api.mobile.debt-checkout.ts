import { createFileRoute } from "@tanstack/react-router";
import { getRequestBearerUserId } from "@/lib/auth/requestAuth.server";
import type { SupabaseAdminClient } from "@/lib/paymob/paymobCheckout.server";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Card payment for the signed-in customer's unpaid cancellation fees (app and website).
 * The amount is computed in the database from the customer's open debts; the client
 * sends nothing but its access token.
 */
export const Route = createFileRoute("/api/mobile/debt-checkout")({
  server: {
    handlers: {
      POST: async () => {
        const userId = await getRequestBearerUserId();
        if (!userId) return json({ ok: false, error: "unauthorized" }, 401);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { createDebtCheckout } = await import("@/lib/paymob/debtCheckout.server");
        try {
          const result = await createDebtCheckout({
            supabaseAdmin: supabaseAdmin as unknown as SupabaseAdminClient,
            userId,
          });
          return json({ ok: true, ...result });
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          if (/Nothing to pay/.test(message))
            return json({ ok: false, error: "nothing_to_pay" }, 409);
          if (/waiting for review/.test(message))
            return json({ ok: false, error: "in_review" }, 409);
          console.error("[mobile.debt-checkout] failed");
          return json({ ok: false, error: "checkout_unavailable" }, 503);
        }
      },
    },
  },
});
