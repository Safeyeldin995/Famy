import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode, ComponentType } from "react";
import i18n from "@/lib/i18n";
import { Route } from "../pro.earnings";
const state = vi.hoisted(() => ({ snapshotted: false, mixed: false }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: i18n.getFixedT("ar") }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("@/components/famio/ProviderShell", () => ({
  ProviderShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/famio/PageHeader", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("@/components/provider/ProfileAvatar", () => ({ ProfileAvatar: () => null }));
vi.mock("@/components/famio/LanguageToggle", () => ({ useLang: () => "ar" }));
vi.mock("@/lib/db/provider-queries", () => ({
  useMyProvider: () => ({ data: { id: "provider" } }),
  useProviderEarnings: () => ({
    data: {
      captured: { net: 80, bookingValue: 100 },
      mtd: { net: state.mixed ? 80 : 0, bookingValue: 100 },
      last7: { net: 0, bookingValue: 100 },
      upcoming: { net: 0, bookingValue: 50 },
      hasSnapshottedCaptured: state.snapshotted || state.mixed,
      hasUnsnapshottedCaptured: !state.snapshotted,
      hasUnsnapshottedUpcoming: !state.snapshotted,
      completedCount: 1,
    },
  }),
  useProviderBookings: () => ({
    data: [
      {
        id: "booking",
        status: "completed",
        start_at: "2026-10-14T12:00:00Z",
        price_subtotal: 100,
        price_provider_net: state.snapshotted ? 80 : null,
        price_platform_fee: state.snapshotted ? 20 : null,
        commission_rate: state.snapshotted ? 0.2 : null,
        customer: { full_name: "سارة" },
      },
    ],
  }),
}));
afterEach(() => {
  cleanup();
  state.snapshotted = false;
  state.mixed = false;
});
const Page = Route.options.component as ComponentType;
it("shows the page caption and summary note once, with the booking-specific note only on its row", () => {
  render(<Page />);
  expect(screen.getAllByText(i18n.t("pro.earnings.bookingValue", { lng: "ar" }))).toHaveLength(1);
  expect(screen.getAllByText("المبالغ دي قيمة الحجوزات قبل عمولة فامي")).toHaveLength(1);
  const note = screen.getByText(i18n.t("pro.earnings.commissionUnrecorded", { lng: "ar" }));
  expect(note.parentElement?.textContent).toContain("سارة");
});
it("keeps mixed amounts distinguishable", () => {
  state.mixed = true;
  render(<Page />);
  expect(screen.getAllByText(/قبل العمولة/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(i18n.t("pro.earnings.yourNet", { lng: "ar" })).length).toBeGreaterThan(
    0,
  );
});
it("does not show an unrecorded commission note for a snapshotted booking", () => {
  state.snapshotted = true;
  render(<Page />);
  expect(screen.queryByText(i18n.t("pro.earnings.commissionUnrecorded", { lng: "ar" }))).toBeNull();
  expect(screen.queryByText("المبالغ دي قيمة الحجوزات قبل عمولة فامي")).toBeNull();
});
