export const CATALOGUE_AGE_GROUP_CODES = [
  "newborn",
  "infant",
  "toddler",
  "preschool",
  "school_age",
  "teenager",
] as const;

export type CatalogueAgeGroupCode = (typeof CATALOGUE_AGE_GROUP_CODES)[number];

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

export function catalogueLabel(group: ChildAgeGroupRow, lang: "en" | "ar"): string {
  return (lang === "ar" ? group.name_ar : group.name_en) || group.code;
}
