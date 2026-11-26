// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OnlineWebNotificationsBell } from "../OnlineWebNotificationsBell";

const markAll = vi.fn();

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return { ...actual, useTranslation: () => ({ t: (k: string) => k, i18n: { language: "ar" } }) };
});
vi.mock("@/lib/i18n", () => ({ currentLang: () => "ar" }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
vi.mock("@/lib/db/queries", () => ({
  useUnreadNotificationCount: () => ({ data: 2 }),
  useNotifications: () => ({
    isLoading: false,
    isError: false,
    data: [
      { id: "n1", created_at: "2026-11-26T10:00:00Z", read_at: null, deep_link: null, title_ar: "طلبك اتبعت", body_ar: "" },
    ],
    refetch: vi.fn(),
  }),
  useMarkNotificationRead: () => ({ mutate: vi.fn() }),
  useMarkAllNotificationsRead: () => ({ mutate: markAll, isPending: false }),
}));
vi.mock("@/components/famio/customerNotifications", () => ({
  notificationText: (row: { title_ar?: string }) => ({ title: row.title_ar ?? "", body: "" }),
  formatCustomerNotificationTime: () => "10:00",
}));

function setViewport(small: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: small,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
}

describe("OnlineWebNotificationsBell", () => {
  beforeEach(() => {
    markAll.mockReset();
    document.body.style.overflow = "";
  });
  afterEach(() => cleanup());

  it("opens a full-width bottom sheet on small screens and locks page scroll", async () => {
    setViewport(true);
    render(<OnlineWebNotificationsBell />);
    await userEvent.click(screen.getByRole("button", { name: "onlineWeb.notifications.labelUnread" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("data-variant")).toBe("sheet");
    expect(dialog.className).toContain("fixed");
    expect(dialog.className).toContain("inset-x-0");
    expect(dialog.parentElement).toBe(document.body);
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByText("طلبك اتبعت")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "onlineWeb.notifications.markAll" }));
    expect(markAll).toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "common.close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("keeps the dropdown on desktop without locking scroll", async () => {
    setViewport(false);
    render(<OnlineWebNotificationsBell />);
    await userEvent.click(screen.getByRole("button", { name: "onlineWeb.notifications.labelUnread" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("data-variant")).toBe("dropdown");
    expect(dialog.className).toContain("absolute");
    expect(document.body.style.overflow).toBe("");
  });
});
