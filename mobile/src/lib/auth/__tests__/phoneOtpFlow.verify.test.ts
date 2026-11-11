import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyMobileFirebaseOtp = vi.hoisted(() => vi.fn());
const applyMobileVerifySession = vi.hoisted(() => vi.fn());

vi.mock("../mobileOtpApi", () => ({
  verifyMobileFirebaseOtp,
  applyMobileVerifySession,
  sendMobileOtp: vi.fn(),
  resendMobileOtp: vi.fn(),
  confirmMobileFirebaseOtpSent: vi.fn(),
  verifyMobileOtpCode: vi.fn(),
  abandonMobileOtpFlow: vi.fn(),
}));

vi.mock("../firebasePhone", () => ({
  confirmNativeFirebasePhoneOtp: vi.fn(),
  mapNativeFirebaseConfirmError: vi.fn(),
  getNativeFirebasePhoneVerificationIdToken: vi.fn(),
  hasNativeFirebasePhoneSession: vi.fn(),
  resetNativeFirebasePhoneSession: vi.fn(),
  sendNativeFirebasePhoneOtp: vi.fn(),
  signOutNativeFirebaseAuth: vi.fn(),
  subscribeNativeFirebasePhoneAutoVerify: vi.fn(),
}));

vi.mock("../mobileOtpFlowPhone", () => ({
  forgetOtpFlowPhone: vi.fn(),
  rememberOtpFlowPhone: vi.fn(),
}));

describe("verifyWithFirebaseIdToken error mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyMobileVerifySession.mockResolvedValue(true);
  });

  it("maps a 4xx after Firebase acceptance to session_expired", async () => {
    verifyMobileFirebaseOtp.mockResolvedValue({
      ok: false,
      status: 400,
      body: { ok: false, error: "invalid_code" },
    });
    const { verifyPhoneOtpWithFirebase } = await import("../phoneOtpFlow");
    const confirm = await import("../firebasePhone");
    vi.mocked(confirm.confirmNativeFirebasePhoneOtp).mockResolvedValue({
      ok: true,
      idToken: "firebase-token",
    });

    const res = await verifyPhoneOtpWithFirebase("123456", "+201012345678");
    expect(res).toEqual({ ok: false, error: "session_expired" });
  });

  it("keeps flow_mismatch from the verify API", async () => {
    verifyMobileFirebaseOtp.mockResolvedValue({
      ok: false,
      status: 409,
      body: { ok: false, error: "flow_mismatch", nextStep: "signin" },
    });
    const { verifyPhoneOtpWithFirebase } = await import("../phoneOtpFlow");
    const confirm = await import("../firebasePhone");
    vi.mocked(confirm.confirmNativeFirebasePhoneOtp).mockResolvedValue({
      ok: true,
      idToken: "firebase-token",
    });

    const res = await verifyPhoneOtpWithFirebase("123456", "+201012345678");
    expect(res).toEqual({ ok: false, error: "flow_mismatch", nextStep: "signin" });
  });
});
