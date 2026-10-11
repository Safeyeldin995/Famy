import { pendingHomeModel, type PendingHomeData } from "./pendingHomeModel";

export type SubmitCompletion = { ok: boolean; complete?: boolean; errors?: Record<string, string> };
export const applySteps = { basics: 1, services: 2, identity: 3 } as const;
export type ApplicationItem = keyof typeof applySteps;
const sectionRows: Record<string, string[]> = {
  personal: ["basics"],
  coverage: ["basics"],
  services: ["services"],
  documents: ["identity"],
  review: ["identity"],
  experience: ["about", "babysitting"],
  references: ["reference"],
  availability: ["hours"],
  teaching: ["subjects"],
};
export function submissionErrors(error: unknown): Record<string, string> {
  if (!error || typeof error !== "object" || !("completionErrors" in error)) return {};
  const errors = error.completionErrors;
  if (!errors || typeof errors !== "object") return {};
  return Object.fromEntries(
    Object.entries(errors).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}
export function changesHomeModel(
  data: PendingHomeData,
  completion?: SubmitCompletion,
  errors: Record<string, string> = {},
) {
  const missing = new Set(
    Object.keys(completion?.errors ?? {}).flatMap(
      (section) => sectionRows[section] ?? ["identity"],
    ),
  );
  const highlighted = new Set(
    Object.keys(errors).flatMap((section) => sectionRows[section] ?? ["identity"]),
  );
  return {
    canSubmit:
      completion?.ok === true && completion.complete === true && Object.keys(errors).length === 0,
    hintKey: "providerApply.missingIdentity",
    applicationItems: (Object.keys(applySteps) as ApplicationItem[]).map((key) => ({
      key,
      step: applySteps[key],
      done: completion?.ok === true && !missing.has(key),
      highlighted: missing.has(key) || highlighted.has(key),
    })),
    setupItems: pendingHomeModel(data).items.map((item) => ({
      ...item,
      highlighted: highlighted.has(item.key),
    })),
  };
}
export function applyStepSearch(search: Record<string, unknown>): { step?: 1 | 2 | 3 } {
  const value = search.step;
  return value === 1 || value === "1"
    ? { step: 1 }
    : value === 2 || value === "2"
      ? { step: 2 }
      : value === 3 || value === "3"
        ? { step: 3 }
        : {};
}
export function providerEntryRedirect(
  role: string | null | undefined,
  hasProvider: boolean,
  status: string | null | undefined,
  pathname: string,
) {
  if (pathname.startsWith("/pro/apply") || pathname.startsWith("/pro/onboarding")) return null;
  return (!hasProvider && role === "provider") || status === "DRAFT" ? "/pro/apply" : null;
}
