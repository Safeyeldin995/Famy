import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BookRebookGate } from "../BookRebookGate";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const query = <T,>(data: T, overrides: Record<string, unknown> = {}) => ({
  data,
  isSuccess: true,
  isLoading: false,
  isFetching: false,
  isError: false,
  refetch: vi.fn(),
  ...overrides,
});

vi.mock("@/lib/db/queries", () => ({
  useBooking: () =>
    query({
      provider_id: "prov-1",
      service_id: "svc-hourly",
      start_at: "2026-01-01T10:00:00Z",
      end_at: "2026-01-01T14:00:00Z",
      address_id: "addr-b",
      family_member_id: "child-1",
      supervision_mode: "adult_present",
      teaching_capability_id: null,
      session_duration_min: null,
      requirement_selections: null,
      notes: "",
    }),
  useProviderServices: () => query([], { isSuccess: false, isError: true }),
  useAddresses: () => query([{ id: "addr-a", is_default: true, lat: 30, lng: 31 }]),
  useBookableServiceIds: () => query(new Map()),
}));

vi.mock("@/lib/db/family-members-queries", () => ({
  useActiveFamilyMembers: () => query([]),
}));

vi.mock("@/lib/db/provider-queries", () => ({
  useRequirementsForService: () => query([]),
}));

vi.mock("@/lib/db/teaching-queries", () => ({
  useApprovedTeachingCapabilities: () => query([]),
}));

describe("BookRebookGate provider services error", () => {
  it("mounts a fresh booking form without the unavailable banner", () => {
    render(
      <BookRebookGate providerId="prov-1" rebookFrom="bid-1">
        {({ mountKey, rebookInitial }) => (
          <div data-testid="form">
            {mountKey}
            {rebookInitial ? "prefill" : "fresh"}
          </div>
        )}
      </BookRebookGate>,
    );
    expect(screen.queryByText("bookFlow.rebookSourceUnavailable")).toBeNull();
    expect(screen.queryByText("pro.common.loading")).toBeNull();
    expect(screen.getByTestId("form").textContent).toBe("new-bookingfresh");
  });
});
