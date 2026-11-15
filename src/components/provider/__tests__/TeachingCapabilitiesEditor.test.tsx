import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const levels = vi.hoisted(() => [
  { id: "lvl-g9", code: "g9", name_en: "Grade 9", name_ar: "G9", is_active: true, sort_order: 9 },
  { id: "lvl-g10", code: "g10", name_en: "Grade 10", name_ar: "G10", is_active: true, sort_order: 10 },
  { id: "lvl-g11", code: "g11", name_en: "Grade 11", name_ar: "G11", is_active: true, sort_order: 11 },
  { id: "lvl-g12", code: "g12", name_en: "Grade 12", name_ar: "G12", is_active: true, sort_order: 12 },
]);

const curricula = vi.hoisted(() => [
  {
    id: "cur-british",
    code: "british",
    name_en: "British",
    name_ar: "British",
    is_active: true,
    sort_order: 1,
  },
  {
    id: "cur-eg",
    code: "eg_national_ar",
    name_en: "Egyptian",
    name_ar: "Egyptian",
    is_active: true,
    sort_order: 2,
  },
]);

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/i18n", () => ({
  currentLang: () => "en",
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) => {
      if (key === "teaching.level") return "Level";
      if (key === "teaching.whatITeach") return "What I teach";
      if (key === "teaching.editResetsApproval") return "Edit note";
      if (key === "teaching.subject") return "Subject";
      if (key === "teaching.curriculum") return "Curriculum";
      if (key === "teaching.britishLevelHint") return "British hint";
      if (key === "teaching.addCapability") return "Add";
      if (key === "teaching.pricePlaceholder") return "Price";
      if (key === "teaching.priceRange") return "Range";
      if (key === "common.min") return "min";
      return vars?.level ?? key;
    },
  }),
}));

vi.mock("@/lib/db/teaching-queries", () => ({
  useMyTeachingCapabilities: () => ({ data: [] }),
  useRemoveTeachingCapability: () => ({ mutate: vi.fn() }),
  useTeachingCurricula: () => ({ data: curricula }),
  useTeachingLevels: () => ({ data: levels }),
  useTeachingSubjectServices: () => ({ data: [] }),
  useTeachingSubjects: () => ({ data: [] }),
  useUpsertTeachingCapability: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { TeachingCapabilitiesEditor } from "@/components/provider/TeachingCapabilitiesEditor";

describe("TeachingCapabilitiesEditor", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders British curriculum levels g10–g12 without an update loop", () => {
    const { rerender } = render(
      <TeachingCapabilitiesEditor
        providerId="prov-1"
        services={[
          {
            id: "svc-1",
            name_en: "Tutoring",
            allowed_session_durations: [60, 120],
            minimum_price: 300,
            maximum_price: 1500,
          },
        ]}
      />,
    );

    const curriculumSelect = screen.getAllByRole("combobox")[2];
    fireEvent.change(curriculumSelect, { target: { value: "cur-british" } });

    expect(screen.getByRole("button", { name: "Grade 10" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Grade 11" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Grade 12" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Grade 9" })).toBeNull();

    rerender(
      <TeachingCapabilitiesEditor
        providerId="prov-1"
        services={[
          {
            id: "svc-1",
            name_en: "Tutoring",
            allowed_session_durations: [60, 120],
            minimum_price: 300,
            maximum_price: 1500,
          },
        ]}
      />,
    );
    rerender(
      <TeachingCapabilitiesEditor
        providerId="prov-1"
        services={[
          {
            id: "svc-1",
            name_en: "Tutoring",
            allowed_session_durations: [60, 120],
            minimum_price: 300,
            maximum_price: 1500,
          },
        ]}
      />,
    );

    expect(screen.getAllByRole("button", { name: "Grade 10" }).length).toBeGreaterThan(0);
  });
});
