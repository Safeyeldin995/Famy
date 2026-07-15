// QA-only helper: service-role Supabase client for test setup/teardown and
// DB-state assertions. Never imported by app/browser code. Never logs the key.
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './env.mjs';

loadEnv();

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env');
}

export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

export const QA_PREFIX = 'QA_';

/** Deterministic synthetic email used as the auth identifier for a phone (mirrors src/lib/otp.functions.ts). */
export function authEmailForPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  return `phone-${digits}@famio.local`;
}
