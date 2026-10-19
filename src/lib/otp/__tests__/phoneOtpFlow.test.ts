import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";

const mockOtp = vi.hoisted(() => ({
  beginFirebaseOtp: vi.fn(),
  sendOtp: vi.fn(),
  resendOtp: vi.fn(),
  abandonOtpFlow: vi.fn(),
  confirmFirebaseOtpSent: vi.fn(),
  verifyOtp: vi.fn(),
  verifyFirebaseOtp: vi.fn(),
}));

const mockFirebaseProvider = vi.hoisted(() => ({ isClient: false }));

vi.mock("@/lib/otp/otpProviderConfig", () => ({
  isClientFirebaseOtpProvider: () => mockFirebaseProvider.isClient,
}));

vi.mock("@/lib/otp/OtpService", () => ({
  otpService: mockOtp,
  normalizePhone: (raw: string) => raw,
}));

const mockLogClientErrorFn = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));

vi.mock("@/lib/error-log.functions", () => ({
  logClientErrorFn: mockLogClientErrorFn,
}));

vi.mock("@/lib/otp/firebaseAuth.browser", () => ({
  sendFirebasePhoneOtp: vi.fn(),
  confirmFirebasePhoneOtp: vi.fn(),
  hasFirebasePhoneVerificationSession: vi.fn(() => false),
  FirebaseRecaptchaContainerError: class FirebaseRecaptchaContainerError extends Error {},
  FirebasePhoneVerificationSessionError: class FirebasePhoneVerificationSessionError extends Error {
    code = "session_lost";
  },
}));

