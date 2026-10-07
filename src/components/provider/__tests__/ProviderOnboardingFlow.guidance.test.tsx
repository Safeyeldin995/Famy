import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  search: {} as { section?: "review" },
  empty: [],
  provider: { id: "fixture-provider", onboarding_status: "DRAFT", profile: {} },
  snapshot: { exists: false },
}));
vi.mock("@tanstack/react-router", () => ({
  useSearch: () => mocks.search,
  useNavigate: () => vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/famio/LanguageToggle", () => ({ useLang: () => "en" }));
vi.mock("@/components/famio/ProviderPageHero", () => ({ ProviderPageHero: () => null }));
vi.mock("@/components/famio/ProviderFloatingPanel", () => ({
  ProviderFloatingPanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/famio/ui", () => ({
  PhoneFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  PrimaryButton: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/db/queries", () => ({ useAvatarUrl: () => ({ data: undefined }) }));
vi.mock("@/lib/db/provider-queries", () => ({
  useMyProvider: () => ({ data: mocks.provider }),
  useProviderDocuments: () => ({ data: mocks.empty }),
  useSetProviderPrice: () => ({}),
}));
vi.mock("@/lib/provider/onboarding-queries", () => ({
  onboardingEditable: () => true,
  useOnboardingSnapshot: () => ({ data: mocks.snapshot }),
  useSaveOnboardingSection: () => ({ mutateAsync: mocks.save }),
  useSubmitOnboarding: () => ({}),
  useSecureUploadDocument: () => ({}),
  usePhase1Services: () => ({ data: mocks.empty }),
  useActiveZones: () => ({ data: mocks.empty }),
  useMyReferences: () => ({ data: mocks.empty }),
  useMySavedSelections: () => ({ data: undefined }),
}));
vi.mock("@/components/provider/TeachingCapabilitiesEditor", () => ({
  TeachingCapabilitiesEditor: () => null,
}));

import { ProviderOnboardingFlow } from "../ProviderOnboardingFlow";

const originalScroll = Element.prototype.scrollIntoView;
beforeEach(() => {
  mocks.search = {};
  mocks.save.mockReset().mockRejectedValue(new Error("fixture validation failure"));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  Element.prototype.scrollIntoView = originalScroll;
});
it("hides inline hints on first visit and shows them after a failed Continue without clearing the draft", async () => {
  const { container } = render(<ProviderOnboardingFlow />);
  expect(container.querySelector('[id$="-hint"]')).toBeNull();
  fireEvent.change(container.querySelector("#legalName")!, { target: { value: "Draft name" } });
  fireEvent.click(screen.getByRole("button", { name: "common.continue" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(container.querySelector("#dob-hint")).not.toBeNull());
  expect(container.querySelector("#legalName-hint")).toBeNull();
  expect((container.querySelector("#legalName") as HTMLInputElement).value).toBe("Draft name");
});
it("keeps the review checklist visible before any attempt, and an item reveals its section hints", async () => {
  mocks.search = { section: "review" };
  const { container } = render(<ProviderOnboardingFlow />);
  expect(container.querySelector('[id$="-hint"]')).toBeNull();
  const items = screen.getAllByRole("button", {
    name: /pro.onboardingWizard.steps.personal: pro.onboardingWizard.guidance.completeField/,
  });
  expect(items.length).toBeGreaterThan(0);
  fireEvent.click(items[0]);
  await waitFor(() => expect(container.querySelector("#legalName-hint")).not.toBeNull());
});
