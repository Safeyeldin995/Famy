import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ data: { session: { user: { id: "user-1" } } } })),
  signOut: vi.fn(async () => ({ error: null })),
  signInWithPassword: vi.fn(),
  getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth } }));
vi.mock("@/lib/otp.functions", () => ({
  abandonOtpFlowFn: vi.fn(),
  beginFirebaseOtpFn: vi.fn(),
  completePasswordSetupFn: vi.fn(async () => ({
    ok: true,
    userId: "user-1",
    authEmail: "user@example.test",
    purpose: "reset",
  })),
  getOtpScreenContextFn: vi.fn(),
  getSetPasswordContextFn: vi.fn(),
  resendOtpFn: vi.fn(),
  sendOtpFn: vi.fn(),
  verifyFirebaseOtpFn: vi.fn(),
  verifyOtpFn: vi.fn(),
}));

import { otpService } from "../OtpService";

describe("completePasswordSetup after the server saved the password", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does not hang when the client sign-in never settles", async () => {
    vi.useFakeTimers();
    auth.signInWithPassword.mockReturnValue(new Promise(() => {}));
    const pending = otpService.completePasswordSetup("new-password-1");
    await vi.advanceTimersByTimeAsync(16000);
    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: "sign_in_required",
      passwordUpdated: true,
    });
  });

  it("completes normally when sign-in succeeds", async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    await expect(otpService.completePasswordSetup("new-password-1")).resolves.toMatchObject({
      ok: true,
      purpose: "reset",
    });
  });
});
