import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ProviderRescheduleSection } from "../ProviderRescheduleSection";
const state = vi.hoisted(() => ({ rows: [] as { status: string }[] }));
vi.mock("@/lib/db/queries", () => ({ useRescheduleRequests: () => ({ data: state.rows }) }));
vi.mock("@/components/famio/RescheduleSection", () => ({
  RescheduleSection: ({ viewer, compact }: { viewer: string; compact: boolean }) => (
    <div>
      {viewer} {compact ? "compact" : "full"} reschedule actions
    </div>
  ),
}));
afterEach(cleanup);
const props = {
  bookingId: "test",
  customerId: "customer",
  status: "confirmed",
  currentStart: "2026-10-14T12:00:00Z",
  currentEnd: "2026-10-14T14:00:00Z",
};
it.each([[], [{ status: "accepted" }], [{ status: "rejected" }], [{ status: "cancelled" }]])(
  "hides the entire reschedule block without an open request: %j",
  (...rows) => {
    state.rows = rows as { status: string }[];
    const { container } = render(<ProviderRescheduleSection {...props} />);
    expect(container.innerHTML).toBe("");
  },
);
it("keeps the existing provider actions for a pending request", () => {
  state.rows = [{ status: "accepted" }, { status: "pending" }];
  render(<ProviderRescheduleSection {...props} />);
  expect(screen.getByText("provider compact reschedule actions")).toBeTruthy();
});
