import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getRequestBearerUserId } from "@/lib/auth/requestAuth.server";
import type { SupabaseAdminClient } from "@/lib/paymob/paymobCheckout.server";

const BodySchema = z.object({
  bookingId: z.string().uuid(),
  paymentId: z.string().uuid().optional(),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Stable HTTP endpoint for the native app to start a Paymob checkout.
 * Same rules as `createPaymobCheckoutFn`: the caller's Supabase access token
 * (Authorization: Bearer) identifies the customer, and all ownership, amount
 * and status checks happen inside `createPaymobCheckoutForPayment`.
 */
export const Route = createFileRoute("/api/mobile/paymob-checkout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await getRequestBearerUserId();
        if (!userId) return json({ ok: false, error: "unauthorized" }, 401);

        let parsed: z.infer<typeof BodySchema>;
        try {
          parsed = BodySchema.parse(await request.json());
        } catch {
          return json({ ok: false, error: "invalid_request" }, 400);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { createPaymobCheckoutForPayment } =
          await import("@/lib/paymob/paymobCheckout.server");
        try {
          const result = await createPaymobCheckoutForPayment({
            supabaseAdmin: supabaseAdmin as unknown as SupabaseAdminClient,
            userId,
            bookingId: parsed.bookingId,
            paymentId: parsed.paymentId,
          });
          return json({ ok: true, ...result });
        } catch {
          console.error("[mobile.paymob-checkout] failed");
          return json({ ok: false, error: "checkout_failed" }, 500);
        }
      },
    },
  },
});
