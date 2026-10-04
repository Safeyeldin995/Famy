import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "@/lib/i18n";
import { Login } from "@/routes/login";

const mockNav = vi.fn();
const mockSignIn = vi.fn();
const mockResolveRoleLanding = vi.fn();

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => mockNav,
    Link: ({ children, ...props }: { children: React.ReactNode; to: string }) => (
      <a href={props.to}>{children}</a>
    ),
    createFileRoute: () => () => ({ component: () => null }),
  };
});

vi.mock("@/lib/store", () => ({
  useApp: () => ({
    setProfile: vi.fn(),
    setAuthed: vi.fn(),
  }),
}));

vi.mock("@/lib/otp/OtpService", () => ({
  otpService: {
    signInWithPassword: (...args: unknown[]) => mockSignIn(...args),
  },
  normalizePhone: (phone: string) => phone,
}));

vi.mock("@/lib/auth/landing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/landing")>();
  return {
    ...actual,
    resolveRoleLandingForCurrentUser: (...args: unknown[]) => mockResolveRoleLanding(...args),
  };
});

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

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
    <button type="submit" data-testid="login-submit" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  RoleSelectCard: ({
    label,
    active,
    onClick,
  }: {
    label: string;
    active: boolean;
    onClick: () => void;
  }) => (
    <button type="button" aria-pressed={active} onClick={onClick}>
      {label}
    </button>
  ),
}));

vi.mock("@/components/famio/FamyWordmark", () => ({
  FamyWordmark: () => <div>Famy</div>,
}));

vi.mock("@/components/famio/LanguageToggle", () => ({
  LanguageToggle: () => null,
}));

async function signIn(chooseProviderTab: boolean) {
  const user = userEvent.setup();
  render(<Login previewMode={false} />);
  if (chooseProviderTab) {
    await user.click(screen.getByRole("button", { name: /Service Provider/i }));
  }
  const phoneInputs = screen.getAllByPlaceholderText(i18n.t("auth.phonePlaceholder"));
  await user.type(phoneInputs[0]!, "1012345678");
  await user.type(screen.getAllByPlaceholderText("••••••••")[0]!, "secret123");
  await user.click(screen.getByTestId("login-submit"));
}

describe("login post-password landing", () => {
  beforeEach(() => {
    cleanup();
    mockNav.mockClear();
    mockSignIn.mockReset();
    mockResolveRoleLanding.mockReset();
    mockSignIn.mockResolvedValue({ ok: true });
  });

  it("lands provider-only users on /pro even when customer tab is selected", async () => {
    mockResolveRoleLanding.mockResolvedValue({
      landing: "/pro",
      roles: ["provider"],
      hasProviderRole: true,
    });
    await signIn(false);
    await waitFor(() => expect(mockNav).toHaveBeenCalledWith({ to: "/pro" }));
  });

  it("lands customer-only users on /home", async () => {
    mockResolveRoleLanding.mockResolvedValue({
      landing: "/home",
      roles: ["customer"],
      hasProviderRole: false,
    });
    await signIn(false);
    await waitFor(() => expect(mockNav).toHaveBeenCalledWith({ to: "/home" }));
  });

  it("lands admin+provider users on /admin from the customer tab", async () => {
    mockResolveRoleLanding.mockResolvedValue({
      landing: "/admin",
      roles: ["admin", "provider"],
      hasProviderRole: true,
    });
    await signIn(false);
    await waitFor(() => expect(mockNav).toHaveBeenCalledWith({ to: "/admin" }));
  });

  it("lands admin+provider users on /pro from the provider tab", async () => {
    mockResolveRoleLanding.mockResolvedValue({
      landing: "/admin",
      roles: ["admin", "provider"],
      hasProviderRole: true,
    });
    await signIn(true);
    await waitFor(() => expect(mockNav).toHaveBeenCalledWith({ to: "/pro" }));
  });
});
