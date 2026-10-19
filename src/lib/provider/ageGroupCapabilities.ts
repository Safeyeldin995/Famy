export const CATALOGUE_AGE_GROUP_CODES = [
  "newborn",
  "infant",
  "toddler",
  "preschool",
  "school_age",
  "teenager",
] as const;

export type CatalogueAgeGroupCode = (typeof CATALOGUE_AGE_GROUP_CODES)[number];

export const AGE_GROUP_CHIP_IDS = ["infants", "toddlers", "kids", "teens"] as const;

export type AgeGroupChipId = (typeof AGE_GROUP_CHIP_IDS)[number];

/** UI chips map to one or more catalogue age-group codes saved in the DB. */
export const AGE_GROUP_CHIP_TO_CODES: Record<AgeGroupChipId, readonly CatalogueAgeGroupCode[]> = {
  infants: ["newborn", "infant"],
  toddlers: ["toddler"],
  kids: ["preschool", "school_age"],
  teens: ["teenager"],
};

export type AgeGroupCapabilityForm = {
  code: string;
  years_experience: number | null;
  note: string;
  verified: boolean;
};

export type AgeGroupCapabilitySnapshot = {
  code?: string | null;
  years_experience?: number | null;
  note?: string | null;
  verified_at?: string | null;
};

export type ChildAgeGroupRow = {
  code: string;
  name_en?: string | null;
  name_ar?: string | null;
  min_months?: number | null;
  max_months?: number | null;
  sort_order?: number | null;
};

const CODE_TO_CHIP = new Map<string, AgeGroupChipId>();
for (const chipId of AGE_GROUP_CHIP_IDS) {
  for (const code of AGE_GROUP_CHIP_TO_CODES[chipId]) {
    CODE_TO_CHIP.set(code, chipId);
  }
}

export function expandChipsToCatalogueCodes(chipIds: Iterable<string>): CatalogueAgeGroupCode[] {
  const out: CatalogueAgeGroupCode[] = [];
  const seen = new Set<string>();
  for (const chipId of chipIds) {
    const codes = AGE_GROUP_CHIP_TO_CODES[chipId as AgeGroupChipId];
    if (!codes) continue;
    for (const code of codes) {
      if (seen.has(code)) continue;
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}

export function hydrateChipIdsFromCapabilities(
  forms: AgeGroupCapabilityForm[],
): AgeGroupChipId[] {
  const chips = new Set<AgeGroupChipId>();
  for (const row of forms) {
    const chip = CODE_TO_CHIP.get(row.code);
    if (chip) chips.add(chip);
  }
  return AGE_GROUP_CHIP_IDS.filter((id) => chips.has(id));
}

export function chipHasVerifiedCode(
  chipId: AgeGroupChipId,
  forms: AgeGroupCapabilityForm[],
): boolean {
  const codes = AGE_GROUP_CHIP_TO_CODES[chipId];
  return forms.some((row) => codes.includes(row.code as CatalogueAgeGroupCode) && row.verified);
}

export function chipIsSelected(
  chipId: AgeGroupChipId,
  selectedChipIds: string[],
  forms: AgeGroupCapabilityForm[],
): boolean {
  return selectedChipIds.includes(chipId) || chipHasVerifiedCode(chipId, forms);
}

export function sharedBabysittingExperienceFromForms(
  forms: AgeGroupCapabilityForm[],
  chipIds: string[],
): { years: number | null; note: string } {
  const codes = new Set<string>(expandChipsToCatalogueCodes(chipIds));
  const relevant = forms.filter((row) => codes.has(row.code));
  const years =
    relevant.find((row) => typeof row.years_experience === "number")?.years_experience ?? null;
  const note = relevant.find((row) => row.note.trim())?.note ?? "";
  return { years, note };
}

export function mapCapabilitiesFromSnapshot(
  rows: AgeGroupCapabilitySnapshot[] | null | undefined,
): AgeGroupCapabilityForm[] {
  return (rows ?? [])
    .map((row) => {
      const code = (row.code ?? "").trim();
      if (!code) return null;
      return {
        code,
        years_experience:
          typeof row.years_experience === "number" && Number.isFinite(row.years_experience)
            ? row.years_experience
            : null,
        note: row.note ?? "",
        verified: Boolean(row.verified_at),
      };
    })
    .filter((row): row is AgeGroupCapabilityForm => Boolean(row));
}

export function buildAgeGroupCapabilitiesPayload(
  selectedCodes: string[],
  forms: AgeGroupCapabilityForm[],
): { code: string; years_experience: number | null; note: string | null }[] {
  const byCode = new Map(forms.map((row) => [row.code, row]));
  const seen = new Set<string>();
  const payload: { code: string; years_experience: number | null; note: string | null }[] = [];
  for (const code of selectedCodes) {
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const form = byCode.get(code);
    payload.push({
      code,
      years_experience: form?.years_experience ?? null,
      note: form?.note?.trim() ? form.note.trim() : null,
    });
  }
  return payload;
}

export function buildAgeGroupCapabilitiesPayloadFromChips(
  selectedChipIds: string[],
  capabilityForms: AgeGroupCapabilityForm[],
  yearsExperience: number | null,
  note: string,
): { code: string; years_experience: number | null; note: string | null }[] {
  const selectedCodes = expandChipsToCatalogueCodes(selectedChipIds);
  const verifiedCodes = capabilityForms.filter((row) => row.verified).map((row) => row.code);
  const allCodes = [...new Set([...selectedCodes, ...verifiedCodes])];
  const trimmedNote = note.trim();
  const formsForPayload = allCodes.map((code) => {
    const existing = capabilityForms.find((row) => row.code === code);
    return {
      code,
      years_experience: yearsExperience ?? existing?.years_experience ?? null,
      note: trimmedNote || existing?.note || "",
      verified: existing?.verified ?? false,
    };
  });
  return buildAgeGroupCapabilitiesPayload(allCodes, formsForPayload);
}

export function catalogueLabel(group: ChildAgeGroupRow, lang: "en" | "ar"): string {
  return (lang === "ar" ? group.name_ar : group.name_en) || group.code;
}
