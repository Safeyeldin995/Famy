import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authEmailForPhone } from "@/lib/auth/authEmail";
import {
  assertOtpIntegrationReady,
  createOtpIntegrationClient,
  supabaseUrl,
  uniqueTestPhone,
} from "@/lib/otp/__tests__/otpIntegration.harness";

const admin = createOtpIntegrationClient();
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const describeIf = admin && supabaseUrl && anonKey ? describe : describe.skip;

async function probeErrorLogsTable(): Promise<string | undefined> {
  const probe = await admin!.from("error_logs").select("id").limit(1);
  if (probe.error?.code === "42P01") {
    return "error_logs table not found — apply monitoring migration first";
  }
  if (probe.error) {
    return probe.error.message ?? "error_logs probe failed";
  }
  return undefined;
}

describeIf("error_logs access control", () => {
  const phone = uniqueTestPhone("monitoring");
  const password = `Qa-${randomUUID().slice(0, 8)}!9a`;
  const authEmail = authEmailForPhone(phone);
  const seededMarker = `qa_error_logs_access_${Date.now()}`;
  let userId: string;
  let customerClient: SupabaseClient;

  beforeAll(async () => {
    const reason = await probeErrorLogsTable();
    if (reason) assertOtpIntegrationReady(reason);

    const { data: created, error: createError } = await admin!.auth.admin.createUser({
      email: authEmail,
      phone,
      password,
      email_confirm: true,
    });
    if (createError) throw createError;
    userId = created.user!.id;

    customerClient = createClient(supabaseUrl!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInError } = await customerClient.auth.signInWithPassword({
      email: authEmail,
      password,
    });
    if (signInError) throw signInError;

    const { error: seedError } = await admin!.from("error_logs").insert({
      message_safe: seededMarker,
      source: "server",
      context_label: "qa_error_logs_access",
    });
    if (seedError) throw seedError;
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    try {
      if (userId) {
        await admin.auth.admin.deleteUser(userId);
      }
    } finally {
      const { data, error } = await admin
        .from("error_logs")
        .delete()
        .eq("message_safe", seededMarker)
        .select("id");
      expect(error).toBeNull();
      expect(data?.length ?? 0).toBeGreaterThanOrEqual(0);
    }
  }, 120_000);

  it("denies authenticated non-admin SELECT on error_logs", async () => {
    const { data, error } = await customerClient.from("error_logs").select("id").limit(5);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("denies authenticated non-admin INSERT on error_logs", async () => {
    const { error } = await customerClient.from("error_logs").insert({
      message_safe: "should_not_persist",
      source: "client",
    });
    expect(error).toBeTruthy();
    expect(error?.message ?? "").toMatch(/permission|policy|42501/i);
  });

  it("denies authenticated non-admin admin_monitoring_summary RPC", async () => {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { error } = await customerClient.rpc("admin_monitoring_summary", { p_since: since });
    expect(error).toBeTruthy();
    expect(error?.message ?? "").toMatch(/Admin authorization required|42501/i);
  });

  it("allows service_role INSERT on error_logs", async () => {
    const marker = `qa_service_role_insert_${Date.now()}`;
    try {
      const { data, error } = await admin!
        .from("error_logs")
        .insert({
          message_safe: marker,
          source: "server",
          context_label: "qa_service_role_insert",
        })
        .select("id")
        .single();
      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();
    } finally {
      const { data, error } = await admin!
        .from("error_logs")
        .delete()
        .eq("message_safe", marker)
        .select("id");
      expect(error).toBeNull();
      expect(data?.length ?? 0).toBeGreaterThanOrEqual(0);
    }
  });
});
