import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GroupedTeachingSetup } from "../GroupedTeachingSetup";
import { ProviderSetupForm } from "../ProviderSetupForm";
import type { ProviderTeachingCapabilityRow } from "@/lib/db/teaching-queries";
const language = vi.hoisted(() => ({ current: "en" }));
vi.mock("react-i18next", async () => {
  const { default: ar } = await import("@/lib/i18n/locales/ar");
  const { default: en } = await import("@/lib/i18n/locales/en");
  return {
    useTranslation: () => ({
      t: (key: string, options?: { lng?: string }) => {
        if (!key.startsWith("providerSetup.relationships.")) return key;
        const labels = (options?.lng ?? language.current) === "ar" ? ar : en;
        return labels.providerSetup.relationships[
          key.split(".")[2] as keyof typeof labels.providerSetup.relationships
        ];
      },
      i18n: { language: language.current, dir: () => (language.current === "ar" ? "rtl" : "ltr") },
    }),
  };
});
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
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="" />
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  ),
}));
vi.mock("@/components/famio/PriceStepper", () => ({
  PriceStepper: ({ value, disabled }: { value: number | null; disabled?: boolean }) => (
    <input aria-label="price" value={value ?? ""} disabled={disabled} readOnly />
  ),
}));
afterEach(() => {
  cleanup();
  language.current = "en";
});
const taxonomy = {
  code: "synthetic",
  name_en: "Synthetic",
  name_ar: "اختبار",
  is_active: true,
  sort_order: 0,
};
const props = {
  services: [
    {
      id: "service",
      name_en: "Tutoring",
      name_ar: "تدريس",
      minimum_price: 100,
      maximum_price: 500,
      allowed_session_durations: [60, 90],
    },
  ],
  subjects: [{ ...taxonomy, id: "subject", max_session_duration_min: 120 }],
  curricula: [{ ...taxonomy, id: "curriculum" }],
  levels: [
    { ...taxonomy, id: "grade", name_en: "Grade" },
    { ...taxonomy, id: "other", name_en: "Other grade" },
  ],
  links: [{ subject_id: "subject", service_id: "service" }],
  onSave: vi.fn().mockResolvedValue(undefined),
  onRemove: vi.fn(),
  onBack: vi.fn(),
};
const approved: ProviderTeachingCapabilityRow = {
  id: "approved",
  provider_id: "provider",
  service_id: "service",
  subject_id: "subject",
  curriculum_id: "curriculum",
  level_id: "grade",
  session_duration_min: 90,
  session_price: 300,
  status: "approved",
  submitted_at: "2026-10-08",
};
it("shows a grade prerequisite hint and a non-interactive single duration", () => {
  render(
    <GroupedTeachingSetup
      {...props}
      services={[{ ...props.services[0], allowed_session_durations: [60] }]}
      rows={[]}
    />,
  );
  expect(screen.getByText("providerSetup.chooseSubjectFirst")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Grade" })).toBeNull();
  expect(screen.getByText("60 common.min").tagName).toBe("SPAN");
  fireEvent.change(screen.getByLabelText("teaching.subject"), { target: { value: "subject" } });
  fireEvent.change(screen.getByLabelText("teaching.curriculum"), {
    target: { value: "curriculum" },
  });
  expect(screen.queryByText("providerSetup.chooseSubjectFirst")).toBeNull();
  expect(screen.getByRole("button", { name: "Grade" })).toBeTruthy();
});
it("locks approved group price and duration while adding a grade", async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<GroupedTeachingSetup {...props} onSave={onSave} rows={[approved]} />);
  fireEvent.click(screen.getByRole("button", { name: "common.edit" }));
  expect((screen.getByLabelText("price") as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText("price") as HTMLInputElement).value).toBe("300");
  for (const duration of [60, 90])
    expect(
      (screen.getByRole("button", { name: `${duration} common.min` }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  expect(screen.getByRole("button", { name: "90 common.min" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(screen.getByText("providerSetup.approvedPriceLocked")).toBeTruthy();
  expect(screen.getByText("providerSetup.status.approved").className).toContain("apply-success");
  fireEvent.click(screen.getByRole("button", { name: "Other grade" }));
  fireEvent.click(screen.getByRole("button", { name: "providerSetup.saveSubject" }));
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionDurationMin: 90,
        sessionPrice: 300,
        levelIds: ["grade", "other"],
      }),
    ),
  );
});
it("shares one hours pair across selected days, including midnight, until Save", async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <ProviderSetupForm
      item="hours"
      snapshot={{}}
      rules={[0, 3].map((weekday) => ({ weekday, start_time: "18:00", end_time: "24:00" }))}
      onSave={onSave}
      onBack={() => {}}
    />,
  );
  const toggle = screen.getByRole("checkbox", {
    name: "providerSetup.sameHours",
  }) as HTMLInputElement;
  expect(toggle.checked).toBe(true);
  expect(screen.getAllByLabelText("pro.schedule.start")).toHaveLength(1);
  fireEvent.change(screen.getByLabelText("pro.schedule.start"), { target: { value: "19:00" } });
  fireEvent.click(screen.getByRole("button", { name: "pro.schedule.days.fri" }));
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.click(toggle);
  expect(screen.getAllByLabelText("pro.schedule.start")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "providerSetup.save" }));
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith({
      rules: [0, 3, 5].map((weekday) => ({ weekday, start_time: "19:00", end_time: "24:00" })),
    }),
  );
});
it("keeps different saved hours in per-day mode", () => {
  render(
    <ProviderSetupForm
      item="hours"
      snapshot={{}}
      rules={[
        { weekday: 0, start_time: "09:00", end_time: "17:00" },
        { weekday: 3, start_time: "18:00", end_time: "24:00" },
      ]}
      onSave={vi.fn()}
      onBack={() => {}}
    />,
  );
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  expect(
    screen.getAllByLabelText("pro.schedule.start").map((node) => (node as HTMLSelectElement).value),
  ).toEqual(["09:00", "18:00"]);
});

