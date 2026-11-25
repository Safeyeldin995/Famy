import type { TFunction } from "i18next";

function readCodeMap(
  error: unknown,
  field: "completionErrors" | "sectionErrors",
): Record<string, string> {
  if (!error || typeof error !== "object" || !(field in error)) return {};
  const raw = (error as Record<string, unknown>)[field];
  if (!raw || typeof raw !== "object") return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function firstErrorCode(error: unknown): string | undefined {
  const merged = {
    ...readCodeMap(error, "completionErrors"),
    ...readCodeMap(error, "sectionErrors"),
  };
  const code = Object.values(merged)[0];
  return typeof code === "string" ? code : undefined;
}

/** Maps server onboarding validation codes to Egyptian Arabic / English copy. */
export function onboardingMutationErrorMessage(t: TFunction, error: unknown): string {
  const code = firstErrorCode(error);
  const generic = t("providerApply.saveError");
  if (!code) return generic;
  const key = `pro.onboardingWizard.errors.${code}`;
  const msg = t(key, { defaultValue: generic });
  return msg === key ? generic : msg;
}