describe("phoneOtpFlow", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockFirebaseProvider.isClient = false;
    mockOtp.confirmFirebaseOtpSent.mockResolvedValue({ ok: true });
    mockOtp.abandonOtpFlow.mockResolvedValue({ ok: true });
    await i18n.changeLanguage("en");
  });

  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("does not treat server send failure as success", async () => {
    mockOtp.sendOtp.mockResolvedValue({ ok: false, error: "delivery_failed", retryAfter: 30 });
    const { startPhoneOtpFlow } = await import("../phoneOtpFlow");
    const res = await startPhoneOtpFlow("+201012345678", "signup", "customer");
    expect(res).toEqual({ ok: false, error: "delivery_failed", retryAfter: 30 });
  });

  it("confirms Firebase delivery before returning success", async () => {
    mockFirebaseProvider.isClient = true;
    mockOtp.beginFirebaseOtp.mockResolvedValue({ ok: true });
    const { sendFirebasePhoneOtp } = await import("@/lib/otp/firebaseAuth.browser");
    vi.mocked(sendFirebasePhoneOtp).mockResolvedValue(undefined);
    mockOtp.confirmFirebaseOtpSent.mockResolvedValue({ ok: true });

    const { startPhoneOtpFlow } = await import("../phoneOtpFlow");
    const res = await startPhoneOtpFlow("+201012345678", "signup", "customer", {
      languageCode: "ar",
    });
    expect(res.ok).toBe(true);
    expect(mockOtp.confirmFirebaseOtpSent).toHaveBeenCalledTimes(1);
  });

  it("abandons Firebase flow when SMS send fails", async () => {
    mockFirebaseProvider.isClient = true;
    mockOtp.beginFirebaseOtp.mockResolvedValue({ ok: true });
    const { sendFirebasePhoneOtp } = await import("@/lib/otp/firebaseAuth.browser");
    vi.mocked(sendFirebasePhoneOtp).mockRejectedValue(new Error("network"));

    const { startPhoneOtpFlow } = await import("../phoneOtpFlow");
    const res = await startPhoneOtpFlow("+201012345678", "signup", "customer");
    expect(res).toEqual({ ok: false, error: "firebase_send_failed" });
    expect(mockOtp.abandonOtpFlow).toHaveBeenCalledTimes(1);
  });

  it("abandons Firebase flow when resend confirm fails so the prior code is not stuck invalid", async () => {
    mockFirebaseProvider.isClient = true;
    mockOtp.resendOtp.mockResolvedValue({ ok: true, retryAfter: 30 });
    const { sendFirebasePhoneOtp } = await import("@/lib/otp/firebaseAuth.browser");
    vi.mocked(sendFirebasePhoneOtp).mockResolvedValue(undefined);
    mockOtp.confirmFirebaseOtpSent.mockResolvedValue({ ok: false });

    const { resendPhoneOtpFlow } = await import("../phoneOtpFlow");
    const res = await resendPhoneOtpFlow("+201012345678");
    expect(res).toEqual({
      ok: false,
      error: "firebase_send_failed",
      flowAbandoned: true,
      intentCleared: true,
    });
    expect(mockOtp.abandonOtpFlow).toHaveBeenCalledTimes(1);
  });

  it("abandons Firebase flow when resend SMS send throws", async () => {
    mockFirebaseProvider.isClient = true;
    mockOtp.resendOtp.mockResolvedValue({ ok: true, retryAfter: 30 });
    const { sendFirebasePhoneOtp } = await import("@/lib/otp/firebaseAuth.browser");
    vi.mocked(sendFirebasePhoneOtp).mockRejectedValue(new Error("network"));

    const { resendPhoneOtpFlow } = await import("../phoneOtpFlow");
    const res = await resendPhoneOtpFlow("+201012345678");
    expect(res).toEqual({
      ok: false,
      error: "firebase_send_failed",
      flowAbandoned: true,
      intentCleared: true,
    });
    expect(mockOtp.abandonOtpFlow).toHaveBeenCalledTimes(1);
    expect(mockOtp.confirmFirebaseOtpSent).not.toHaveBeenCalled();
  });

  it("returns send failure without throwing when abandonOtpFlow rejects after resend failure", async () => {
    mockFirebaseProvider.isClient = true;
    mockOtp.resendOtp.mockResolvedValue({ ok: true, retryAfter: 30 });
    mockOtp.abandonOtpFlow.mockRejectedValue(new Error("network"));
    const { sendFirebasePhoneOtp } = await import("@/lib/otp/firebaseAuth.browser");
    vi.mocked(sendFirebasePhoneOtp).mockRejectedValue(new Error("sms failed"));

    const { resendPhoneOtpFlow } = await import("../phoneOtpFlow");
    const res = await resendPhoneOtpFlow("+201012345678");
    expect(res).toEqual({
      ok: false,
      error: "firebase_send_failed",
      flowAbandoned: true,
      intentCleared: false,
    });
  });

  it("returns success when Firebase resend send and confirm succeed", async () => {
    mockFirebaseProvider.isClient = true;
    mockOtp.resendOtp.mockResolvedValue({ ok: true, retryAfter: 45 });
    const { sendFirebasePhoneOtp } = await import("@/lib/otp/firebaseAuth.browser");
    vi.mocked(sendFirebasePhoneOtp).mockResolvedValue(undefined);
    mockOtp.confirmFirebaseOtpSent.mockResolvedValue({ ok: true });

    const { resendPhoneOtpFlow } = await import("../phoneOtpFlow");
    const res = await resendPhoneOtpFlow("+201012345678", { languageCode: "en" });
    expect(res).toEqual({ ok: true, retryAfter: 45 });
    expect(mockOtp.abandonOtpFlow).not.toHaveBeenCalled();
    expect(mockOtp.confirmFirebaseOtpSent).toHaveBeenCalledTimes(1);
  });

  it("still verifies after a successful Firebase resend", async () => {
    mockFirebaseProvider.isClient = true;
    mockOtp.resendOtp.mockResolvedValue({ ok: true, retryAfter: 30 });
    const { sendFirebasePhoneOtp, confirmFirebasePhoneOtp } =
      await import("@/lib/otp/firebaseAuth.browser");
    vi.mocked(sendFirebasePhoneOtp).mockResolvedValue(undefined);
    mockOtp.confirmFirebaseOtpSent.mockResolvedValue({ ok: true });
    vi.mocked(confirmFirebasePhoneOtp).mockResolvedValue("firebase-id-token");
    mockOtp.verifyFirebaseOtp.mockResolvedValue({ ok: true });

    const { resendPhoneOtpFlow, verifyPhoneOtpCode } = await import("../phoneOtpFlow");
    const resend = await resendPhoneOtpFlow("+201012345678");
    expect(resend.ok).toBe(true);

    const verify = await verifyPhoneOtpCode("123456");
    expect(verify).toEqual({ ok: true });
    expect(mockOtp.verifyFirebaseOtp).toHaveBeenCalledWith("firebase-id-token");
  });

  it("maps rate limit errors to localized wait guidance", async () => {
    const { phoneOtpFlowErrorMessage } = await import("../phoneOtpFlow");
    await i18n.changeLanguage("ar");
    const msg = phoneOtpFlowErrorMessage("rate_limited", i18n.t.bind(i18n), 30);
    expect(msg).toContain("محاولات");
    expect(msg).toMatch(/٣٠|30/);
    expect(msg).not.toMatch(/\d+s$/);
  });

  it.each([
    ["auth/too-many-requests", "en", "Too many attempts from this device"],
    ["auth/quota-exceeded", "en", "SMS service is busy"],
    ["auth/invalid-phone-number", "en", "valid phone number"],
    ["auth/captcha-check-failed", "en", "Could not verify this device"],
    ["auth/invalid-app-credential", "ar", "تعذر التحقق من الجهاز"],
    ["auth/missing-app-credential", "ar", "تعذر التحقق من الجهاز"],
  ] as const)(
    "maps Firebase send code %s to a specific message (%s)",
    async (code, lang, expectedFragment) => {
      await i18n.changeLanguage(lang);
      const { phoneOtpFlowErrorMessage } = await import("../phoneOtpFlow");
      const msg = phoneOtpFlowErrorMessage("firebase_send_failed", i18n.t.bind(i18n), undefined, code);
      expect(msg).toContain(expectedFragment);
    },
  );

  it("falls back to firebaseSendFailed for an unknown Firebase auth code", async () => {
    await i18n.changeLanguage("en");
    const { phoneOtpFlowErrorMessage } = await import("../phoneOtpFlow");
    const msg = phoneOtpFlowErrorMessage(
      "firebase_send_failed",
      i18n.t.bind(i18n),
      undefined,
      "auth/internal-error",
    );
    expect(msg).toBe(i18n.t("auth.firebaseSendFailed"));
  });

  it("logs Firebase auth code on send failure without logging the phone number", async () => {
    mockFirebaseProvider.isClient = true;
    mockOtp.beginFirebaseOtp.mockResolvedValue({ ok: true });
    const phone = "+201012345678";
    const { sendFirebasePhoneOtp } = await import("@/lib/otp/firebaseAuth.browser");
    vi.mocked(sendFirebasePhoneOtp).mockRejectedValue(
      Object.assign(new Error("quota"), { code: "auth/quota-exceeded" }),
    );

    const { startPhoneOtpFlow } = await import("../phoneOtpFlow");
    const res = await startPhoneOtpFlow(phone, "signup", "customer");
    expect(res).toMatchObject({
      ok: false,
      error: "firebase_send_failed",
      firebaseAuthCode: "auth/quota-exceeded",
    });
    expect(mockLogClientErrorFn).toHaveBeenCalledTimes(1);
    const payload = mockLogClientErrorFn.mock.calls[0]?.[0];
    expect(payload?.data?.message).toBe("Firebase send failed: auth/quota-exceeded");
    expect(payload?.data?.contextLabel).toBe("firebase_send_failed");
    expect(JSON.stringify(payload)).not.toContain(phone);
  });
});
