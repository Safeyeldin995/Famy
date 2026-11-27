import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const state = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "rtl" } }),
}));
vi.mock("sonner", () => ({ toast: { success: state.toast, error: vi.fn() } }));
vi.mock("@/lib/db/family-members-queries", () => ({
  useCreateFamilyMember: () => ({ mutateAsync: state.mutateAsync, isPending: false }),
}));
vi.mock("@/components/famio/FamilyMemberForm", () => ({
  emptyFamilyMemberFormValue: () => ({ fullName: "" }),
  familyMemberFormValueToInput: (v: unknown) => v,
  FamilyMemberForm: ({ onSubmit, submitLabel }: { onSubmit: () => void; submitLabel: string }) => (
    <button type="button" onClick={onSubmit}>
      {submitLabel}
    </button>
  ),
}));

import { AddChildSheet } from "../AddChildSheet";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AddChildSheet («ضيف ابن» in place)", () => {
  it("saves the child and hands the new id back instead of navigating away", async () => {
    state.mutateAsync.mockResolvedValue({
      id: "child-new",
      education_curriculum_id: null,
      education_level_id: null,
    });
    const onCreated = vi.fn();
    render(<AddChildSheet onClose={vi.fn()} onCreated={onCreated} />);

    expect(screen.getByText("studentMatch.addChild")).toBeTruthy();
    fireEvent.click(screen.getByText("common.save"));

    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith({
        id: "child-new",
        education_curriculum_id: null,
        education_level_id: null,
      }),
    );
    expect(state.toast).toHaveBeenCalledWith("familyMembers.saved");
  });

  it("keeps the sheet open with a clear error when saving fails", async () => {
    state.mutateAsync.mockRejectedValue(new Error("boom"));
    const onCreated = vi.fn();
    render(<AddChildSheet onClose={vi.fn()} onCreated={onCreated} />);

    fireEvent.click(screen.getByText("common.save"));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
