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
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));
import { NotificationPreferencesPanel } from "../NotificationPreferencesPanel";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.availability = "unsupported";
});
it.each(["unsupported", "unconfigured", "denied"])(
  "shows only the in-app card when provider push is %s",
  (availability) => {
    mocks.availability = availability;
    render(<NotificationPreferencesPanel providerMode />);
    expect(screen.getByText("providerPushUnavailable.title")).toBeTruthy();
    expect(screen.getByText("providerPushUnavailable.body")).toBeTruthy();
    const link = screen.getByRole("link", { name: "providerPushUnavailable.open" });
    expect(link.getAttribute("href")).toBe("/pro/notifications");
    expect(link.className).toContain("min-h-11");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByText("providerNotificationPolish.off")).toBeNull();
  },
);
it.each(["default", "granted"])(
  "keeps explicit preference states and the existing mutation when provider push is %s",
  (availability) => {
    mocks.availability = availability;
    render(<NotificationPreferencesPanel providerMode />);
    expect(screen.getAllByText("providerNotificationPolish.on")).toHaveLength(4);
    expect(screen.getAllByText("providerNotificationPolish.off")).toHaveLength(1);
    const booking = screen.getByRole("button", { name: "notifPrefs.bookingUpdates" });
    expect(booking.getAttribute("aria-pressed")).toBe("true");
    expect(booking.hasAttribute("disabled")).toBe(false);
    fireEvent.click(booking);
    expect(mocks.mutate).toHaveBeenCalledWith({ booking_push: false }, expect.any(Object));
  },
);
it("leaves the shared customer panel unchanged", () => {
  render(<NotificationPreferencesPanel />);
  expect(screen.getByText("notifPrefs.pushUnsupported")).toBeTruthy();
  expect(screen.getByRole("button", { name: "notifPrefs.bookingUpdates" })).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
});
it("enables supported push through the existing subscription and registration path", async () => {
  mocks.availability = "default";
  render(<NotificationPreferencesPanel providerMode />);
  expect(screen.getByText("providerNotificationPolish.enable")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "notifPrefs.enable" }));
  await vi.waitFor(() => expect(mocks.register).toHaveBeenCalledWith({ endpoint: "test-fixture" }));
});
