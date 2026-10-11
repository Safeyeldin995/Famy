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
  services: [] as { id: string; name_en: string; name_ar: string; provider_pricing_allowed: boolean }[],
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
  useTranslation: () => ({ t: translations.t.bind(translations), i18n: translations }),
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
vi.mock("@/lib/db/teaching-queries", () => ({ useMyTeachingCapabilities: () => ({ data: [] }) }));
vi.mock("@/lib/preview/previewPath", () => ({
  proPath: (path: string) => path,
  customerPath: (path: string) => path,
}));
vi.mock("@/lib/db/queries", () => ({ useAvatarUrl: () => ({ data: null }) }));
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
  useProviderAvailability: () => ({ data: [] }),
  useUpdateProvider: () => ({ mutate: vi.fn() }),
  useAllServices: () => ({ data: state.services }),
  useMyProviderServices: () => ({ data: state.services.map((service) => ({ service_id: service.id, status: "approved" })) }),
  useToggleProviderService: () => ({ mutate: vi.fn() }),
  useSetProviderPrice: () => ({ mutate: vi.fn() }),
  useRequirementsForService: () => ({ data: [{ id: "req", name_en: "Synthetic requirement" }] }),
  useMyRequirementFulfillments: () => ({ data: [] }),
  useDeclareRequirement: () => ({ mutate: vi.fn() }),
  useUploadRequirementEvidence: () => ({ mutate: vi.fn() }),
}));

import { Route } from "../pro.profile";
const Profile = Route.options.component!;

beforeEach(async () => {
  state.lang = "en";
  state.zones = [{ zone_id: "zone" }];
  state.zonesError = false;
  state.services = [];
  for (const row of state.rows) {
    row.is_eligible = false;
    row.failure_reasons = ["No approved teaching subject with a valid session price", "Active Provider and Service zone coverage is missing"];
  }
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
      expect(screen.getByRole("link", { name: new RegExp(priceText) }).getAttribute("href")).toBe(
        "/pro/setup/subjects",
      );
      expect(document.getElementById("teaching-subjects")).not.toBeNull();
      for (const name of lang === "ar"
        ? ["المواد الدراسية", "تعليم اللغات"]
        : ["School subjects", "Language tutoring"]) {
        expect(screen.queryByRole("button", { name })).toBeNull();
        expect(screen.getAllByText(name)).toHaveLength(2);
      }
      const zoneText = translations.t("pro.profile.eligibilityReasons.zoneUnavailable");
      expect(screen.getAllByText(zoneText)).toHaveLength(1);
      expect(screen.queryByRole("link", { name: new RegExp(zoneText) })).toBeNull();
      const waitingRow = screen.getByText(zoneText).closest(".apply-li");
      expect(waitingRow?.textContent).toContain(translations.t("providerApply.pending.waiting"));
      expect(waitingRow?.querySelector("a, button")).toBeNull();
      expect(
        screen.getByText(translations.t("providerProfileV3.hidden")),
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

  it("shows coverage review as a Famy item without linking to the old wizard", () => {
    state.zones = [];
    render(<Profile />);
    expect(screen.getByText("The Famy team will review your service areas")).not.toBeNull();
    expect(document.querySelector('a[href="/pro/onboarding"]')).toBeNull();
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

it.each(["en", "ar"])("keeps provider requirement actions visible alongside mixed service visibility in %s", async (lang) => {
  state.lang = lang;
  await translations.changeLanguage(lang);
  state.rows[0].is_eligible = true;
  state.rows[0].failure_reasons = [];
  state.rows[1].failure_reasons = ["Complete babysitting requirements in profile"];
  state.services = [{ id:"language",name_en:"Language tutoring",name_ar:"تعليم اللغات",provider_pricing_allowed:false }];
  render(<Profile />);
  expect(screen.getByText(translations.t("providerProfileV3.visible"))).toBeTruthy();
  expect(screen.getByText(translations.t("providerProfileV3.visibleServices", {services:lang === "ar" ? "المواد الدراسية" : "School subjects"}))).toBeTruthy();
  expect(screen.getByText(translations.t("providerProfileV3.blockedServices", {services:lang === "ar" ? "تعليم اللغات" : "Language tutoring"}))).toBeTruthy();
  expect(screen.getByRole("heading", {name:translations.t("providerProfileV3.providerTasks")})).toBeTruthy();
  expect(screen.queryByRole("heading", {name:translations.t("providerProfileV3.famyTasks")})).toBeNull();
  const action = screen.getByRole("link", {name:new RegExp(translations.t("pro.profile.eligibilityReasons.requirementsIncomplete"))});
  expect(action.getAttribute("href")).toBe("/pro/profile#requirements-language");
  const row = document.getElementById("service-language");
  if (!row) throw new Error("Expected service row");
  const scroll = vi.fn();
  row.scrollIntoView = scroll;
  fireEvent.click(action);
  expect(scroll).toHaveBeenCalled();
  expect(document.getElementById("requirements-language")).not.toBeNull();
  expect(screen.getByText("Synthetic requirement")).toBeTruthy();
});

it("keeps every service-specific requirement action reachable from its whole row", () => {
  for (const row of state.rows) row.failure_reasons = ["Complete service requirements"];
  state.services = state.rows.map((row) => ({ id: row.service_id, name_en: row.service_name_en, name_ar: row.service_name_ar, provider_pricing_allowed: false }));
  render(<Profile />);
  for (const service of state.services) {
    const action = screen.getByRole("link", { name: new RegExp(`${service.name_en}.*${translations.t("providerApply.pending.start")}`) });
    expect(action.getAttribute("href")).toBe(`/pro/profile#requirements-${service.id}`);
    const row = document.getElementById(`service-${service.id}`);
    if (!row) throw new Error("Expected service row");
    const scroll = vi.fn();
    row.scrollIntoView = scroll;
    fireEvent.click(action);
    expect(scroll).toHaveBeenCalledOnce();
    expect(document.getElementById(`requirements-${service.id}`)).not.toBeNull();
  }
});
