import type { OnboardingStatus } from "./onboarding-queries";
import type { OnboardingTarget } from "./onboardingSection";

type Destination =
  | { to: "/pro/apply"; step: 1 | 2 | 3 }
  | { to: "/pro/setup/$item"; item: "about" | "reference" | "personal" }
  | { to: "/pro" | "/pro/profile" | "/pro/documents" };

/** Legacy links must not send submitted/approved providers to the draft-only apply flow. */
export function legacyOnboardingRedirect(
  status: OnboardingStatus | undefined,
  section?: OnboardingTarget,
): Destination {
  if (!status || status === "DRAFT") {
    // Deferred items are completed after the minimal application; the parent route
    // deliberately prevents DRAFT providers from entering setup screens.
    return {
      to: "/pro/apply",
      step:
        section === "services"
          ? 2
          : section === "review" || section === "experience" || section === "references"
            ? 3
            : 1,
    };
  }
  if (status === "NEEDS_CHANGES" && section !== "experience" && section !== "references") {
    return { to: "/pro/apply", step: section === "services" ? 2 : section === "review" ? 3 : 1 };
  }
  if (status === "REJECTED" || status === "SUSPENDED") return { to: "/pro" };
  switch (section) {
    case "experience":
      return { to: "/pro/setup/$item", item: "about" };
    case "references":
      return { to: "/pro/setup/$item", item: "reference" };
    case "personal":
      return { to: "/pro/setup/$item", item: "personal" };
    // Coverage selection is locked after submission. Return to the status home
    // instead of opening an unrelated field or the inaccessible apply flow.
    case "coverage":
      return { to: "/pro" };
    case "services":
      return { to: "/pro/profile" };
    case "review":
      return { to: "/pro/documents" };
    default:
      return { to: "/pro" };
  }
}
