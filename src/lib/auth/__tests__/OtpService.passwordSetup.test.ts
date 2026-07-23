import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();
const mockSignOut = vi.fn();
const mockSignInWithPassword = vi.fn();
const mockGetUser = vi.fn();
const mockCompletePasswordSetupFn = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
      getUser: (...args: unknown[]) => mockGetUser(...args),
    },
  },
}));

vi.mock("@/lib/otp.functions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/otp.functions")>();
  return {
    ...actual,
    completePasswordSetupFn: (...args: unknown[]) => mockCompletePasswordSetupFn(...args),
    getOtpScreenContextFn: vi.fn(),
    getSetPasswordContextFn: vi.fn(),
    sendOtpFn: vi.fn(),
    resendOtpFn: vi.fn(),
    verifyOtpFn: vi.fn(),
    abandonOtpFlowFn: vi.fn(),
  };
});

describe("otpService.completePasswordSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
    mockSignOut.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.resetModules();
  });

  async function loadOtpService() {
    const { otpService } = await import("@/lib/otp/OtpService");
    return otpService;
  }

  it("returns restart_required and signs out when server update fails after claim", async () => {
    mockCompletePasswordSetupFn.mockResolvedValue({
      ok: false,
      error: "restart_required",
      nextStep: "signup",
      message: "We could not finish setting your password. Please verify your phone again.",
    });
    const otpService = await loadOtpService();
    const result = await otpService.completePasswordSetup("SecretPass1!");
    expect(result).toEqual({
      ok: false,
      error: "restart_required",
      nextStep: "signup",
      message: "We could not finish setting your password. Please verify your phone again.",
    });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toMatch(/SecretPass1!/);
  });

  it("returns sign_in_required when server credential verification fails after password update", async () => {
    mockCompletePasswordSetupFn.mockResolvedValue({
      ok: false,
      error: "sign_in_required",
      passwordUpdated: true,
      message: "Password saved. Please sign in with your new password.",
    });
    const otpService = await loadOtpService();
    const result = await otpService.completePasswordSetup("SecretPass1!");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("sign_in_required");
      expect(result.passwordUpdated).toBe(true);
    }
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("returns sign_in_required when client sign-in fails after successful server update", async () => {
    mockCompletePasswordSetupFn.mockResolvedValue({
      ok: true,
      userId: "user-1",
      authEmail: "phone-201012345678@famio.local",
      purpose: "signup",
      role: "customer",
    });
    mockSignInWithPassword.mockResolvedValue({ error: { code: "invalid_credentials" } });
    const otpService = await loadOtpService();
    const result = await otpService.completePasswordSetup("SecretPass1!");
    expect(result).toEqual({
      ok: false,
      error: "sign_in_required",
      message: "Password saved. Please sign in with your new password.",
      passwordUpdated: true,
    });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("returns sign_in_required when getUser fails after client sign-in", async () => {
    mockCompletePasswordSetupFn.mockResolvedValue({
      ok: true,
      userId: "user-1",
      authEmail: "phone-201012345678@famio.local",
      purpose: "signup",
    });
    mockSignInWithPassword.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { code: "session_not_found" } });
    const otpService = await loadOtpService();
    const result = await otpService.completePasswordSetup("SecretPass1!");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("sign_in_required");
    expect(mockSignOut).toHaveBeenCalledTimes(2);
  });

  it("returns sign_in_required when authenticated user id mismatches authorization", async () => {
    mockCompletePasswordSetupFn.mockResolvedValue({
      ok: true,
      userId: "user-1",
      authEmail: "phone-201012345678@famio.local",
      purpose: "signup",
    });
    mockSignInWithPassword.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({ data: { user: { id: "other-user" } }, error: null });
    const otpService = await loadOtpService();
    const result = await otpService.completePasswordSetup("SecretPass1!");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("sign_in_required");
    expect(mockSignOut).toHaveBeenCalledTimes(2);
  });

  it("succeeds when session user matches authorization user id", async () => {
    mockCompletePasswordSetupFn.mockResolvedValue({
      ok: true,
      userId: "user-1",
      authEmail: "phone-201012345678@famio.local",
      purpose: "signup",
      role: "provider",
    });
    mockSignInWithPassword.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    const otpService = await loadOtpService();
    const result = await otpService.completePasswordSetup("SecretPass1!");
    expect(result).toEqual({ ok: true, purpose: "signup", role: "provider" });
    expect(JSON.stringify(result)).not.toMatch(/SecretPass1!/);
    expect(JSON.stringify(result)).not.toContain("access_token");
  });
});
