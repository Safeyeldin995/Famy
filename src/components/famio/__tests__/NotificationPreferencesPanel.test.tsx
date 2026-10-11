import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  availability: "unsupported",
  subscribe: vi.fn(async () => ({ endpoint: "test-fixture" })),
  register: vi.fn(),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/db/queries", () => ({
  useNotificationPreferences: () => ({
    data: {
      booking_push: true,
      chat_push: true,
      reminder_push: true,
      support_push: true,
      campaign_push: false,
    },
  }),
  useUpdateNotificationPreferences: () => ({ mutate: mocks.mutate }),
  useMyPushSubscriptions: () => ({ data: [] }),
  useRegisterPushSubscription: () => ({ mutateAsync: mocks.register }),
  useRevokePushSubscriptionByEndpoint: () => ({}),
  useRevokePushSubscriptionById: () => ({}),
}));
vi.mock("@/lib/push", () => ({
  getPushAvailability: () => mocks.availability,
  subscribeToPush: mocks.subscribe,
  unsubscribeFromPush: vi.fn(),
}));
vi.mock("@/components/famio/ui", () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
import { NotificationPreferencesPanel } from "../NotificationPreferencesPanel";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.availability = "unsupported";
});
it("keeps category preferences editable with explicit states when push is unavailable", () => {
  render(<NotificationPreferencesPanel />);
  expect(screen.getByText("notifPrefs.pushUnsupported")).toBeTruthy();
  expect(screen.getAllByText("providerNotificationPolish.on")).toHaveLength(4);
  expect(screen.getAllByText("providerNotificationPolish.off")).toHaveLength(1);
  const booking = screen.getByRole("button", { name: "notifPrefs.bookingUpdates" });
  expect(booking.getAttribute("aria-pressed")).toBe("true");
  expect(booking.hasAttribute("disabled")).toBe(false);
  fireEvent.click(booking);
  expect(mocks.mutate).toHaveBeenCalledWith({ booking_push: false }, expect.any(Object));
});
it("enables supported push through the existing subscription and registration path", async () => {
  mocks.availability = "prompt";
  render(<NotificationPreferencesPanel />);
  expect(screen.getByText("providerNotificationPolish.enable")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "notifPrefs.enable" }));
  await vi.waitFor(() => expect(mocks.register).toHaveBeenCalledWith({ endpoint: "test-fixture" }));
});
