import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StoreBadges } from "../StoreBadges";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => (key === "site.download.downloadOn" ? "Download on" : key),
  }),
}));

vi.mock("@/lib/db/settings-queries", () => ({
  useStoreLinksSettings: () => ({
    data: { play_url: "https://play.google.com/store/apps/details?id=com.famy.app", app_store_url: "" },
  }),
}));

describe("StoreBadges", () => {
  it("renders store links when configured and hides empty badges", () => {
    render(<StoreBadges />);
    expect(screen.getByLabelText("Google Play — Download on")).toBeTruthy();
    expect(screen.queryByLabelText(/App Store/)).toBeNull();
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toContain("play.google.com");
  });

});