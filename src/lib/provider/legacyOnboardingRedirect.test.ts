import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { legacyOnboardingRedirect } from "./legacyOnboardingRedirect";
const sections = [
  "personal",
  "services",
  "experience",
  "coverage",
  "references",
  "review",
] as const;
it("routes new and draft providers to the matching minimal apply step", () => {
  for (const status of [undefined, "DRAFT"] as const) {
    expect(sections.map((section) => legacyOnboardingRedirect(status, section))).toEqual(
      [1, 2, 3, 1, 3, 3].map((step) => ({ to: "/pro/apply", step })),
    );
    expect(legacyOnboardingRedirect(status)).toEqual({ to: "/pro/apply", step: 1 });
  }
});
it("opens changes-requested identity and service corrections directly, keeping deferred screens accessible", () => {
  expect(legacyOnboardingRedirect("NEEDS_CHANGES", "review")).toEqual({
    to: "/pro/apply",
    step: 3,
  });
  expect(legacyOnboardingRedirect("NEEDS_CHANGES", "services")).toEqual({
    to: "/pro/apply",
    step: 2,
  });
  expect(legacyOnboardingRedirect("NEEDS_CHANGES", "references")).toEqual({
    to: "/pro/setup/$item",
    item: "reference",
  });
});
it("keeps submitted/approved providers out of apply and maps sections without reopening locked coverage", () => {
  for (const status of ["SUBMITTED", "UNDER_REVIEW", "APPROVED"] as const) {
    expect(sections.map((section) => legacyOnboardingRedirect(status, section))).toEqual([
      { to: "/pro/setup/$item", item: "personal" },
      { to: "/pro/profile" },
      { to: "/pro/setup/$item", item: "about" },
      { to: "/pro" },
      { to: "/pro/setup/$item", item: "reference" },
      { to: "/pro/documents" },
    ]);
  }
  for (const status of ["SUSPENDED", "REJECTED"] as const) {
    for (const section of sections)
      expect(legacyOnboardingRedirect(status, section)).toEqual({ to: "/pro" });
  }
});
it("the retired wizard is not rendered by live or preview account routes", () => {
  for (const route of [
    "pro.onboarding",
    "pro.documents",
    "preview.pro.onboarding",
    "preview.pro.documents",
  ]) {
    expect(readFileSync(`src/routes/${route}.tsx`, "utf8")).not.toContain("ProviderOnboardingFlow");
  }
});
