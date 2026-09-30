import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "@/lib/i18n";
import { OtpScreen, type OtpContextData } from "@/routes/otp";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  createFileRoute: () => () => ({
    beforeLoad: async () => ({}),
    component: () => null,
  }),
}));

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
