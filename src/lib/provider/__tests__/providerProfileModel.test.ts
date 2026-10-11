import { expect, it } from "vitest";
import { profileBioPayload } from "../providerProfileModel";
it("changes only the current language bio, preserving the other saved value", () => {
  const saved = { bio_ar: "نبذة محفوظة", bio_en: "Saved bio" };
  expect(profileBioPayload("ar", "نبذة جديدة", saved)).toEqual({
    bio_ar: "نبذة جديدة",
    bio_en: "Saved bio",
  });
  expect(profileBioPayload("en", "New bio", saved)).toEqual({
    bio_ar: "نبذة محفوظة",
    bio_en: "New bio",
  });
  expect(profileBioPayload("ar", "نبذة", { ...saved, bio_en: null })).toEqual({
    bio_ar: "نبذة",
    bio_en: null,
  });
});
