import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mfa = vi.hoisted(() => ({
  getAuthenticatorAssuranceLevel: vi.fn(),
  listFactors: vi.fn(),
  unenroll: vi.fn(async () => ({ error: null })),
  enroll: vi.fn(),
  challengeAndVerify: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { mfa } } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { AdminMfaGate } from "../AdminMfaGate";

const aal = (currentLevel: string) => ({ data: { currentLevel }, error: null });

describe("AdminMfaGate", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the admin panel once the session is aal2", async () => {
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(aal("aal2"));
    render(<AdminMfaGate>panel</AdminMfaGate>);
    expect(await screen.findByText("panel")).toBeTruthy();
  });

  it("asks for the code when a factor exists and unlocks after verifying", async () => {
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(aal("aal1"));
    mfa.listFactors.mockResolvedValue({
      data: { totp: [{ id: "f1", status: "verified" }], all: [{ id: "f1", status: "verified" }] },
      error: null,
    });
    mfa.challengeAndVerify.mockResolvedValue({ error: null });
    render(<AdminMfaGate>panel</AdminMfaGate>);
    const input = await screen.findByLabelText("adminMfa.codeLabel");
    expect(screen.queryByText("panel")).toBeNull();
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByText("adminMfa.confirm"));
    await waitFor(() => expect(screen.getByText("panel")).toBeTruthy());
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: "f1", code: "123456" });
    expect(mfa.enroll).not.toHaveBeenCalled();
  });

  it("enrolls a new authenticator when none is verified, and keeps the panel locked on a wrong code", async () => {
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(aal("aal1"));
    mfa.listFactors.mockResolvedValue({
      data: { totp: [], all: [{ id: "stale", status: "unverified" }] },
      error: null,
    });
    mfa.enroll.mockResolvedValue({
      data: { id: "f2", totp: { qr_code: "data:image/svg+xml;utf8,<svg/>", secret: "ABC" } },
      error: null,
    });
    mfa.challengeAndVerify.mockResolvedValue({ error: new Error("invalid") });
    render(<AdminMfaGate>panel</AdminMfaGate>);
    expect(await screen.findByText("ABC")).toBeTruthy();
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: "stale" });
    fireEvent.change(screen.getByLabelText("adminMfa.codeLabel"), { target: { value: "000000" } });
    fireEvent.click(screen.getByText("adminMfa.confirm"));
    expect(await screen.findByText("adminMfa.wrongCode")).toBeTruthy();
    expect(screen.queryByText("panel")).toBeNull();
  });
});
