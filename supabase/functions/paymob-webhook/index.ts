// Paymob Transaction Processed webhook — HMAC-verified, no session required.
//
// verify_jwt is disabled in supabase/config.toml (same pattern as
// send-push-notifications): Paymob cannot present a Supabase JWT.
// Authorization is enforced by verifying the Paymob HMAC query parameter
// against the 20-field SHA-512 concatenation documented at:
// https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac/hmac

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PAYMOB_HMAC_SECRET = Deno.env.get("PAYMOB_HMAC_SECRET");

const PAYMOB_TRANSACTION_HMAC_FIELD_ORDER = [
  "amount_cents",
  "created_at",
  "currency",
  "error_occured",
  "has_parent_transaction",
  "id",
  "integration_id",
  "is_3d_secure",
  "is_auth",
  "is_capture",
  "is_refunded",
  "is_standalone_payment",
  "is_voided",
  "order.id",
  "owner",
  "pending",
  "source_data.pan",
  "source_data.sub_type",
  "source_data.type",
  "success",
] as const;

type PaymobTransaction = Record<string, unknown> & {
  order?: { id?: unknown } | null;
  source_data?: { pan?: unknown; sub_type?: unknown; type?: unknown } | null;
};

function fieldValue(obj: PaymobTransaction, key: (typeof PAYMOB_TRANSACTION_HMAC_FIELD_ORDER)[number]): unknown {
  switch (key) {
    case "order.id":
      return obj.order?.id;
    case "source_data.pan":
      return obj.source_data?.pan;
    case "source_data.sub_type":
      return obj.source_data?.sub_type;
    case "source_data.type":
      return obj.source_data?.type;
    default:
      return obj[key];
  }
}

function buildPaymobTransactionHmacPayload(obj: PaymobTransaction): string {
  return PAYMOB_TRANSACTION_HMAC_FIELD_ORDER
    .map((key) => {
      const value = fieldValue(obj, key);
      if (value === null || value === undefined) return "";
      return String(value);
    })
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

async function hmacSha512Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return Boolean(value);
}

function parsePaymentId(obj: PaymobTransaction): string | null {
  const candidates = [
    obj.merchant_order_id,
    (obj.order as { merchant_order_id?: unknown } | undefined)?.merchant_order_id,
    (obj.payment_key_claims as { extra?: { payment_id?: unknown } } | undefined)?.extra?.payment_id,
    (obj as { special_reference?: unknown }).special_reference,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", Allow: "POST" },
    });
  }

  if (!PAYMOB_HMAC_SECRET) {
    return new Response(JSON.stringify({ error: "paymob_not_configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const receivedHmac = new URL(req.url).searchParams.get("hmac");
  let body: { type?: string; obj?: PaymobTransaction };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const obj = body.obj;
  if (!obj || body.type !== "TRANSACTION") {
    return new Response(JSON.stringify({ ok: true, ignored: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = buildPaymobTransactionHmacPayload(obj);
  const computed = await hmacSha512Hex(PAYMOB_HMAC_SECRET, payload);
  if (!timingSafeEqual(computed, receivedHmac ?? "")) {
    console.error("[paymob-webhook] hmac mismatch");
    return new Response(JSON.stringify({ error: "invalid_hmac" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const paymentId = parsePaymentId(obj);
  if (!paymentId) {
    console.error("[paymob-webhook] missing payment correlation id");
    return new Response(JSON.stringify({ error: "missing_payment_reference" }), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    });
  }

  const paymobTransactionId = Number(obj.id);
  const amountCents = Number(obj.amount_cents);
  if (!Number.isFinite(paymobTransactionId) || paymobTransactionId <= 0) {
    return new Response(JSON.stringify({ error: "invalid_transaction_id" }), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!Number.isFinite(amountCents)) {
    return new Response(JSON.stringify({ error: "invalid_amount" }), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const success = asBoolean(obj.success);
  const pending = asBoolean(obj.pending);
  const providerRef = String(obj.id);

  const { data, error } = await supabase.rpc("paymob_apply_transaction_webhook", {
    p_paymob_transaction_id: paymobTransactionId,
    p_payment_id: paymentId,
    p_success: success,
    p_pending: pending,
    p_amount_cents: Math.trunc(amountCents),
    p_provider_ref: providerRef,
    p_metadata: {
      paymob_transaction_id: paymobTransactionId,
      paymob_order_id: obj.order?.id ?? null,
      paymob_success: success,
      paymob_pending: pending,
      paymob_processed_at: new Date().toISOString(),
    },
  });

  if (error) {
    console.error("[paymob-webhook] rpc failed", error.message);
    return new Response(JSON.stringify({ error: "processing_failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, result: data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
