import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertOtpIntegrationReady,
  createOtpIntegrationClient,
} from "@/lib/otp/__tests__/otpIntegration.harness";

const admin = createOtpIntegrationClient();
const describeIf = admin ? describe : describe.skip;

async function probeRateLimitRpc(): Promise<string | undefined> {
  const probe = await admin!.rpc("error_log_client_rate_limit_allow", {
    p_rate_key: "qa_probe_key",
    p_limit: 20,
    p_window_seconds: 60,
  });
  if (probe.error?.code === "PGRST202") {
    return "error_log_client_rate_limit_allow RPC not found — apply rate-limit migration first";
  }
  if (probe.error) {
    return probe.error.message ?? "error_log_client_rate_limit_allow probe failed";
  }
  return undefined;
}

describeIf("error_log client rate limiting RPC", () => {
  const rateKey = `qa_error_log_rate_${Date.now()}`;

  beforeAll(async () => {
    const reason = await probeRateLimitRpc();
    if (reason) assertOtpIntegrationReady(reason);
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from("error_log_rate_limits").delete().eq("rate_key", rateKey);
  });

  it("allows up to the configured limit then rejects further requests in the same window", async () => {
    const limit = 5;
    const windowSeconds = 60;
    const outcomes: boolean[] = [];

    for (let i = 0; i < limit + 1; i += 1) {
      const { data, error } = await admin!.rpc("error_log_client_rate_limit_allow", {
        p_rate_key: rateKey,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      });
      expect(error).toBeNull();
      outcomes.push(data === true);
    }

    expect(outcomes.filter(Boolean)).toHaveLength(limit);
    expect(outcomes.at(-1)).toBe(false);
  });
});