it.each(["ar", "en"])("saves the Arabic relationship label in the %s interface", async (lang) => {
  language.current = lang;
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <ProviderSetupForm
      item="reference"
      snapshot={{}}
      references={[
        {
          full_name: "Synthetic reference",
          phone: "synthetic-contact",
          relationship: "",
          notes: "",
        },
      ]}
      onSave={onSave}
      onBack={() => {}}
    />,
  );
  const option = screen.getByRole("option", {
    name: lang === "ar" ? "عميل سابق" : "Former client",
  }) as HTMLOptionElement;
  expect(option.value).toBe("عميل سابق");
  fireEvent.change(screen.getByLabelText("pro.onboardingWizard.refRelationship"), {
    target: { value: option.value },
  });
  fireEvent.click(screen.getByRole("button", { name: "providerSetup.save" }));
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith({
      references: [{ index: 0, value: { relationship: "عميل سابق" } }],
    }),
  );
});
it("keeps a legacy free-text relationship selectable and unchanged", async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <ProviderSetupForm
      item="reference"
      snapshot={{}}
      references={[
        {
          full_name: "Synthetic reference",
          phone: "synthetic-contact",
          relationship: "زميل من شغل قديم",
          notes: "",
        },
      ]}
      onSave={onSave}
      onBack={() => {}}
    />,
  );
  expect(
    (screen.getByLabelText("pro.onboardingWizard.refRelationship") as HTMLSelectElement).value,
  ).toBe("زميل من شغل قديم");
  fireEvent.change(screen.getByLabelText("pro.onboardingWizard.refName"), {
    target: { value: "Updated synthetic reference" },
  });
  fireEvent.click(screen.getByRole("button", { name: "providerSetup.save" }));
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith({
      references: [{ index: 0, value: { full_name: "Updated synthetic reference" } }],
    }),
  );
});
