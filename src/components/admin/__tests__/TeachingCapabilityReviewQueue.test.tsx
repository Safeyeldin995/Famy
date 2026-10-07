import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TeachingCapabilityReviewQueue } from "../TeachingCapabilityReviewQueue";
const mocks = vi.hoisted(() => ({ group: vi.fn(), single: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/i18n", () => ({ currentLang: () => "en" }));
vi.mock("@/lib/db/teaching-group-queries", () => ({
  useAdminReviewTeachingGroup: () => ({ mutate: mocks.group, isPending: false }),
}));
vi.mock("@/lib/db/teaching-queries", () => {
  const row = {
    provider_id: "provider",
    service_id: "service",
    subject_id: "subject",
    curriculum_id: "curriculum",
    session_duration_min: 60,
    session_price: 300,
    status: "pending",
    subject_name_en: "Math",
    curriculum_name_en: "Egyptian",
    review_note: null,
  };
  return {
    useAdminTeachingCapabilities: () => ({
      isLoading: false,
      data: [
        { ...row, id: "first", level_id: "g4", level_name_en: "Grade 4" },
        { ...row, id: "second", level_id: "g5", level_name_en: "Grade 5" },
        { ...row, id: "third", level_id: "g6", level_name_en: "Grade 6", session_price: 400 },
      ],
    }),
    useAdminReviewTeachingCapability: () => ({ mutate: mocks.single, isPending: false }),
  };
});
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());
it("reviews only the ids in the selected group, with one shared note", () => {
  render(<TeachingCapabilityReviewQueue providerId="provider" />);
  expect(screen.getAllByText("providerSetup.reviewLevels")).toHaveLength(2);
  fireEvent.change(screen.getAllByLabelText("teaching.adminNote")[0], {
    target: { value: "Synthetic review note" },
  });
  fireEvent.click(screen.getAllByRole("button", { name: "teaching.status.approved" })[0]);
  expect(mocks.group).toHaveBeenCalledWith(
    { ids: ["first", "second"], status: "approved", note: "Synthetic review note" },
    expect.any(Object),
  );
  const secondGroup = screen.getAllByText("providerSetup.reviewLevels")[1].closest("li")!;
  fireEvent.click(
    within(secondGroup).getAllByRole("button", { name: "teaching.status.rejected" })[0],
  );
  expect(mocks.group).toHaveBeenLastCalledWith(
    { ids: ["third"], status: "rejected", note: undefined },
    expect.any(Object),
  );
  expect(mocks.single).not.toHaveBeenCalled();
});
it("keeps per-level review inside a closed expandable section", () => {
  render(<TeachingCapabilityReviewQueue providerId="provider" />);
  const summary = screen.getAllByText("providerSetup.reviewLevels")[0];
  const details = summary.closest("details")!;
  expect(details.open).toBe(false);
  fireEvent.click(summary);
  expect(details.open).toBe(true);
  fireEvent.click(within(details).getAllByRole("button", { name: "teaching.status.suspended" })[0]);
  expect(mocks.single).toHaveBeenCalledWith(
    { id: "first", status: "suspended", note: undefined },
    expect.any(Object),
  );
  expect(mocks.group).not.toHaveBeenCalled();
});
