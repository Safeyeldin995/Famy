import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TeachingCapabilityReviewQueue } from "../TeachingCapabilityReviewQueue";

const mocks = vi.hoisted(() => ({ group: vi.fn() }));
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
      isError: false,
      data: [
        { ...row, id: "first", level_id: "g4", level_code: "grade-4", level_name_en: "Grade 4" },
        { ...row, id: "second", level_id: "g5", level_code: "grade-5", level_name_en: "Grade 5" },
        { ...row, id: "third", level_id: "g6", level_code: "grade-6", level_name_en: "Grade 6", session_price: 400 },
      ],
    }),
  };
});

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

it("reviews one subject group at a time, not one row per grade", () => {
  render(<TeachingCapabilityReviewQueue providerId="provider" />);
  expect(screen.getAllByRole("button", { name: "adminReview.approve" })).toHaveLength(2);
  expect(screen.queryByRole("button", { name: "teaching.status.suspended" })).toBeNull();

  fireEvent.change(screen.getAllByLabelText("adminReview.reason")[0], {
    target: { value: "Synthetic review note" },
  });
  fireEvent.click(screen.getAllByRole("button", { name: "adminReview.approve" })[0]);
  expect(mocks.group).toHaveBeenCalledWith(
    { ids: ["first", "second"], status: "approved", note: "Synthetic review note" },
    expect.any(Object),
  );
});

it("requires a reason to reject exactly the selected group", () => {
  render(<TeachingCapabilityReviewQueue providerId="provider" />);
  const reject = screen.getAllByRole("button", { name: "adminReview.reject" })[1];
  expect((reject as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getAllByLabelText("adminReview.reason")[1], {
    target: { value: "Missing evidence" },
  });
  fireEvent.click(reject);
  expect(mocks.group).toHaveBeenCalledWith(
    { ids: ["third"], status: "rejected", note: "Missing evidence" },
    expect.any(Object),
  );
});
