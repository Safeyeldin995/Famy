import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StoreBadges } from "../StoreBadges";

const useStoreLinksSettings = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => (key === "site.download.downloadOn" ? "Download on" : key),
  }),
}));

vi.mock("@/lib/db/settings-queries", () => ({
  useStoreLinksSettings: () => useStoreLinksSettings(),
}));

afterEach(() => {
  cleanup();
  useStoreLinksSettings.mockReset();
});

describe("StoreBadges", () => {
  it("renders linked badges when store URLs are set", () => {
    useStoreLinksSettings.mockReturnValue({
      data: {
        play_url: "https://play.google.com/store/apps/details?id=com.famy.app",
        app_store_url: "https://apps.apple.com/app/id123",
      },
    });
    render(<StoreBadges />);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getByLabelText("Google Play — Download on")).toBeTruthy();
    expect(screen.getByLabelText("App Store — Download on")).toBeTruthy();
  });

  it("shows coming-soon badges when URLs are unset", () => {
    useStoreLinksSettings.mockReturnValue({ data: { play_url: "", app_store_url: "" } });
    render(<StoreBadges />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByLabelText("Google Play — site.download.comingSoon")).toBeTruthy();
    expect(screen.getByLabelText("App Store — site.download.comingSoon")).toBeTruthy();
  });
});