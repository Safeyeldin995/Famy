import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertOtpIntegrationReady,
  createOtpIntegrationClient,
  uniqueTestPhone,
} from "@/lib/otp/__tests__/otpIntegration.harness";

const supabase = createOtpIntegrationClient();
const describeIf = supabase ? describe : describe.skip;

async function probePasswordSetupRpc(): Promise<string | undefined> {
  if (!supabase) return "Supabase client unavailable";
  const probe = await supabase.rpc("claim_password_setup_authorization", {
    p_auth_id: "00000000-0000-0000-0000-000000000000",
    p_user_id: "00000000-0000-0000-0000-000000000001",
    p_phone: "+19999999999",
    p_purpose: "SIGNUP",
  });
  if (probe.error?.code === "PGRST202") {
    return "claim_password_setup_authorization RPC not found — apply password setup migration first";
  }
  if (probe.error) {
    return probe.error.message ?? "claim_password_setup_authorization probe failed";
  }
  return undefined;
}

async function insertAuthorization(params: {
  userId: string;
  phone: string;
  purpose: "SIGNUP" | "RESET_PASSWORD";
  role?: "customer" | "provider";
  expiresAt?: string;
}) {
  const id = randomUUID();
  const expiresAt = params.expiresAt ?? new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { error } = await supabase!.from("password_setup_authorizations").insert({
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

describeIf("password setup authorization RPC", () => {
  const userA = randomUUID();
  const userB = randomUUID();
  const phoneA = uniqueTestPhone("a");
  const phoneB = uniqueTestPhone("b");
  const createdIds: string[] = [];

  beforeAll(async () => {
    const reason = await probePasswordSetupRpc();
    if (reason) assertOtpIntegrationReady(reason);
  });

  afterAll(async () => {
    if (!supabase || createdIds.length === 0) return;
    await supabase.from("password_setup_authorizations").delete().in("id", createdIds);
  });

  it("allows exactly one concurrent claim to succeed", async () => {
    const authId = await insertAuthorization({
      userId: userA,
      phone: phoneA,
      purpose: "SIGNUP",
    });
    createdIds.push(authId);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        supabase!.rpc("claim_password_setup_authorization", {
          p_auth_id: authId,
          p_user_id: userA,
          p_phone: phoneA,
          p_purpose: "SIGNUP",
        }),
      ),
    );

    const outcomes = results.map((result) => result.data);
    expect(outcomes.filter((value) => value === "ok")).toHaveLength(1);
    expect(outcomes.filter((value) => value === "already_consumed").length).toBeGreaterThanOrEqual(1);
  });

  it("rejects signup authorization claimed with reset purpose", async () => {
    const authId = await insertAuthorization({
      userId: userA,
      phone: phoneA,
      purpose: "SIGNUP",
    });
    createdIds.push(authId);

    const { data } = await supabase!.rpc("claim_password_setup_authorization", {
      p_auth_id: authId,
      p_user_id: userA,
      p_phone: phoneA,
      p_purpose: "RESET_PASSWORD",
    });
    expect(data).toBe("mismatch");
  });

  it("rejects reset authorization claimed with signup purpose", async () => {
    const authId = await insertAuthorization({
      userId: userA,
      phone: phoneA,
      purpose: "RESET_PASSWORD",
    });
    createdIds.push(authId);

    const { data } = await supabase!.rpc("claim_password_setup_authorization", {
      p_auth_id: authId,
      p_user_id: userA,
      p_phone: phoneA,
      p_purpose: "SIGNUP",
    });
    expect(data).toBe("mismatch");
  });

  it("rejects authorization for a different user or phone", async () => {
    const authId = await insertAuthorization({
      userId: userA,
      phone: phoneA,
      purpose: "SIGNUP",
    });
    createdIds.push(authId);

    const wrongUser = await supabase!.rpc("claim_password_setup_authorization", {
      p_auth_id: authId,
      p_user_id: userB,
      p_phone: phoneA,
      p_purpose: "SIGNUP",
    });
    expect(wrongUser.data).toBe("mismatch");

    const wrongPhone = await supabase!.rpc("claim_password_setup_authorization", {
      p_auth_id: authId,
      p_user_id: userA,
      p_phone: phoneB,
      p_purpose: "SIGNUP",
    });
    expect(wrongPhone.data).toBe("mismatch");
  });

  it("keeps authorization consumed after claim even when password update would fail", async () => {
    const authId = await insertAuthorization({
      userId: userA,
      phone: phoneA,
      purpose: "SIGNUP",
    });
    createdIds.push(authId);

    const claim = await supabase!.rpc("claim_password_setup_authorization", {
      p_auth_id: authId,
      p_user_id: userA,
      p_phone: phoneA,
      p_purpose: "SIGNUP",
    });
    expect(claim.data).toBe("ok");

    const { data: row } = await supabase!
      .from("password_setup_authorizations")
      .select("consumed_at")
      .eq("id", authId)
      .single();
    expect(row?.consumed_at).not.toBeNull();

    const replay = await supabase!.rpc("claim_password_setup_authorization", {
      p_auth_id: authId,
      p_user_id: userA,
      p_phone: phoneA,
      p_purpose: "SIGNUP",
    });
    expect(replay.data).toBe("already_consumed");
  });

  it("rejects expired and replayed authorizations", async () => {
    const expiredId = await insertAuthorization({
      userId: userA,
      phone: phoneA,
      purpose: "SIGNUP",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    createdIds.push(expiredId);

    const expired = await supabase!.rpc("claim_password_setup_authorization", {
      p_auth_id: expiredId,
      p_user_id: userA,
      p_phone: phoneA,
      p_purpose: "SIGNUP",
    });
    expect(expired.data).toBe("expired");

    const replayId = await insertAuthorization({
      userId: userA,
      phone: phoneA,
      purpose: "SIGNUP",
    });
    createdIds.push(replayId);

    const first = await supabase!.rpc("claim_password_setup_authorization", {
      p_auth_id: replayId,
      p_user_id: userA,
      p_phone: phoneA,
      p_purpose: "SIGNUP",
    });
    expect(first.data).toBe("ok");

    const replay = await supabase!.rpc("claim_password_setup_authorization", {
      p_auth_id: replayId,
      p_user_id: userA,
      p_phone: phoneA,
      p_purpose: "SIGNUP",
    });
    expect(replay.data).toBe("already_consumed");
  });
});
