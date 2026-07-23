import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i < 0) continue;
    const key = trimmed.slice(0, i).trim();
    let value = trimmed.slice(i + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.resolve(process.cwd(), ".env"));
loadEnvFile(path.resolve(process.cwd(), ".env.local"));

export const supabaseUrl = process.env.SUPABASE_URL;
export const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function isOtpIntegrationMode(): boolean {
  return process.env.OTP_INTEGRATION === "1";
}

export function assertOtpIntegrationReady(reason: string): void {
  if (isOtpIntegrationMode()) {
    throw new Error(`OTP integration test failed: ${reason}`);
  }
}

export function createOtpIntegrationClient(): SupabaseClient | null {
  if (!supabaseUrl || !serviceRoleKey) {
    assertOtpIntegrationReady(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required",
    );
    return null;
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function probeOtpRpcs(
  supabase: SupabaseClient,
): Promise<string | undefined> {
  const probe = await supabase.rpc("otp_begin_send", {
    p_phone: "+19999999999",
    p_purpose: "SIGNUP",
    p_ip_address: null,
    p_user_agent: null,
    p_request_id: "00000000-0000-0000-0000-000000000000",
    p_otp_hash: "$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012",
    p_expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  if (probe.error?.code === "PGRST202") {
    return "otp_begin_send RPC not found — apply OTP migrations to local Supabase first";
  }
  if (probe.error) {
    return probe.error.message ?? "otp_begin_send probe failed";
  }
  return undefined;
}

export function uniqueTestPhone(suffix = ""): string {
  const tail = `${Date.now()}${suffix}`.slice(-8);
  return `+2019${tail.padStart(8, "0").slice(-8)}`;
}

export async function cleanupOtpRows(supabase: SupabaseClient, phone: string): Promise<void> {
  await supabase.from("otp_verifications").delete().eq("phone", phone);
}
