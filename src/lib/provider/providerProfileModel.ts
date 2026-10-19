export function profileBioPayload(
  language: string,
  bio: string,
  saved: { bio_ar: string | null; bio_en: string | null },
) {
  return language === "ar"
    ? { bio_ar: bio, bio_en: saved.bio_en }
    : { bio_en: bio, bio_ar: saved.bio_ar };
}
