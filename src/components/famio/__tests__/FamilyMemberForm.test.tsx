import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CustomerBirthDateField } from "../CustomerBirthDateField";
import { customerDayKey, customerYesterdayKey } from "../customerDates";
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

vi.mock("@/components/famio/EducationProfileFields", () => ({
  EducationProfileFields: () => null,
  educationValueFromIds: () => ({ educationCurriculumId: "", educationLevelId: "" }),
  educationIdsFromValue: () => ({
    education_curriculum_id: null,
    education_level_id: null,
  }),
}));

vi.mock("@/components/famio/BottomSheetSelect", () => ({
  BottomSheetSelect: ({
    label,
    value,
    options,
    onChange,
  }: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
  }) => (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="" />
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
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
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const today = "2026-09-30";

  it("requires explicit guardian consent before saving health notes", () => {
    const onSubmit = vi.fn();
    const base = {
      ...emptyFamilyMemberFormValue(),
      fullName: "Test",
      relationship: "son",
      dateOfBirth: "2020-01-01",
      allergies: "Peanuts",
    };
    render(
      <FamilyMemberForm
        value={base as ReturnType<typeof emptyFamilyMemberFormValue>}
        onChange={() => {}}
        onSubmit={onSubmit}
        submitting={false}
        submitLabel="Save"
      />,
    );
    fireEvent.click(screen.getByTestId("family-member-save"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("familyMembers.healthConsentRequired")).toBeTruthy();
    fireEvent.click(screen.getByTestId("family-member-health-consent"));
    fireEvent.click(screen.getByTestId("family-member-save"));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("does not ask for health consent when no health notes are entered", () => {
    render(<FormHarness onSubmit={() => {}} />);
    expect(screen.queryByTestId("family-member-health-consent")).toBeNull();
  });

  it("uses Cairo today in both the picker and form validation on a UTC phone", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2025-12-31T22:30:00Z"));
    expect(customerDayKey()).toBe("2026-01-01");
    expect(customerYesterdayKey()).toBe("2025-12-31");
    const onSubmit = vi.fn();
    render(
      <FamilyMemberForm
        value={{
          ...emptyFamilyMemberFormValue(),
          fullName: "Test",
          relationship: "son",
          dateOfBirth: "2026-01-01",
        }}
        onChange={() => {}}
        onSubmit={onSubmit}
        submitting={false}
        submitLabel="Save"
      />,
    );
    expect((screen.getByRole("combobox", { name: "Year" }) as HTMLSelectElement).value).toBe(
      "2026",
    );
    expect(
      (screen.getByRole("combobox", { name: "Day" }) as HTMLSelectElement).options.length,
    ).toBe(2);
    fireEvent.click(screen.getByTestId("family-member-save"));
    expect(onSubmit).toHaveBeenCalledOnce();
    for (const dateOfBirth of ["2026-01-02", "2020--", "2020-02-", "2025-02-29"]) {
      expect(
        validateFamilyMemberFormValue(
          {
            ...emptyFamilyMemberFormValue(),
            dateOfBirth,
          },
          customerDayKey(),
        ).dobValid,
      ).toBe(false);
    }
  });

  it("clears a partial or complete birthday when the parent resets it", () => {
    function BirthdayHarness() {
      const [value, setValue] = useState("");
      return (
        <>
          <CustomerBirthDateField value={value} onChange={setValue} />
          <button onClick={() => setValue("")}>Reset</button>
        </>
      );
    }
    render(<BirthdayHarness />);
    const year = screen.getByRole("combobox", { name: "Year" });
    const month = screen.getByRole("combobox", { name: "Month" });
    const day = screen.getByRole("combobox", { name: "Day" });
    fireEvent.change(year, { target: { value: "2020" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect((year as HTMLSelectElement).value).toBe("");
    fireEvent.change(year, { target: { value: "2020" } });
    fireEvent.change(month, { target: { value: "04" } });
    fireEvent.change(day, { target: { value: "01" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    for (const select of [year, month, day]) expect((select as HTMLSelectElement).value).toBe("");
  });

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
    expect(document.querySelector('input[type="date"]')).toBeNull();
    await user.selectOptions(screen.getByRole("combobox", { name: "Year" }), "2020");
    await user.selectOptions(screen.getByRole("combobox", { name: "Month" }), "04");
    await user.selectOptions(screen.getByRole("combobox", { name: "Day" }), "01");
    expect(screen.getByRole("button", { name: "familyMembers.genders.male" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "familyMembers.genders.female" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "familyMembers.genders.other" })).toBeNull();
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
