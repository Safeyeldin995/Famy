import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createRequestUserSupabase } from "@/lib/auth/requestSupabaseUser.server";
import { refundPaymobTransaction, PaymobRefundError } from "@/lib/paymob/paymobRefund.server";

const BodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), requestId: z.string().uuid() }),
  z.object({
    action: z.literal("approve_instapay"),
    requestId: z.string().uuid(),
    reference: z.string().min(3).max(500),
  }),
  z.object({ action: z.literal("reject"), requestId: z.string().uuid(), reason: z.string().min(3) }),
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/admin/wallet-refund")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabase = createRequestUserSupabase();
        if (!supabase) return json({ ok: false, error: "unauthorized" }, 401);

        let body: z.infer<typeof BodySchema>;
        try {
          body = BodySchema.parse(await request.json());
        } catch {
          return json({ ok: false, error: "invalid_request" }, 400);
        }

        if (body.action === "reject") {
          const { error } = await (supabase.rpc as any)("admin_reject_wallet_refund_request", {
            p_request_id: body.requestId,
            p_reason: body.reason,
          });
          if (error) return json({ ok: false, error: error.message }, 400);
          return json({ ok: true });
        }

        if (body.action === "approve_instapay") {
          const { error } = await (supabase.rpc as any)("admin_complete_wallet_refund_request", {
            p_request_id: body.requestId,
            p_reference: body.reference,
            p_channel: "instapay",
          });
          if (error) return json({ ok: false, error: error.message }, 400);
          return json({ ok: true });
        }

        const { data: approval, error: approveErr } = await (supabase.rpc as any)(
          "admin_mark_wallet_refund_approved",
          { p_request_id: body.requestId },
        );
        if (approveErr) return json({ ok: false, error: approveErr.message }, 400);

        const row = (Array.isArray(approval) ? approval[0] : approval) as
          | { amount?: number; paymob_transaction_id?: number }
          | undefined;
        const amount = Number(row?.amount ?? 0);
        const transactionId = Number(row?.paymob_transaction_id);
        if (!Number.isFinite(transactionId) || transactionId <= 0) {
          return json({ ok: false, error: "missing_paymob_transaction" }, 400);
        }

        try {
          const result = await refundPaymobTransaction({
            transactionId,
            amountCents: Math.round(amount * 100),
          });
          const { error } = await (supabase.rpc as any)("admin_complete_wallet_refund_request", {
            p_request_id: body.requestId,
            p_reference: result.reference,
            p_channel: "paymob",
          });
          if (error) return json({ ok: false, error: error.message }, 400);
          return json({ ok: true, reference: result.reference });
        } catch (e) {
          const message = e instanceof PaymobRefundError ? e.message : "paymob_refund_failed";
          await (supabase.rpc as any)("admin_fail_wallet_refund_request", {
            p_request_id: body.requestId,
            p_error: message,
          });
          return json({ ok: false, error: message }, 502);
        }
      },
    },
  },
});