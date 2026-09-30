import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  FamilyMemberForm,
  emptyFamilyMemberFormValue,
  validateFamilyMemberFormValue,
} from "@/components/famio/FamilyMemberForm";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/components/famio/ui", () => ({
  PrimaryButton: ({
    children,
    onClick,
    disabled,
    "data-testid": dataTestId,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    "data-testid"?: string;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled} data-testid={dataTestId}>
      {children}
    </button>
  ),
}));

function toArabicIndic(western: string): string {
  return western.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
}

function FormHarness({ onSubmit }: { onSubmit: () => void }) {
  const [value, setValue] = useState(emptyFamilyMemberFormValue());
  return (
    <FamilyMemberForm
      value={value}
      onChange={setValue}
      onSubmit={onSubmit}
      submitting={false}
      submitLabel="Save"
    />
  );
}

describe("FamilyMemberForm", () => {
  afterEach(() => cleanup());

  const today = "2026-09-30";

  it("blocks submit and shows required messaging for an empty form", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<FormHarness onSubmit={onSubmit} />);
    await user.click(screen.getByTestId("family-member-save"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByText("validation.required").length).toBeGreaterThan(0);
  });

  it("calls onSubmit when minimal valid data uses Arabic-Indic phone digits", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<FormHarness onSubmit={onSubmit} />);

    await user.type(screen.getByPlaceholderText("e.g. Layla Ahmed"), "Layla Ahmed");
    await user.click(screen.getByRole("button", { name: "familyMembers.relationships.daughter" }));
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    await user.type(dateInput, "2020-04-01");
    await user.type(
      screen.getAllByPlaceholderText("01xxxxxxxxx")[0],
      toArabicIndic("0101221000633"),
    );

    const value = {
      ...emptyFamilyMemberFormValue(),
      fullName: "Layla Ahmed",
      relationship: "daughter" as const,
      dateOfBirth: "2020-04-01",
      phone: toArabicIndic("0101221000633"),
    };
    expect(validateFamilyMemberFormValue(value, today).valid).toBe(true);

    await user.click(screen.getByTestId("family-member-save"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("shows emergency phone required before invalid-phone when name is set without phone", async () => {
    const user = userEvent.setup();
    render(
      <FamilyMemberForm
        value={{
          ...emptyFamilyMemberFormValue(),
          fullName: "Layla",
          relationship: "daughter",
          dateOfBirth: "2020-04-01",
          emergencyContactName: "Mona",
        }}
        onChange={() => {}}
        onSubmit={() => {}}
        submitting={false}
        submitLabel="Save"
      />,
    );
    await user.click(screen.getByTestId("family-member-save"));
    expect(
      screen.getByText("Emergency contact phone is required when a name is provided"),
    ).toBeTruthy();
    expect(screen.queryByText("validation.invalidPhone")).toBeNull();
  });
});
