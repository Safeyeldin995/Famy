import { expect, it, vi } from "vitest";
import { saveProfileChanges } from "../saveProfileChanges";
import { providerProfileSaveErrorKey } from "../providerProfileSaveErrors";
const saved = {
  bio_ar: "قديم",
  bio_en: "Existing English",
  city: "Cairo",
  years_experience: 4,
  languages: ["ar"],
};
const api = () => ({
  snapshot: vi.fn().mockResolvedValue({
    provider: { ...saved, languages: ["ar", "en"] },
    details: { previous_work: "Existing work" },
  }),
  section: vi.fn().mockResolvedValue(undefined),
  update: vi.fn().mockResolvedValue(undefined),
});
it.each(["SUBMITTED", "UNDER_REVIEW"])(
  "saves a bio via experience while %s and preserves unrelated data",
  async (onboarding_status) => {
    const calls = api();
    await saveProfileChanges(
      { ...saved, onboarding_status },
      { bio_ar: "جديد", city: saved.city, years_experience: saved.years_experience },
      calls,
    );
    expect(calls.update).not.toHaveBeenCalled();
    expect(calls.section).toHaveBeenCalledExactlyOnceWith("experience", {
      bio_ar: "جديد",
      languages: ["ar", "en"],
      previous_work: "Existing work",
    });
  },
);
it("approved bio saves omit unchanged identity fields and the other language", async () => {
  const calls = api();
  await saveProfileChanges(
    { ...saved, onboarding_status: "APPROVED" },
    { bio_en: "New English", city: saved.city, years_experience: 4 },
    calls,
  );
  expect(calls.update).toHaveBeenCalledExactlyOnceWith({ bio_en: "New English" });
  expect(calls.section).not.toHaveBeenCalled();
});
it.each([{ city: "Giza" }, { years_experience: 5 }])(
  "blocks approved identity changes before writing",
  async (edits) => {
    const calls = api();
    await expect(
      saveProfileChanges({ ...saved, onboarding_status: "APPROVED" }, edits, calls),
    ).rejects.toThrow("Verified identity");
    expect(calls.update).not.toHaveBeenCalled();
    expect(calls.section).not.toHaveBeenCalled();
  },
);
it("does not save unchanged fields", async () => {
  const calls = api();
  await saveProfileChanges({ ...saved, onboarding_status: "APPROVED" }, saved, calls);
  expect(calls.update).not.toHaveBeenCalled();
});
it("saves edited languages without clearing work history", async () => {
  const calls = api();
  await saveProfileChanges(
    { ...saved, onboarding_status: "UNDER_REVIEW" },
    { languages: ["en"] },
    calls,
  );
  expect(calls.section).toHaveBeenCalledExactlyOnceWith("experience", {
    languages: ["en"],
    previous_work: "Existing work",
  });
});
it("maps known review and identity rules to specific copy", () => {
  expect(providerProfileSaveErrorKey("Provider application is read-only while under review.")).toBe(
    "providerProfileFix.reviewLocked",
  );
  expect(
    providerProfileSaveErrorKey("Verified identity data cannot be changed without review."),
  ).toBe("pro.profile.verifiedIdentityLocked");
});
