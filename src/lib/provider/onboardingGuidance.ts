import { isReferenceEmpty, type OnboardingReference } from "./onboardingReferences";

export const guidanceTargets = {
  legalName: ["personal", "legalName"],
  dob: ["personal", "dob"],
  governorate: ["personal", "governorate"],
  area: ["personal", "area"],
  address: ["personal", "address"],
  photo: ["personal", "uploadPhoto"],
  phone: ["personal", "phone"],
  services: ["services", "steps.services"],
  prices: ["services", "steps.services"],
  bio: ["experience", "guidance.bio"],
  years: ["experience", "guidance.years"],
  maxChildren: ["experience", "maxChildren"],
  ageGroups: ["experience", "childAgeGroups"],
  coverage: ["coverage", "steps.coverage"],
  "reference-0-refName": ["references", "refName"],
  "reference-0-refRelationship": ["references", "refRelationship"],
  "reference-0-refPhone": ["references", "refPhone"],
  "reference-1-refName": ["references", "refName"],
  "reference-1-refRelationship": ["references", "refRelationship"],
  "reference-1-refPhone": ["references", "refPhone"],
  idFront: ["review", "idFront"],
  idBack: ["review", "idBack"],
  confirmed: ["review", "accuracyConfirm"],
  review: ["review", "reviewTitle"],
} as const;
export type GuidanceField = keyof typeof guidanceTargets;
export type MissingItem = { field: GuidanceField; section: string; label: string; error?: string };
export function guidanceItem(field: GuidanceField, error?: string): MissingItem {
  const [section, label] = guidanceTargets[field];
  return { field, section, label, ...(error ? { error } : {}) };
}

export function localOnboardingMissing(draft: {
  legalName: string;
  dob: string;
  governorate: string;
  area: string;
  address: string;
  photo: boolean;
  services: boolean;
  prices: boolean;
  bioEn: string;
  bioAr: string;
  years: number;
  babysitting: boolean;
  maxChildren: number | "";
  ageGroups: number;
  coverage: boolean;
  references: OnboardingReference[];
  idFront: boolean;
  idBack: boolean;
  confirmed: boolean;
}): MissingItem[] {
  const fields: GuidanceField[] = [];
  for (const field of ["legalName", "dob", "governorate", "area", "address"] as const) {
    if (!draft[field].trim()) fields.push(field);
  }
  if (!draft.photo) fields.push("photo");
  if (!draft.services) fields.push("services");
  else if (!draft.prices) fields.push("prices");
  if (!draft.bioEn.trim() && !draft.bioAr.trim()) fields.push("bio");
  if (draft.years < 0) fields.push("years");
  if (draft.babysitting && draft.maxChildren === "") fields.push("maxChildren");
  if (draft.babysitting && !draft.ageGroups) fields.push("ageGroups");
  if (!draft.coverage) fields.push("coverage");
  draft.references.forEach((ref, index) => {
    if (index > 1 || (index === 1 && isReferenceEmpty(ref))) return;
    for (const [key, suffix] of [
      ["full_name", "refName"],
      ["relationship", "refRelationship"],
      ["phone", "refPhone"],
    ] as const) {
      if (!ref[key].trim()) fields.push(`reference-${index as 0 | 1}-${suffix}`);
    }
  });
  if (!draft.idFront) fields.push("idFront");
  if (!draft.idBack) fields.push("idBack");
  if (!draft.confirmed) fields.push("confirmed");
  return fields.map((field) => guidanceItem(field));
}

const serverFields: Record<string, GuidanceField> = {
  legal_name_required: "legalName",
  phone_required: "phone",
  personal_details_incomplete: "dob",
  profile_photo_required: "photo",
  service_required: "services",
  experience_incomplete: "bio",
  babysitting_details_required: "maxChildren",
  zone_required: "coverage",
  reference_required: "reference-0-refName",
  two_references_required: "reference-1-refName",
  duplicate_reference_phones: "reference-1-refPhone",
  national_id_required: "idFront",
  accuracy_confirmation_required: "confirmed",
};
export function onboardingMissingItems(
  local: MissingItem[],
  errors: Record<string, string>,
): MissingItem[] {
  const result = [...local];
  for (const [section, error] of Object.entries(errors)) {
    const fallback = serverFields[error] ?? (section === "coverage" ? "coverage" : "review");
    // Prefer the exact missing field over a server error covering several fields.
    const broadFields: Record<string, GuidanceField[]> = {
      personal_details_incomplete: ["dob", "governorate", "area", "address"],
      experience_incomplete: ["bio", "years"],
      babysitting_details_required: ["maxChildren", "ageGroups"],
      reference_required: [
        "reference-0-refName",
        "reference-0-refRelationship",
        "reference-0-refPhone",
      ],
      national_id_required: ["idFront", "idBack"],
    };
    const existing = result.find((item) => broadFields[error]?.includes(item.field));
    const field = existing?.field ?? fallback;
    if (!result.some((item) => item.field === field)) result.push(guidanceItem(field, error));
  }
  return result;
}
