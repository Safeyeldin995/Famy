// QA-only helper: service-role Supabase client for test setup/teardown and
// DB-state assertions. Never imported by app/browser code. Never logs the key.
import { createClient } from "@supabase/supabase-js";
import { loadQaEnv } from "./load-qa-env.mjs";
import { assertQaWriteGuard } from "./env-guard.mjs";

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let adminClient = null;

function ensureAdminClient() {
  if (adminClient) return adminClient;
  loadQaEnv({ required: true });
  assertQaWriteGuard(process.env);
  adminClient = createClient(
    process.env.QA_SUPABASE_URL,
    process.env.QA_SUPABASE_SECRET_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  return adminClient;
}

export function getSupabaseAdmin() {
  return ensureAdminClient();
}

/** Lazy proxy so existing imports keep working while guarding before first use. */
export const supabaseAdmin = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = ensureAdminClient();
      const value = client[prop];
      return typeof value === "function" ? value.bind(client) : value;
    },
  },
);

export const QA_PREFIX = "QA_";

/** Deterministic synthetic email used as the auth identifier for a phone (mirrors src/lib/otp.functions.ts). */
export function authEmailForPhone(phone) {
  const digits = phone.replace(/\D/g, "");
  return `phone-${digits}@famio.local`;
}
