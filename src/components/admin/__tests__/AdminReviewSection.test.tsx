import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AdminReviewSection } from "../AdminReviewSection";

const state = vi.hoisted(() => ({ mutate: vi.fn(), checked: false }));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/db/admin-section-reviews", () => ({
  useAdminSectionReviews: () => ({
    data: state.checked
      ? [{ section: "references", decision: "approved", reviewed_at: "2026-10-13" }]
      : [],
    isLoading: false,
    isError: false,
  }),
  useAdminReviewSection: () => ({ mutate: state.mutate, isPending: false }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.checked = false;
});

it("marks and clears a private section check without a whole-application action", () => {
  const view = render(
    <AdminReviewSection providerId="provider" section="references" title="References" canReview>
      <p>Reference</p>
    </AdminReviewSection>,
  );
  fireEvent.click(screen.getByRole("button", { name: "adminReview.checkedChip" }));
  expect(state.mutate).toHaveBeenLastCalledWith(
    { providerId: "provider", section: "references", decision: "approved", reason: undefined },
    expect.any(Object),
  );
  state.checked = true;
  view.rerender(
    <AdminReviewSection providerId="provider" section="references" title="References" canReview>
      <p>Reference</p>
    </AdminReviewSection>,
  );
  expect(
    screen.getByRole("button", { name: "adminReview.checkedChip" }).getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "adminReview.checkedChip" }));
  expect(state.mutate).toHaveBeenLastCalledWith(
    { providerId: "provider", section: "references", decision: "clear", reason: undefined },
    expect.any(Object),
  );
  expect(screen.getAllByRole("button")).toHaveLength(2);
  expect(screen.queryByRole("button", { name: "adminReview.reject" })).toBeNull();
});
