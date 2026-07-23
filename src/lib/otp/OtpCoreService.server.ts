import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { OtpCoreService, type OtpVerificationStore } from "./OtpCoreService";
import { captureOtpForQaE2e } from "./qaE2eOtpCapture.server";
import type { DbOtpPurpose } from "./types";

export function createSupabaseOtpStore(
  supabase: SupabaseClient<Database>,
): OtpVerificationStore {
  return {
    async beginSend(params) {
      const { data, error } = await supabase.rpc("otp_begin_send", {
        p_phone: params.phone,
        p_purpose: params.purpose,
        p_ip_address: params.ipAddress,
        p_user_agent: params.userAgent,
        p_request_id: params.requestId,
        p_otp_hash: params.otpHash,
        p_expires_at: params.expiresAtIso,
        p_phone_limit: 3,
        p_phone_window: "15 minutes",
        p_ip_limit: 20,
        p_ip_window: "1 hour",
      });
      if (error) throw error;
      return data as "ok" | "rate_limited_phone" | "rate_limited_ip" | "conflict";
    },

    async verifyAndConsume(phone, purpose, code) {
      const { data, error } = await supabase.rpc("otp_verify_and_consume", {
        p_phone: phone,
        p_purpose: purpose,
        p_code: code,
        p_max_attempts: 5,
      });
      if (error) throw error;
      return data as
        | "ok"
        | "invalid_code"
        | "expired"
        | "max_attempts"
        | "not_found"
        | "already_used";
    },

    async abortUndeliveredOtp({ phone, purpose, requestId }) {
      const { error } = await supabase
        .from("otp_verifications")
        .delete()
        .eq("phone", phone)
        .eq("purpose", purpose)
        .eq("request_id", requestId)
        .is("used_at", null);
      if (error) throw error;
    },

    async deleteExpired(beforeIso) {
      const { data, error } = await supabase
        .from("otp_verifications")
        .delete()
        .lt("expires_at", beforeIso)
        .select("id");
      if (error) throw error;
      return data?.length ?? 0;
    },
  };
}

let _otpCoreService: OtpCoreService | undefined;

export async function loadOtpCoreService(): Promise<OtpCoreService> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { resolveOtpProvider } = await import("./otpProvider.server");
  if (!_otpCoreService) {
    _otpCoreService = new OtpCoreService({
      store: createSupabaseOtpStore(supabaseAdmin),
      provider: await resolveOtpProvider(),
      onOtpGenerated: (phone, purpose, otp) => {
        captureOtpForQaE2e(phone, purpose as DbOtpPurpose, otp);
      },
    });
  }
  return _otpCoreService;
}

export function resetOtpCoreServiceForTests(): void {
  _otpCoreService = undefined;
}
