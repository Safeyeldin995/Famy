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

const MAX_ATTEMPTS = 5;
const PHONE_LIMIT = 3;

function guard(skipReason: string | undefined, ctx: { skip: (reason?: string) => void }) {
  if (!skipReason) return;
  if (isOtpIntegrationMode()) assertOtpIntegrationReady(skipReason);
  ctx.skip(skipReason);
}

async function beginOtp(
  supabase: SupabaseClient,
  params: {
    phone: string;
    purpose?: "SIGNUP" | "RESET_PASSWORD";
    code: string;
    requestId?: string;
    ipAddress?: string | null;
  },
) {
  const otpHash = await hashOtpForPgcrypto(params.code, 10);
  return supabase.rpc("otp_begin_send", {
    p_phone: params.phone,
    p_purpose: params.purpose ?? "SIGNUP",
    p_ip_address: params.ipAddress ?? null,
    p_user_agent: "otp-integration-test",
    p_request_id: params.requestId ?? crypto.randomUUID(),
    p_otp_hash: otpHash,
    p_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  });
}

describe("otp PostgreSQL RPC concurrency", () => {
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

  it("allows exactly one of five simultaneous correct verifies to succeed", async (ctx) => {
    guard(skipReason, ctx);
    const phone = uniqueTestPhone("v1");
    const code = "111111";
    await beginOtp(supabase, { phone, code });

    try {
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          supabase.rpc("otp_verify_and_consume", {
            p_phone: phone,
            p_purpose: "SIGNUP",
            p_code: code,
            p_max_attempts: MAX_ATTEMPTS,
          }),
        ),
      );
      const outcomes = results.map((r) => r.data);
      expect(outcomes.filter((o) => o === "ok")).toHaveLength(1);
      expect(outcomes.filter((o) => o === "already_used" || o === "not_found").length).toBeGreaterThanOrEqual(4);
    } finally {
      await cleanupOtpRows(supabase, phone);
    }
  });

  it("tracks concurrent wrong attempts and invalidates at five", async (ctx) => {
    guard(skipReason, ctx);
    const phone = uniqueTestPhone("v2");
    await beginOtp(supabase, { phone, code: "222222" });

    try {
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          supabase.rpc("otp_verify_and_consume", {
            p_phone: phone,
            p_purpose: "SIGNUP",
            p_code: "999999",
            p_max_attempts: MAX_ATTEMPTS,
          }),
        ),
      );
      const outcomes = results.map((r) => r.data);
      expect(outcomes.filter((o) => o === "invalid_code").length).toBeGreaterThanOrEqual(1);
      expect(outcomes.filter((o) => o === "max_attempts").length).toBeGreaterThanOrEqual(1);

      const { data: row } = await supabase
        .from("otp_verifications")
        .select("attempts, used_at")
        .eq("phone", phone)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      expect(row?.attempts).toBeGreaterThanOrEqual(MAX_ATTEMPTS);
      expect(row?.used_at).not.toBeNull();

      const afterMax = await supabase.rpc("otp_verify_and_consume", {
        p_phone: phone,
        p_purpose: "SIGNUP",
        p_code: "222222",
        p_max_attempts: MAX_ATTEMPTS,
      });
      expect(afterMax.data).toBe("not_found");
    } finally {
      await cleanupOtpRows(supabase, phone);
    }
  });

  it("accepts no more than three sends per phone in fifteen minutes under concurrency", async (ctx) => {
    guard(skipReason, ctx);
    const phone = uniqueTestPhone("v3");

    try {
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          beginOtp(supabase, { phone, code: `33333${i}`, requestId: crypto.randomUUID() }),
        ),
      );
      const outcomes = results.map((r) => r.data);
      expect(outcomes.filter((o) => o === "ok")).toHaveLength(PHONE_LIMIT);
      expect(outcomes.filter((o) => o === "rate_limited_phone")).toHaveLength(6 - PHONE_LIMIT);

      const { count } = await supabase
        .from("otp_verifications")
        .select("id", { count: "exact", head: true })
        .eq("phone", phone);
      expect(count).toBe(PHONE_LIMIT);
    } finally {
      await cleanupOtpRows(supabase, phone);
    }
  });

  it("keeps only one active OTP after concurrent resend", async (ctx) => {
    guard(skipReason, ctx);
    const phone = uniqueTestPhone("v4");

    try {
      const [first, second] = await Promise.all([
        beginOtp(supabase, { phone, code: "444441", requestId: crypto.randomUUID() }),
        beginOtp(supabase, { phone, code: "444442", requestId: crypto.randomUUID() }),
      ]);
      expect(first.data).toBe("ok");
      expect(second.data).toBe("ok");

      const { data: activeRows } = await supabase
        .from("otp_verifications")
        .select("id, used_at")
        .eq("phone", phone)
        .is("used_at", null);
      expect(activeRows).toHaveLength(1);
    } finally {
      await cleanupOtpRows(supabase, phone);
    }
  });

  it("rejects the previous OTP after resend", async (ctx) => {
    guard(skipReason, ctx);
    const phone = uniqueTestPhone("v5");
    const oldCode = "555551";
    const newCode = "555552";

    try {
      await beginOtp(supabase, { phone, code: oldCode, requestId: crypto.randomUUID() });
      await beginOtp(supabase, { phone, code: newCode, requestId: crypto.randomUUID() });

      const oldVerify = await supabase.rpc("otp_verify_and_consume", {
        p_phone: phone,
        p_purpose: "SIGNUP",
        p_code: oldCode,
        p_max_attempts: MAX_ATTEMPTS,
      });
      expect(oldVerify.data).toBe("invalid_code");

      const newVerify = await supabase.rpc("otp_verify_and_consume", {
        p_phone: phone,
        p_purpose: "SIGNUP",
        p_code: newCode,
        p_max_attempts: MAX_ATTEMPTS,
      });
      expect(newVerify.data).toBe("ok");
    } finally {
      await cleanupOtpRows(supabase, phone);
    }
  });
});
