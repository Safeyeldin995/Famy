import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashOtpForPgcrypto } from "../bcryptHashForPgcrypto";
import {
  assertOtpIntegrationReady,
  cleanupOtpRows,
  createOtpIntegrationClient,
  isOtpIntegrationMode,
  probeOtpRpcs,
  uniqueTestPhone,
} from "./otpIntegration.harness";

describe("otp bcryptjs/pgcrypto live compatibility", () => {
  let skipReason: string | undefined;
  let supabase: SupabaseClient;

  beforeAll(async () => {
    const client = createOtpIntegrationClient();
    if (!client) {
      skipReason = "local Supabase credentials unavailable (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)";
      return;
    }
    supabase = client;
    skipReason = await probeOtpRpcs(supabase);
  });

  it("verifies bcryptjs hash via otp_verify_and_consume", async (ctx) => {
    if (skipReason) {
      if (isOtpIntegrationMode()) assertOtpIntegrationReady(skipReason);
      ctx.skip(skipReason);
    }

    const phone = uniqueTestPhone("bc");
    const purpose = "SIGNUP" as const;
    const requestId = crypto.randomUUID();
    const code = "654321";
    const otpHash = await hashOtpForPgcrypto(code, 10);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    try {
      const begin = await supabase.rpc("otp_begin_send", {
        p_phone: phone,
        p_purpose: purpose,
        p_ip_address: null,
        p_user_agent: null,
        p_request_id: requestId,
        p_otp_hash: otpHash,
        p_expires_at: expiresAt,
      });
      expect(begin.error).toBeNull();
      expect(begin.data).toBe("ok");
      expect(otpHash.startsWith("$2a$")).toBe(true);

      const wrong = await supabase.rpc("otp_verify_and_consume", {
        p_phone: phone,
        p_purpose: purpose,
        p_code: "000000",
        p_max_attempts: 5,
      });
      expect(wrong.data).toBe("invalid_code");

      const correct = await supabase.rpc("otp_verify_and_consume", {
        p_phone: phone,
        p_purpose: purpose,
        p_code: code,
        p_max_attempts: 5,
      });
      expect(correct.data).toBe("ok");

      const replay = await supabase.rpc("otp_verify_and_consume", {
        p_phone: phone,
        p_purpose: purpose,
        p_code: code,
        p_max_attempts: 5,
      });
      expect(replay.data).toBe("not_found");
    } finally {
      await cleanupOtpRows(supabase, phone);
    }
  });
});
