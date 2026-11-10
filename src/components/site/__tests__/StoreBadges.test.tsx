import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StoreBadges } from "../StoreBadges";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => (key === "site.download.comingSoon" ? "Coming soon on" : key),
  }),
}));

describe("StoreBadges", () => {
  it("renders coming-soon labels without store links", () => {
    vi.stubEnv("VITE_APP_STORE_URL", "https://apps.apple.com/famy");
    vi.stubEnv("VITE_PLAY_STORE_URL", "https://play.google.com/store/apps/famy");
    render(<StoreBadges />);
    expect(screen.getByLabelText("App Store — Coming soon on")).toBeTruthy();
    expect(screen.getByLabelText("Google Play — Coming soon on")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
