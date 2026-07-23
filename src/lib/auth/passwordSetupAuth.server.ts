import { randomUUID } from "crypto";
import type { AuthFlowPurpose, AuthFlowRole } from "./authIntent.types";
import type { DbOtpPurpose } from "@/lib/otp/types";

const SET_PASSWORD_TTL_MS = 10 * 60 * 1000;

export type PasswordSetupAuthorizationRow = {
  id: string;
  user_id: string;
  phone: string;
  purpose: DbOtpPurpose;
  signup_role: AuthFlowRole | null;
  expires_at: string;
  consumed_at: string | null;
};

export type ClaimPasswordSetupResult =
  | "ok"
  | "not_found"
  | "expired"
  | "already_consumed"
  | "mismatch";

export function fromDbOtpPurpose(purpose: DbOtpPurpose): AuthFlowPurpose {
  return purpose === "SIGNUP" ? "signup" : "reset";
}

export async function createPasswordSetupAuthorization(params: {
  userId: string;
  phone: string;
  purpose: DbOtpPurpose;
  role?: AuthFlowRole;
}): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + SET_PASSWORD_TTL_MS).toISOString();
  const { error } = await supabaseAdmin.from("password_setup_authorizations").insert({
    id,
    user_id: params.userId,
    phone: params.phone,
    purpose: params.purpose,
    signup_role: params.purpose === "SIGNUP" ? (params.role ?? "customer") : null,
    expires_at: expiresAt,
  });
  if (error) throw error;
  return id;
}

export async function readPasswordSetupAuthorization(
  authId: string,
): Promise<PasswordSetupAuthorizationRow | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("password_setup_authorizations")
    .select("id, user_id, phone, purpose, signup_role, expires_at, consumed_at")
    .eq("id", authId)
    .maybeSingle();
  if (error) throw error;
  return data as PasswordSetupAuthorizationRow | null;
}

export async function claimPasswordSetupAuthorization(params: {
  authId: string;
  userId: string;
  phone: string;
  purpose: DbOtpPurpose;
}): Promise<ClaimPasswordSetupResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("claim_password_setup_authorization", {
    p_auth_id: params.authId,
    p_user_id: params.userId,
    p_phone: params.phone,
    p_purpose: params.purpose,
  });
  if (error) throw error;
  return data as ClaimPasswordSetupResult;
}

export function isPasswordSetupAuthorizationActive(
  row: PasswordSetupAuthorizationRow,
  now = Date.now(),
): boolean {
  return !row.consumed_at && new Date(row.expires_at).getTime() > now;
}
