export type OnboardingReference = {
  full_name: string;
  relationship: string;
  phone: string;
  notes: string;
};

export function isReferenceComplete(ref: OnboardingReference): boolean {
  return Boolean(ref.full_name.trim() && ref.relationship.trim() && ref.phone.trim());
}

export function isReferenceEmpty(ref: OnboardingReference): boolean {
  return ![ref.full_name, ref.relationship, ref.phone, ref.notes].some((value) => value.trim());
}

export function buildReferencesPayload(
  ref1: OnboardingReference,
  ref2: OnboardingReference,
): { ok: true; references: OnboardingReference[] } | { ok: false; error: "ref1" | "ref2" } {
  if (!isReferenceComplete(ref1)) return { ok: false, error: "ref1" };
  if (isReferenceEmpty(ref2)) return { ok: true, references: [ref1] };
  if (!isReferenceComplete(ref2)) return { ok: false, error: "ref2" };
  return { ok: true, references: [ref1, ref2] };
}
