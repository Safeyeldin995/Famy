import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createInstance } from "i18next";
import en from "@/lib/i18n/locales/en";

const checkState = vi.hoisted(() => ({
  check: { ok: false, reason: "active_bookings" } as
    | { ok: true }
    | { ok: false; reason: "active_bookings" | "admin" | "not_authenticated" },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translations.t.bind(translations), i18n: translations }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ cancelQueries: vi.fn(), clear: vi.fn() }),
}));
vi.mock("@/lib/store", () => ({ useApp: () => ({ reset: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { signOut: vi.fn() } } }));
vi.mock("@/lib/i18n", () => ({ currentLang: () => "en" }));
vi.mock("@/lib/account/deleteAccountActions", () => ({
  fetchAccountDeletionCheck: vi.fn(async () => checkState.check),
  requestAccountDeletion: vi.fn(),
}));
vi.mock("@/components/famio/ui", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PrimaryButton: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  SecondaryButton: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}));
vi.mock("@/components/famio/CustomerPageHeader", () => ({
  CustomerPageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

const translations = createInstance();
await translations.init({ lng: "en", resources: { en: { translation: en } } });

const { AccountDeletionScreen } = await import("../AccountDeletionScreen");

afterEach(() => {
  cleanup();
  checkState.check = { ok: false, reason: "active_bookings" };
});

describe("AccountDeletionScreen blocked state", () => {
  it("shows the active bookings message and keeps delete disabled", async () => {
    render(<AccountDeletionScreen backTo="/profile" />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Finish or cancel your upcoming bookings first.",
    );
    expect(
      (screen.getByRole("button", { name: "Delete my account permanently" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("allows delete only after typing the confirmation word when eligible", async () => {
    checkState.check = { ok: true };
    render(<AccountDeletionScreen backTo="/profile" />);
    const deleteButton = await screen.findByRole("button", { name: "Delete my account permanently" });
    expect((deleteButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Type DELETE to confirm/i), { target: { value: "DELETE" } });
    await waitFor(() => {
      expect(
        (screen.getByRole("button", { name: "Delete my account permanently" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
    });
  });
});
