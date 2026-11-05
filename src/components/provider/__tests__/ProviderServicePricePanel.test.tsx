import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createInstance, type i18n as I18n } from "i18next";
import en from "@/lib/i18n/locales/en";
import { ProviderServicePricePanel } from "@/components/provider/ProviderServicePricePanel";

let i18n: I18n;
beforeAll(async () => {
  i18n = createInstance();
  await i18n.init({ lng: "en", resources: { en: { translation: en } } });
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (...args: Parameters<I18n["t"]>) => i18n.t(...args), i18n }),
}));

describe("ProviderServicePricePanel", () => {
  it("shows request button for approved provider services", () => {
    render(
      <ProviderServicePricePanel
        serviceId="svc"
        onboardingStatus="APPROVED"
        serviceStatus="approved"
        min={100}
        max={1000}
        livePrice={300}
        pendingPrice={null}
        rejectionReason={null}
        draft={350}
        unitLabel="EGP"
        onDraftChange={() => {}}
        onSaveDirect={() => {}}
        onRequestChange={() => {}}
        onCancelRequest={() => {}}
        savePending={false}
        cancelPending={false}
      />,
    );
    expect(screen.getByRole("button", { name: en.pro.profile.requestPriceChange })).toBeTruthy();
  });

  it("shows pending copy and cancel when a request is open", () => {
    render(
      <ProviderServicePricePanel
        serviceId="svc"
        onboardingStatus="APPROVED"
        serviceStatus="approved"
        min={100}
        max={1000}
        livePrice={300}
        pendingPrice={350}
        rejectionReason={null}
        draft={350}
        unitLabel="EGP"
        onDraftChange={() => {}}
        onSaveDirect={() => {}}
        onRequestChange={() => {}}
        onCancelRequest={() => {}}
        savePending={false}
        cancelPending={false}
      />,
    );
    expect(screen.getByText(/350 EGP/)).toBeTruthy();
    expect(screen.getByRole("button", { name: en.pro.profile.cancelPriceChange })).toBeTruthy();
  });
});
