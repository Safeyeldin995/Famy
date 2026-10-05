import type { ReactNode, ButtonHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import en from "@/lib/i18n/locales/en";
import ar from "@/lib/i18n/locales/ar";

const state = vi.hoisted(() => ({
  lang: "en",
  zones: [{ zone_id: "zone" }],
  zonesError: false,
  rows: [
    {
      service_id: "school",
      service_name_en: "School subjects",
      service_name_ar: "المواد الدراسية",
      is_eligible: false,
      failure_reasons: [
        "No approved teaching subject with a valid session price",
        "Active Provider and Service zone coverage is missing",
      ],
    },
    {
      service_id: "language",
      service_name_en: "Language tutoring",
      service_name_ar: "تعليم اللغات",
      is_eligible: false,
      failure_reasons: [
        "No approved teaching subject with a valid session price",
        "Active Provider and Service zone coverage is missing",
      ],
    },
  ],
}));
const translations = createInstance();
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translations.t.bind(translations) }),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => vi.fn(),
  Link: ({ to, hash, children }: { to: string; hash?: string; children: ReactNode }) => (
    <a href={`${to}${hash ? `#${hash}` : ""}`}>{children}</a>
  ),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/components/famio/ProviderShell", () => ({
  ProviderShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/famio/ProviderPageHero", () => ({ ProviderPageHero: () => null }));
vi.mock("@/components/famio/LanguageToggle", () => ({
  LanguageToggle: () => null,
  useLang: () => state.lang,
}));
vi.mock("@/components/famio/ui", () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PrimaryButton: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  Avatar: () => null,
}));
vi.mock("@/components/famio/QueryError", () => ({ QueryError: () => <div>Query error</div> }));
vi.mock("@/components/provider/TeachingCapabilitiesEditor", () => ({
  TeachingCapabilitiesEditor: () => <h2>Teaching subjects</h2>,
}));
vi.mock("@/lib/preview/previewPath", () => ({
  proPath: (path: string) => path,
  customerPath: (path: string) => path,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/db/settings-queries", () => ({ useServiceAreasSettings: () => ({ data: [] }) }));
vi.mock("@/lib/db/provider-queries", () => ({
  useMyProvider: () => ({ data: { id: "provider", onboarding_status: "APPROVED", profile: {} } }),
  useMyMarketplaceEligibility: () => ({ data: state.rows, isSuccess: true }),
  useMyProviderZones: () => ({
    data: state.zones,
    isSuccess: !state.zonesError,
    isError: state.zonesError,
  }),
  useUpdateProvider: () => ({ mutate: vi.fn() }),
  useAllServices: () => ({ data: [] }),
  useMyProviderServices: () => ({ data: [] }),
  useToggleProviderService: () => ({ mutate: vi.fn() }),
  useSetProviderPrice: () => ({ mutate: vi.fn() }),
}));

import { Route } from "../pro.profile";
const Profile = Route.options.component!;

beforeEach(async () => {
  state.lang = "en";
  state.zones = [{ zone_id: "zone" }];
  state.zonesError = false;
  for (const row of state.rows) row.is_eligible = false;
  await translations.init({
    lng: "en",
    resources: { en: { translation: en }, ar: { translation: ar } },
    interpolation: { escapeValue: false },
  });
});
afterEach(cleanup);

describe("provider profile grouped eligibility card", () => {
  it.each(["en", "ar"])(
    "shows unique problems, localized services, status and a closed detail section in %s",
    async (lang) => {
      state.lang = lang;
      await translations.changeLanguage(lang);
      render(<Profile />);
      const priceText = translations.t("pro.profile.eligibilityReasons.teachingPrice");
      expect(screen.getAllByText(priceText)).toHaveLength(1);
      expect(screen.getByRole("link", { name: priceText }).getAttribute("href")).toBe(
        "/pro/profile#teaching-subjects",
      );
      expect(document.getElementById("teaching-subjects")).not.toBeNull();
      for (const name of lang === "ar"
        ? ["المواد الدراسية", "تعليم اللغات"]
        : ["School subjects", "Language tutoring"]) {
        expect(screen.getByRole("button", { name })).not.toBeNull();
        expect(screen.getAllByText(name)).toHaveLength(2);
      }
      const zoneText = translations.t("pro.profile.eligibilityReasons.zoneUnavailable");
      expect(screen.getAllByText(zoneText)).toHaveLength(1);
      expect(screen.queryByRole("link", { name: zoneText })).toBeNull();
      expect(
        screen.getByText(translations.t("pro.profile.notVisibleToCustomers", { count: 2 })),
      ).not.toBeNull();
      const details = screen.getByRole("button", {
        name: translations.t("pro.profile.eligibilityByService"),
      });
      expect(details.getAttribute("aria-expanded")).toBe("false");
      fireEvent.click(details);
      expect(details.getAttribute("aria-expanded")).toBe("true");
      expect(
        screen.getByText(lang === "ar" ? "المواد الدراسية" : "School subjects", {
          selector: "div.font-bold",
        }),
      ).not.toBeNull();
    },
  );

  it("links to onboarding only when zone_providers is empty", () => {
    state.zones = [];
    render(<Profile />);
    expect(
      screen.getByRole("link", { name: "Choose your service area" }).getAttribute("href"),
    ).toBe("/pro/onboarding");
  });

  it("does not offer an onboarding fix when coverage cannot be loaded", () => {
    state.zonesError = true;
    render(<Profile />);
    expect(screen.getByText("Query error")).not.toBeNull();
    expect(screen.queryByRole("link", { name: "Choose your service area" })).toBeNull();
  });

  it("shows a green visible status when a service is eligible", () => {
    state.rows[0]!.is_eligible = true;
    render(<Profile />);
    const status = screen.getByText("Visible to customers");
    expect(status.className).toContain("text-success");
  });
});
