import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeJwt } from "jose";
import { mintLiveKitSessionToken } from "@/lib/livekit/sessionToken.server";

// Regression: a global "jose" override (v4) broke livekit-server-sdk, whose
// AccessToken.toJwt() calls setNotBefore(new Date()) (jose >= 5). Every lesson
// join failed with "[api.session.token] failed". This mints a real token.
describe("mintLiveKitSessionToken", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.LIVEKIT_URL = "wss://example.livekit.cloud";
    process.env.LIVEKIT_API_KEY = "APItestkey";
    process.env.LIVEKIT_API_SECRET = "test_secret_test_secret_test_secret_1234";
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("mints a signed token for the booking room", async () => {
    const out = await mintLiveKitSessionToken({
      bookingId: "11111111-1111-1111-1111-111111111111",
      userId: "user-1",
      party: "customer",
      displayName: "Customer",
    });
    expect(out.room).toBe("booking_11111111-1111-1111-1111-111111111111");
    expect(out.url).toBe("wss://example.livekit.cloud");
    const claims = decodeJwt(out.token) as Record<string, unknown>;
    expect(claims.sub).toBe("customer:user-1");
    expect(claims.iss).toBe("APItestkey");
    expect((claims.video as { room?: string }).room).toBe(out.room);
  });
});
