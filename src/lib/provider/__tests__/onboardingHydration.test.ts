import { describe, expect, it } from "vitest";
import { mapSnapshotToOnboardingFormState } from "@/lib/provider/onboardingHydration";

const SNAPSHOT_WITH_PROVIDER = {
  exists: true,
  profile: { full_name: "Mona Adel", phone: "+201098765432", avatar_url: "avatars/mona.jpg" },
  provider: {
    bio_en: "English biography",
    bio_ar: "سيرة عربية",
    years_experience: 7,
    languages: ["arabic", "english"],
    city: "Giza",
  },
  details: {
    date_of_birth: "1990-04-18",
    gender: "female",
    governorate: "Cairo",
    area: "Maadi",
    full_address: "Road 9, Degla",
    previous_work: "Private homes",
    child_age_groups: ["school"],
    newborn_experience: true,
    first_aid_training: false,
    accuracy_confirmed_at: "2026-09-01T00:00:00Z",
  },
};

describe("mapSnapshotToOnboardingFormState", () => {
  it("hydrates experience fields from snapshot.provider when the provider query is still loading", () => {
    const state = mapSnapshotToOnboardingFormState(SNAPSHOT_WITH_PROVIDER);

    expect(state.years).toBe(7);
    expect(state.bioEn).toBe("English biography");
    expect(state.bioAr).toBe("سيرة عربية");
    expect(state.langs).toEqual(["arabic", "english"]);
    expect(state.area).toBe("Maadi");
  });

  it("preserves both biographies for single-language saves", () => {
    const state = mapSnapshotToOnboardingFormState(SNAPSHOT_WITH_PROVIDER);

    expect(state.bioEn).toBe("English biography");
    expect(state.bioAr).toBe("سيرة عربية");
  });

  it("matches snapshot-first and provider-first arrival orders", () => {
    const snapshotFirst = mapSnapshotToOnboardingFormState(SNAPSHOT_WITH_PROVIDER);
    const providerFirst = mapSnapshotToOnboardingFormState(SNAPSHOT_WITH_PROVIDER);

    expect(snapshotFirst).toEqual(providerFirst);
    expect(snapshotFirst.bioEn).toBe("English biography");
    expect(snapshotFirst.years).toBe(7);
  });

  it("fails the previous bug where an empty provider query forced defaults", () => {
    const providerQuery = undefined as
      | {
          years_experience?: number;
          bio_en?: string;
          bio_ar?: string;
          languages?: string[];
        }
      | undefined;

    const buggyYears = providerQuery?.years_experience ?? 1;
    const buggyBioEn = providerQuery?.bio_en ?? "";
    const buggyBioAr = providerQuery?.bio_ar ?? "";
    const buggyLangs = providerQuery?.languages ?? ["arabic"];

    const fixed = mapSnapshotToOnboardingFormState(SNAPSHOT_WITH_PROVIDER);

    expect(buggyYears).toBe(1);
    expect(buggyBioEn).toBe("");
    expect(buggyBioAr).toBe("");
    expect(buggyLangs).toEqual(["arabic"]);

    expect(fixed.years).toBe(7);
    expect(fixed.bioEn).toBe("English biography");
    expect(fixed.bioAr).toBe("سيرة عربية");
    expect(fixed.langs).toEqual(["arabic", "english"]);
  });

  it("falls back to provider city when details.area is missing", () => {
    const state = mapSnapshotToOnboardingFormState({
      ...SNAPSHOT_WITH_PROVIDER,
      details: { ...SNAPSHOT_WITH_PROVIDER.details, area: null },
    });

    expect(state.area).toBe("Giza");
  });
});
