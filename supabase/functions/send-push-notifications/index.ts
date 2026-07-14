// Famy Patch 3 / Module 4: push delivery worker.
//
// Invoked on a schedule (Supabase Edge Function Cron Trigger, or pg_cron +
// pg_net). verify_jwt is left at true at the gateway, but that alone is NOT
// sufficient authorization: verify_jwt only checks that the caller presented
// *some* validly-signed project JWT, and the public anon key itself is one —
// it ships in the browser bundle, so any anonymous caller could satisfy it.
// The actual gate is the NOTIFICATION_WORKER_SECRET check below: only the
// cron invocation (configured with that secret as a header) can run the
// worker. It claims due public.notification_outbox rows via the atomic
// claim_notification_outbox_batch() RPC (row-locked with FOR UPDATE SKIP
// LOCKED so concurrent invocations never double-claim), sends one Web Push
// message per active subscription for that recipient via standard VAPID
// signing, and reports outcomes back onto the outbox row — it never returns
// raw provider responses to the caller.
//
// Requires these secrets to be set on the Supabase project (see the
// deployment notes given to the operator; never committed to the repo):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, NOTIFICATION_WORKER_SECRET
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by
// the Supabase Edge Runtime for every function.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT");
const WORKER_SECRET = Deno.env.get("NOTIFICATION_WORKER_SECRET");

const BATCH_SIZE = 50;
const STALE_PROCESSING_MINUTES = 5;
const MAX_ATTEMPTS = 5;

// Constant-time compare so a mistimed response can't leak the secret byte-by-byte.
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

function backoffMinutes(attempts: number): number {
  return Math.min(60, 2 ** attempts);
}

type OutboxRow = { id: string; notification_id: string; recipient_user_id: string; attempts: number };

Deno.serve(async (req) => {
  if (!WORKER_SECRET) {
    return new Response(JSON.stringify({ error: "worker_not_configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  const presented = req.headers.get("x-worker-secret") || "";
  if (!timingSafeEqual(presented, WORKER_SECRET)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    return new Response(JSON.stringify({ error: "vapid_not_configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: due, error: dueErr } = await supabase.rpc("claim_notification_outbox_batch", {
    p_batch_size: BATCH_SIZE,
    p_stale_minutes: STALE_PROCESSING_MINUTES,
  });

  if (dueErr) {
    return new Response(JSON.stringify({ error: "query_failed" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
  if (!due || due.length === 0) {
    return new Response(JSON.stringify({ processed: 0 }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  let sent = 0;
  let failed = 0;
  let dead = 0;

  for (const row of due as OutboxRow[]) {
    try {
      const { data: notif } = await supabase
        .from("notifications")
        .select("title_en, title_ar, body_en, body_ar, deep_link")
        .eq("id", row.notification_id)
        .maybeSingle();

      const { data: profile } = await supabase
        .from("profiles")
        .select("locale")
        .eq("id", row.recipient_user_id)
        .maybeSingle();

      const locale = profile?.locale === "ar" ? "ar" : "en";
      const title = (locale === "ar" ? notif?.title_ar : notif?.title_en) || notif?.title_en || "Famy";
      const body = (locale === "ar" ? notif?.body_ar : notif?.body_en) || notif?.body_en || "";

      const { data: subs } = await supabase
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth_key")
        .eq("user_id", row.recipient_user_id)
        .is("revoked_at", null);

      // No active device to push to isn't a delivery failure — the in-app
      // notification (already persisted before this row was ever enqueued)
      // is still the source of truth for the notification center.
      if (!subs || subs.length === 0) {
        await supabase.from("notification_outbox").update({
          status: "sent", processed_at: new Date().toISOString(), attempts: row.attempts + 1,
        }).eq("id", row.id);
        sent++;
        continue;
      }

      const payload = JSON.stringify({ title, body, deepLink: notif?.deep_link || "/", tag: row.notification_id });
      let anySuccess = false;
      let lastSafeError = "";

      for (const sub of subs) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
            payload,
          );
          anySuccess = true;
        } catch (err: any) {
          const statusCode = err?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await supabase.rpc("mark_push_subscription_expired", { p_endpoint: sub.endpoint });
          } else {
            lastSafeError = "delivery_error";
          }
        }
      }

      if (anySuccess) {
        await supabase.from("notification_outbox").update({
          status: "sent", processed_at: new Date().toISOString(), attempts: row.attempts + 1,
        }).eq("id", row.id);
        sent++;
      } else {
        const nextAttempts = row.attempts + 1;
        if (nextAttempts >= MAX_ATTEMPTS) {
          await supabase.from("notification_outbox").update({
            status: "dead", attempts: nextAttempts,
            last_error_safe: lastSafeError || "no_active_subscription",
            processed_at: new Date().toISOString(),
          }).eq("id", row.id);
          dead++;
        } else {
          await supabase.from("notification_outbox").update({
            status: "failed", attempts: nextAttempts,
            next_attempt_at: new Date(Date.now() + backoffMinutes(nextAttempts) * 60_000).toISOString(),
            last_error_safe: lastSafeError || "no_active_subscription",
          }).eq("id", row.id);
          failed++;
        }
      }
    } catch {
      const nextAttempts = row.attempts + 1;
      await supabase.from("notification_outbox").update({
        status: nextAttempts >= MAX_ATTEMPTS ? "dead" : "failed",
        attempts: nextAttempts,
        next_attempt_at: new Date(Date.now() + backoffMinutes(nextAttempts) * 60_000).toISOString(),
        last_error_safe: "processing_error",
      }).eq("id", row.id);
      failed++;
    }
  }

  return new Response(JSON.stringify({ processed: due.length, sent, failed, dead }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
