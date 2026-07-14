// Famy Patch 3 / Module 4: push delivery worker.
//
// Invoked on a schedule (Supabase Edge Function Cron Trigger, or pg_cron +
// pg_net) with the project's service_role key as its bearer token — that's
// the only credential that can call this function, since Supabase verifies
// the JWT before routing the request here (verify_jwt is left at its
// default of true). It claims due public.notification_outbox rows, sends
// one Web Push message per active subscription for that recipient via
// standard VAPID signing, and reports outcomes back onto the outbox row —
// it never returns raw provider responses to the caller.
//
// Requires these secrets to be set on the Supabase project (see the
// deployment notes given to the operator; never committed to the repo):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by
// the Supabase Edge Runtime for every function.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT");

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 5;

function backoffMinutes(attempts: number): number {
  return Math.min(60, 2 ** attempts);
}

type OutboxRow = { id: string; notification_id: string; recipient_user_id: string; attempts: number };

Deno.serve(async (_req) => {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    return new Response(JSON.stringify({ error: "vapid_not_configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: due, error: dueErr } = await supabase
    .from("notification_outbox")
    .select("id, notification_id, recipient_user_id, attempts")
    .in("status", ["queued", "failed"])
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (dueErr) {
    return new Response(JSON.stringify({ error: "query_failed" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
  if (!due || due.length === 0) {
    return new Response(JSON.stringify({ processed: 0 }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  const ids = (due as OutboxRow[]).map((r) => r.id);
  await supabase.from("notification_outbox").update({ status: "processing" }).in("id", ids);

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
