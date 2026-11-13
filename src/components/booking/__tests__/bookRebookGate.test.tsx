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
  useProviderServices: () =>
    query([
      {
        service: {
          id: "svc-hourly",
          pricing_model: "hourly",
          duration_min: 60,
          category: { slug: "babysitting" },
        },
      },
    ]),
  useAddresses: () =>
    query([
      { id: "addr-a", is_default: true, lat: 30, lng: 31 },
      { id: "addr-b", lat: 30.1, lng: 31.1 },
    ]),
  useBookableServiceIds: () => query(new Map([["svc-hourly", 100]])),
}));

vi.mock("@/lib/db/family-members-queries", () => ({
  useActiveFamilyMembers: () =>
    query([{ id: "child-1" }, { id: "child-2", full_name: "Child", date_of_birth: "2020-01-01" }]),
}));

vi.mock("@/lib/db/provider-queries", () => ({
  useRequirementsForService: () => query([]),
}));

vi.mock("@/lib/db/teaching-queries", () => ({
  useApprovedTeachingCapabilities: () => query([]),
}));

describe("BookRebookGate", () => {
  it("mounts rebook initial state when cached queries are already successful", () => {
    let captured: Record<string, unknown> | null = null;
    render(
      <BookRebookGate providerId="prov-1" rebookFrom="bid-1">
        {({ mountKey, rebookInitial }) => {
          captured = {
            mountKey,
            addressId: rebookInitial?.addressId,
            forWhom: rebookInitial?.forWhom,
            supervisionMode: rebookInitial?.supervisionMode,
            seeded: Array.from(rebookInitial?.seededFields ?? []),
          };
          return <div data-testid="form">ready</div>;
        }}
      </BookRebookGate>,
    );
    expect(screen.getByTestId("form")).toBeTruthy();
    expect(captured).toMatchObject({
      mountKey: "rebook-bid-1",
      addressId: "addr-b",
      forWhom: "child-1",
      supervisionMode: "adult_present",
    });
    expect(captured!.seeded).toEqual(
      expect.arrayContaining(["forWhom", "addressId", "supervisionMode"]),
    );
  });
});
