import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import ar from "@/lib/i18n/locales/ar";
import { ProviderRequestCard } from "../ProviderRequestCard";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: any) => <a>{children}</a>,
  useRouterState: () => true,
}));
vi.mock("@/lib/db/settings-queries", () => ({ useBookingExpirySettings: () => ({}) }));
vi.mock("../BookingRequestActions", () => ({
  BookingRequestActions: ({ id }: any) => <div data-testid="actions">{id}</div>,
}));
afterEach(cleanup);
it("shows party-safe customer, area, child age, service, time, price and reply countdown", async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "ar", resources: { ar: { translation: ar } } });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nextProvider i18n={i18n}>
        <ProviderRequestCard
          booking={{
            id: "request",
            start_at: "2026-09-02T14:00:00Z",
            created_at: "2026-09-01T09:30:00Z",
            price_total: 540,
            customer: { full_name: "سارة" },
            service: { name_ar: "جليسة أطفال" },
            party: {
              zone_name_ar: "الشيخ زايد",
              member_first_name: "آدم",
              member_age_years: 5,
            } as any,
          }}
        />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  expect(screen.getByText("سارة")).toBeTruthy();
  expect(screen.getByText(/الشيخ زايد.*آدم.*5/)).toBeTruthy();
  expect(screen.getByText("جليسة أطفال")).toBeTruthy();
  expect(screen.getByText("540 ج.م")).toBeTruthy();
  expect(screen.getByTestId("actions").textContent).toBe("request");
  expect(await screen.findByTestId("respond-within")).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/[٠-٩]/);
});
