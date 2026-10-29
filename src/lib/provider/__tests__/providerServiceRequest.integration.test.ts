import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createOtpIntegrationClient,
  supabaseUrl,
} from "@/lib/otp/__tests__/otpIntegration.harness";
import { IntegrationFixtureRegistry } from "@/lib/qa/integrationFixtureRegistry";
import {
  cleanupProviderHarness,
  createAuthedClient,
  createRegisteredAuthUser,
  registerQaService,
  startRegisteredProvider,
  type ProviderHarnessContext,
} from "./providerOnboarding.harness";

const admin = createOtpIntegrationClient();
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const describeIf = admin && supabaseUrl && anonKey ? describe : describe.skip;

describeIf("provider_request_service RPC", () => {
  const registry = new IntegrationFixtureRegistry({ suite: "providerServiceRequest.integration" });
  const ctx: ProviderHarnessContext = { registry, admin: admin!, anonKey: anonKey! };
  let providerClient: Awaited<ReturnType<typeof createAuthedClient>>;
  let providerId: string;
  let serviceId: string;

  beforeAll(async () => {
    const stamp = Date.now();
    const email = `qa-svc-req-${stamp}@famio.local`;
    await createRegisteredAuthUser(ctx, {
      email,
      password: "QaSvcReq123!",
      role: "provider",
      fullName: "QA Service Request",
      phone: `+20102${stamp.toString().slice(-7)}`,
    });
    providerClient = await createAuthedClient(email, "QaSvcReq123!", anonKey!);
    providerId = await startRegisteredProvider(ctx, providerClient);
    serviceId = await registerQaService(ctx, {
      slug: `qa-svc-req-${stamp}`,
      name: "QA Service Request",
      categorySlug: "home-cleaning",
    });
    await admin!.from("providers").update({ onboarding_status: "APPROVED" }).eq("id", providerId);
  });

  afterAll(async () => {
    await cleanupProviderHarness(ctx);
  });

  it("rejects bare insert for approved providers", async () => {
    const { error } = await providerClient.from("provider_services").insert({
      provider_id: providerId,
      service_id: serviceId,
    });
    expect(error).not.toBeNull();
  });

  it("rejects non-tutoring request without price when pricing allowed", async () => {
    const { error } = await providerClient.rpc("provider_request_service", {
      p_service_id: serviceId,
      p_payload: {},
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(error).not.toBeNull();
  });
});
