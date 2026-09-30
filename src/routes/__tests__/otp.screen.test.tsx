import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "@/lib/i18n";
import { OtpScreen, type OtpContextData } from "@/routes/otp";

const mockNav = vi.hoisted(() => vi.fn());
const mockResendPhoneOtpFlow = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  message: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNav,
  createFileRoute: () => () => ({
    beforeLoad: async () => ({}),
    component: () => null,
  }),
}));

vi.mock("sonner", () => ({
  toast: mockToast,
}));

vi.mock("@/lib/otp/phoneOtpFlow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/otp/phoneOtpFlow")>();
  return {
    ...actual,
    resendPhoneOtpFlow: (...args: unknown[]) => mockResendPhoneOtpFlow(...args),
    hasFirebasePhoneVerificationSession: () => true,
    verifyPhoneOtpCode: vi.fn(),
  };
});

vi.mock("@/lib/otp/OtpService", () => ({
  otpService: {
    abandonOtpFlow: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

vi.mock("@/lib/store", () => ({
  useApp: () => ({ profile: { phone: "+201012345678" } }),
}));

vi.mock("@/components/famio/ui", () => ({
  PhoneFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PrimaryButton: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/famio/CustomerPageHero", () => ({
  CustomerPageHero: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

vi.mock("@/components/famio/CustomerFloatingPanel", () => ({
  CustomerFloatingPanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/auth/OtpCodeInput", () => ({
  OtpCodeInput: () => <div data-testid="otp-code-input" />,
}));

const baseContext: OtpContextData = {
  ok: true,
  maskedPhone: "+20 *** *** 0633",
  purpose: "signup",
  role: "customer",
  otpExpiresIn: 300,
  resendAvailableIn: 25,
  delivery: "server",
};

const firebaseContext: OtpContextData = {
  ...baseContext,
  delivery: "firebase",
  resendAvailableIn: 0,
};

describe("OtpScreen countdown copy", () => {
  afterEach(() => cleanup());

  it("shows Arabic resend timer without English unit suffix", async () => {
    await i18n.changeLanguage("ar");
    render(<OtpScreen otpContext={baseContext} previewMode />);
    expect(screen.getByText(/إعادة الإرسال خلال/i)).toBeTruthy();
    expect(screen.getByText(/٢٥ ث/)).toBeTruthy();
    expect(screen.queryByText(/25s/)).toBeNull();
  });

  it("updates timer copy after language switch while countdown is active", async () => {
    await i18n.changeLanguage("en");
    render(<OtpScreen otpContext={baseContext} previewMode />);
    expect(screen.getByText(/25 s/)).toBeTruthy();
    await i18n.changeLanguage("ar");
    expect(screen.getByText(/٢٥ ث/)).toBeTruthy();
  });

  it("shows resend action when cooldown reaches zero", async () => {
    const user = userEvent.setup();
    await i18n.changeLanguage("en");
    render(<OtpScreen otpContext={{ ...baseContext, resendAvailableIn: 0 }} previewMode />);
    await user.click(screen.getByRole("button", { name: /Resend code/i }));
  });
});

describe("OtpScreen Firebase resend failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResendPhoneOtpFlow.mockReset();
  });

  afterEach(() => {
    cleanup();
    void i18n.changeLanguage("en");
  });

  it("navigates to login and shows send-failed toast when resend abandons flow (confirm failure)", async () => {
    await i18n.changeLanguage("en");
    mockResendPhoneOtpFlow.mockResolvedValue({
      ok: false,
      error: "firebase_send_failed",
      flowAbandoned: true,
    });

    const user = userEvent.setup();
    render(<OtpScreen otpContext={firebaseContext} />);
    await user.click(screen.getByRole("button", { name: /Resend code/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
      expect(mockNav).toHaveBeenCalledWith({ to: "/login", replace: true });
    });
    expect(mockToast.success).not.toHaveBeenCalled();
    const errorArg = mockToast.error.mock.calls[0]?.[0] as string;
    expect(errorArg).toMatch(/verification message|send/i);
  });

  it("navigates to forgot when reset flow resend abandons after send failure", async () => {
    await i18n.changeLanguage("en");
    mockResendPhoneOtpFlow.mockResolvedValue({
      ok: false,
      error: "firebase_send_failed",
      flowAbandoned: true,
    });

    const user = userEvent.setup();
    render(<OtpScreen otpContext={{ ...firebaseContext, purpose: "reset" }} />);
    await user.click(screen.getByRole("button", { name: /Resend code/i }));

    await waitFor(() => {
      expect(mockNav).toHaveBeenCalledWith({ to: "/auth/forgot", replace: true });
    });
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it("shows code sent only after successful resend", async () => {
    await i18n.changeLanguage("en");
    mockResendPhoneOtpFlow.mockResolvedValue({ ok: true, retryAfter: 30 });

    const user = userEvent.setup();
    render(<OtpScreen otpContext={firebaseContext} />);
    await user.click(screen.getByRole("button", { name: /Resend code/i }));

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith("Code sent.");
    });
    expect(mockNav).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it("does not show code sent on resend failure without abandon (rate limit)", async () => {
    await i18n.changeLanguage("en");
    mockResendPhoneOtpFlow.mockResolvedValue({
      ok: false,
      error: "rate_limited",
      retryAfter: 30,
    });

    const user = userEvent.setup();
    render(<OtpScreen otpContext={firebaseContext} />);
    await user.click(screen.getByRole("button", { name: /Resend code/i }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockNav).not.toHaveBeenCalled();
  });

  it("still leaves OTP screen when abandon could not be confirmed (intentCleared false)", async () => {
    await i18n.changeLanguage("en");
    mockResendPhoneOtpFlow.mockResolvedValue({
      ok: false,
      error: "firebase_send_failed",
      flowAbandoned: true,
      intentCleared: false,
    });

    const user = userEvent.setup();
    render(<OtpScreen otpContext={firebaseContext} />);
    await user.click(screen.getByRole("button", { name: /Resend code/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        "Could not send verification SMS. Try again later.",
      );
      expect(mockNav).toHaveBeenCalledWith({ to: "/login", replace: true });
    });
    expect(screen.queryByRole("button", { name: /Sending/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Resend code/i })).toBeTruthy();
  });

  it("clears resend loading when resendPhoneOtpFlow rejects unexpectedly", async () => {
    await i18n.changeLanguage("en");
    mockResendPhoneOtpFlow.mockRejectedValue(new Error("transport"));

    const user = userEvent.setup();
    render(<OtpScreen otpContext={firebaseContext} />);
    await user.click(screen.getByRole("button", { name: /Resend code/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        "Could not send verification SMS. Try again later.",
      );
      expect(mockNav).toHaveBeenCalledWith({ to: "/login", replace: true });
    });
    expect(screen.queryByRole("button", { name: /Sending/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Resend code/i })).toBeTruthy();
  });
});
