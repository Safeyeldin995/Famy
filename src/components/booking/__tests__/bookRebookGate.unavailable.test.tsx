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
  useBooking: () => query(null),
  useProviderServices: () => query([]),
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

describe("BookRebookGate unavailable source", () => {
  it("shows a message and mounts a fresh booking form", () => {
    render(
      <BookRebookGate providerId="prov-1" rebookFrom="missing-bid">
        {({ mountKey }) => <div data-testid="form">{mountKey}</div>}
      </BookRebookGate>,
    );
    expect(screen.getByText("bookFlow.rebookSourceUnavailable")).toBeTruthy();
    expect(screen.getByTestId("form").textContent).toBe("new-booking");
  });
});
