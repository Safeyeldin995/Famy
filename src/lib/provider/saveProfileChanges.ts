export type ProfileFields = {
  bio_ar?: string | null;
  bio_en?: string | null;
  years_experience?: number;
  city?: string | null;
  languages?: string[];
};
type SavedProfile = ProfileFields & { onboarding_status: string };
type ProfileSaveApi = {
  snapshot: () => Promise<{
    provider?: ProfileFields;
    details?: { previous_work?: string | null };
  }>;
  section: (section: "personal" | "experience", payload: Record<string, unknown>) => Promise<void>;
  update: (patch: ProfileFields) => Promise<void>;
};

export async function saveProfileChanges(
  saved: SavedProfile,
  edits: ProfileFields,
  api: ProfileSaveApi,
) {
  const patch = Object.fromEntries(
    Object.entries(edits).filter(
      ([key, value]) => JSON.stringify(value) !== JSON.stringify(saved[key as keyof ProfileFields]),
    ),
  ) as ProfileFields;
  if (!Object.keys(patch).length) return;
  if (saved.onboarding_status === "APPROVED" && ("city" in patch || "years_experience" in patch)) {
    throw new Error("Verified identity data cannot be changed without review.");
  }
  if (saved.onboarding_status === "SUBMITTED" || saved.onboarding_status === "UNDER_REVIEW") {
    const snapshot = await api.snapshot();
    if ("city" in patch) {
      await api.section("personal", { area: patch.city });
      delete patch.city;
    }
    if (Object.keys(patch).length) {
      // The experience RPC clears these two fields when omitted. Preserve the fresh saved values.
      await api.section("experience", {
        languages: snapshot.provider?.languages ?? [],
        previous_work: snapshot.details?.previous_work ?? "",
        ...patch,
      });
    }
  } else {
    await api.update(patch);
  }
}
