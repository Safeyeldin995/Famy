import { describe, expect, it } from "vitest";
import {
  buildCoverageSavePayload,
  mapSavedReferences,
  mapSavedServiceIds,
  mapSavedZoneIds,
  mapSnapshotToOnboardingFormState,
} from "@/lib/provider/onboardingHydration";

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

  it("does not map services, zones, or references from the snapshot", () => {
    const state = mapSnapshotToOnboardingFormState(SNAPSHOT_WITH_PROVIDER);
    expect(state).not.toHaveProperty("selectedServices");
    expect(state).not.toHaveProperty("selectedZones");
    expect(state).not.toHaveProperty("ref1");
    expect(state).not.toHaveProperty("ref2");
  });
});

describe("mapSavedServiceIds", () => {
  it("returns unique service ids and ignores blanks", () => {
    expect(
      mapSavedServiceIds([
        { service_id: "svc-clean" },
        { service_id: "svc-clean" },
        { service_id: null },
        { service_id: "" },
      ]),
    ).toEqual(["svc-clean"]);
  });

  it("returns an empty list for null or missing rows", () => {
    expect(mapSavedServiceIds(null)).toEqual([]);
    expect(mapSavedServiceIds(undefined)).toEqual([]);
    expect(mapSavedServiceIds([])).toEqual([]);
  });
});

describe("mapSavedZoneIds", () => {
  it("returns unique zone ids and ignores blanks", () => {
    expect(
      mapSavedZoneIds([{ zone_id: "zone-maadi" }, { zone_id: "zone-zayed" }, { zone_id: null }]),
    ).toEqual(["zone-maadi", "zone-zayed"]);
  });
});

describe("mapSavedReferences", () => {
  it("sorts by sort_order into the two reference slots", () => {
    const mapped = mapSavedReferences([
      {
        full_name: "Second",
        relationship: "neighbor",
        phone: "+201022233344",
        notes: "",
        sort_order: 2,
      },
      {
        full_name: "First",
        relationship: "former_client",
        phone: "+201011122233",
        notes: "weekly",
        sort_order: 1,
      },
    ]);

    expect(mapped.ref1.full_name).toBe("First");
    expect(mapped.ref1.notes).toBe("weekly");
    expect(mapped.ref2.full_name).toBe("Second");
  });

  it("keeps the second slot empty when only one reference is saved", () => {
    const mapped = mapSavedReferences([
      {
        full_name: "Only",
        relationship: "client",
        phone: "+201011122233",
        notes: null,
        sort_order: 1,
      },
    ]);

    expect(mapped.ref1.full_name).toBe("Only");
    expect(mapped.ref2).toEqual({ full_name: "", relationship: "", phone: "", notes: "" });
  });
});

describe("buildCoverageSavePayload", () => {
  it("blocks save when saved zones have not loaded", () => {
    expect(buildCoverageSavePayload("loading", ["zone-maadi"], ["zone-maadi"])).toEqual({
      ok: false,
      error: "not_loaded",
    });
  });

  it("blocks save when the saved-zone query failed", () => {
    expect(buildCoverageSavePayload("error", ["zone-maadi"], ["zone-maadi"])).toEqual({
      ok: false,
      error: "load_failed",
    });
  });

  it("rejects an empty or fully inactive selection", () => {
    expect(buildCoverageSavePayload("ready", [], ["zone-maadi"])).toEqual({
      ok: false,
      error: "zone_required",
    });
    expect(buildCoverageSavePayload("ready", ["zone-old"], ["zone-maadi"])).toEqual({
      ok: false,
      error: "zone_required",
    });
  });

  it("sends only currently active zone ids", () => {
    expect(
      buildCoverageSavePayload(
        "ready",
        ["zone-maadi", "zone-old", "zone-zayed"],
        ["zone-maadi", "zone-zayed"],
      ),
    ).toEqual({
      ok: true,
      zone_ids: ["zone-maadi", "zone-zayed"],
    });
  });
});
